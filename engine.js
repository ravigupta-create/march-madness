// ============================================================
// MARCH MADNESS PREDICTION ENGINE
// Log5 probability model, bracket analysis, bot bracket generation
// ============================================================

const PredictionEngine = (() => {

    // Log5 formula: P(A beats B) given true win rates pA, pB
    function log5(pA, pB) {
        const num = pA * (1 - pB);
        const den = pA * (1 - pB) + pB * (1 - pA);
        return den === 0 ? 0.5 : num / den;
    }

    // Get adjusted strength for a team (seed + conference + rating)
    function getTeamStrength(team) {
        let base = MarchMadnessData.SEED_STRENGTH[team.seed] || 0.5;

        // Apply conference multiplier (small effect, ~2-8%)
        const confMult = MarchMadnessData.CONFERENCE_STRENGTH[team.conference]
            || MarchMadnessData.CONFERENCE_STRENGTH['default'];
        base *= confMult;

        // Apply team-specific rating adjustment if available
        // Rating is 0-100; normalize to small adjustment factor
        if (team.rating) {
            const ratingAdj = (team.rating - 75) / 250; // +-0.10 range
            base = Math.max(0.02, Math.min(0.98, base + ratingAdj));
        }

        return base;
    }

    // Win probability: teamA beats teamB
    function getWinProbability(teamA, teamB) {
        if (!teamA || !teamB) return 0.5;

        // For Round 1 matchups, check if we have exact historical data
        const seedKey1 = `${Math.min(teamA.seed, teamB.seed)}v${Math.max(teamA.seed, teamB.seed)}`;
        const historical = MarchMadnessData.ROUND1_HISTORICAL[seedKey1];

        // Use adjusted log5 as primary model
        const strA = getTeamStrength(teamA);
        const strB = getTeamStrength(teamB);
        let prob = log5(strA, strB);

        // Blend with historical first-round data if available (60% model, 40% historical)
        if (historical !== undefined) {
            const histProb = teamA.seed < teamB.seed ? historical : (1 - historical);
            prob = prob * 0.6 + histProb * 0.4;
        }

        return Math.max(0.001, Math.min(0.999, prob));
    }

    // Generate the bot's optimal bracket (pick most probable winner each game)
    function generateBotBracket(tournamentData) {
        const bracket = {};

        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const teams = tournamentData.regions[regionName];
            const orderedTeams = MarchMadnessData.getTeamsInBracketOrder(teams);
            const regionGames = [];

            // Round 1: 8 games
            const round1Winners = [];
            for (let i = 0; i < 16; i += 2) {
                const teamA = orderedTeams[i];
                const teamB = orderedTeams[i + 1];
                const prob = getWinProbability(teamA, teamB);
                const winner = prob >= 0.5 ? teamA : teamB;
                const winProb = prob >= 0.5 ? prob : (1 - prob);
                round1Winners.push(winner);
                regionGames.push({
                    teamA, teamB, winner, probability: winProb,
                    round: 1, isUpset: winner.seed > Math.min(teamA.seed, teamB.seed)
                });
            }

            // Round 2: 4 games
            const round2Winners = [];
            for (let i = 0; i < 8; i += 2) {
                const teamA = round1Winners[i];
                const teamB = round1Winners[i + 1];
                const prob = getWinProbability(teamA, teamB);
                const winner = prob >= 0.5 ? teamA : teamB;
                const winProb = prob >= 0.5 ? prob : (1 - prob);
                round2Winners.push(winner);
                regionGames.push({
                    teamA, teamB, winner, probability: winProb,
                    round: 2, isUpset: winner.seed > Math.min(teamA.seed, teamB.seed)
                });
            }

            // Sweet 16: 2 games
            const sweet16Winners = [];
            for (let i = 0; i < 4; i += 2) {
                const teamA = round2Winners[i];
                const teamB = round2Winners[i + 1];
                const prob = getWinProbability(teamA, teamB);
                const winner = prob >= 0.5 ? teamA : teamB;
                const winProb = prob >= 0.5 ? prob : (1 - prob);
                sweet16Winners.push(winner);
                regionGames.push({
                    teamA, teamB, winner, probability: winProb,
                    round: 3, isUpset: winner.seed > Math.min(teamA.seed, teamB.seed)
                });
            }

            // Elite 8: 1 game
            const teamA = sweet16Winners[0];
            const teamB = sweet16Winners[1];
            const prob = getWinProbability(teamA, teamB);
            const winner = prob >= 0.5 ? teamA : teamB;
            const winProb = prob >= 0.5 ? prob : (1 - prob);
            regionGames.push({
                teamA, teamB, winner, probability: winProb,
                round: 4, isUpset: winner.seed > Math.min(teamA.seed, teamB.seed)
            });

            bracket[regionName] = {
                games: regionGames,
                champion: winner
            };
        }

        // Final Four
        const ff1A = bracket[MarchMadnessData.REGION_NAMES[0]].champion;
        const ff1B = bracket[MarchMadnessData.REGION_NAMES[1]].champion;
        const ff2A = bracket[MarchMadnessData.REGION_NAMES[2]].champion;
        const ff2B = bracket[MarchMadnessData.REGION_NAMES[3]].champion;

        const ff1Prob = getWinProbability(ff1A, ff1B);
        const ff1Winner = ff1Prob >= 0.5 ? ff1A : ff1B;
        const ff2Prob = getWinProbability(ff2A, ff2B);
        const ff2Winner = ff2Prob >= 0.5 ? ff2A : ff2B;

        // Championship
        const champProb = getWinProbability(ff1Winner, ff2Winner);
        const champion = champProb >= 0.5 ? ff1Winner : ff2Winner;

        bracket.finalFour = {
            game1: { teamA: ff1A, teamB: ff1B, winner: ff1Winner, probability: ff1Prob >= 0.5 ? ff1Prob : 1 - ff1Prob },
            game2: { teamA: ff2A, teamB: ff2B, winner: ff2Winner, probability: ff2Prob >= 0.5 ? ff2Prob : 1 - ff2Prob }
        };
        bracket.championship = {
            teamA: ff1Winner, teamB: ff2Winner, winner: champion,
            probability: champProb >= 0.5 ? champProb : 1 - champProb
        };
        bracket.champion = champion;

        return bracket;
    }

    // Analyze a user's bracket picks
    // userPicks: { regions: { [name]: [winner of each game in order] }, finalFour: {...}, championship: {...} }
    function analyzeUserBracket(userPicks, tournamentData) {
        const analysis = {
            totalGames: 0,
            totalFilled: 0,
            picks: [],
            overallProbability: 1,
            log10Probability: 0,
            bracketScore: 0,
            upsetCount: 0,
            riskLevel: '',
            suggestions: [],
            roundBreakdown: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }
        };

        if (!userPicks) return analysis;

        // Analyze region picks
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const regionData = userPicks.regions?.[regionName];
            if (!regionData) continue;

            const teams = tournamentData.regions[regionName];
            const orderedTeams = MarchMadnessData.getTeamsInBracketOrder(teams);

            // Track winners for each round
            let prevRoundTeams = orderedTeams;

            for (let round = 0; round < regionData.length; round++) {
                const roundPicks = regionData[round];
                if (!roundPicks) continue;

                for (let i = 0; i < roundPicks.length; i++) {
                    analysis.totalGames++;
                    const winner = roundPicks[i];
                    if (!winner) continue;

                    analysis.totalFilled++;

                    // Determine the matchup
                    const teamAIndex = i * 2;
                    const teamBIndex = i * 2 + 1;
                    const teamA = prevRoundTeams[teamAIndex];
                    const teamB = prevRoundTeams[teamBIndex];

                    if (!teamA || !teamB) continue;

                    const prob = getWinProbability(winner, winner === teamA ? teamB : teamA);
                    const isUpset = winner.seed > Math.min(teamA.seed, teamB.seed);

                    if (isUpset) analysis.upsetCount++;

                    const pick = {
                        winner, loser: winner === teamA ? teamB : teamA,
                        probability: prob,
                        round: round + 1,
                        region: regionName,
                        isUpset,
                        riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot'
                    };

                    analysis.picks.push(pick);
                    analysis.roundBreakdown[round + 1].push(pick);
                    analysis.overallProbability *= prob;
                }

                prevRoundTeams = roundPicks;
            }
        }

        // Analyze Final Four and Championship
        if (userPicks.finalFour) {
            for (const game of [userPicks.finalFour.game1, userPicks.finalFour.game2]) {
                if (game?.winner && game?.teamA && game?.teamB) {
                    analysis.totalGames++;
                    analysis.totalFilled++;
                    const prob = getWinProbability(game.winner, game.winner === game.teamA ? game.teamB : game.teamA);
                    const isUpset = game.winner.seed > Math.min(game.teamA.seed, game.teamB.seed);
                    if (isUpset) analysis.upsetCount++;
                    const pick = {
                        winner: game.winner, loser: game.winner === game.teamA ? game.teamB : game.teamA,
                        probability: prob, round: 5, region: 'Final Four', isUpset,
                        riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot'
                    };
                    analysis.picks.push(pick);
                    analysis.roundBreakdown[5].push(pick);
                    analysis.overallProbability *= prob;
                }
            }

            if (userPicks.championship?.winner && userPicks.championship?.teamA && userPicks.championship?.teamB) {
                analysis.totalGames++;
                analysis.totalFilled++;
                const game = userPicks.championship;
                const prob = getWinProbability(game.winner, game.winner === game.teamA ? game.teamB : game.teamA);
                const isUpset = game.winner.seed > Math.min(game.teamA.seed, game.teamB.seed);
                if (isUpset) analysis.upsetCount++;
                const pick = {
                    winner: game.winner, loser: game.winner === game.teamA ? game.teamB : game.teamA,
                    probability: prob, round: 6, region: 'Championship', isUpset,
                    riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot'
                };
                analysis.picks.push(pick);
                analysis.roundBreakdown[6].push(pick);
                analysis.overallProbability *= prob;
            }
        }

        // Calculate bracket score (normalized for readability)
        if (analysis.totalFilled > 0) {
            analysis.log10Probability = Math.log10(analysis.overallProbability);
            // Score: 0-100 based on how likely the bracket is relative to perfectly chalky
            const chalkyLog = -8.5; // approx log10 probability of a "perfect chalk" bracket
            const randomLog = -19; // approx log10 probability of random picks
            const userLog = analysis.log10Probability;
            analysis.bracketScore = Math.max(0, Math.min(100,
                ((userLog - randomLog) / (chalkyLog - randomLog)) * 100
            ));
        }

        // Risk assessment
        if (analysis.upsetCount <= 3) analysis.riskLevel = 'Conservative';
        else if (analysis.upsetCount <= 7) analysis.riskLevel = 'Moderate';
        else if (analysis.upsetCount <= 12) analysis.riskLevel = 'Aggressive';
        else analysis.riskLevel = 'Chaos';

        // Generate suggestions
        analysis.suggestions = generateSuggestions(analysis);

        return analysis;
    }

    function generateSuggestions(analysis) {
        const suggestions = [];

        // Find the riskiest picks
        const riskyPicks = analysis.picks
            .filter(p => p.riskCategory === 'longshot' || p.riskCategory === 'risky')
            .sort((a, b) => a.probability - b.probability);

        for (const pick of riskyPicks.slice(0, 5)) {
            const roundNames = { 1: 'Round of 64', 2: 'Round of 32', 3: 'Sweet 16', 4: 'Elite 8', 5: 'Final Four', 6: 'Championship' };
            suggestions.push({
                type: 'risk',
                message: `${pick.winner.name} (${pick.winner.seed}) over ${pick.loser.name} (${pick.loser.seed}) in ${roundNames[pick.round]} — only ${(pick.probability * 100).toFixed(1)}% likely`,
                pick,
                alternative: pick.loser
            });
        }

        // Check if bracket is too chalky or too chaotic
        if (analysis.upsetCount === 0 && analysis.totalFilled > 10) {
            suggestions.push({
                type: 'strategy',
                message: 'Your bracket has zero upsets. Historically, 8-10 upsets occur per tournament. Consider picking a few 12-over-5 or 11-over-6 upsets to differentiate.'
            });
        }

        if (analysis.upsetCount > 15) {
            suggestions.push({
                type: 'strategy',
                message: 'Your bracket has an unusually high number of upsets. While upsets happen, too many dramatically reduce your bracket\'s probability.'
            });
        }

        // Check if all 1-seeds are in Final Four
        const ff = analysis.roundBreakdown[5] || [];
        const oneSeeds = ff.filter(p => p.winner.seed === 1);
        if (ff.length === 2 && oneSeeds.length === 2) {
            suggestions.push({
                type: 'info',
                message: 'Historically, only ~20% of Final Fours have all 1-seeds. Having at least one 2 or 3 seed is common.'
            });
        }

        return suggestions;
    }

    // Get probability explanation for a specific matchup
    function getMatchupInsight(teamA, teamB) {
        const prob = getWinProbability(teamA, teamB);
        const favorite = prob >= 0.5 ? teamA : teamB;
        const underdog = prob >= 0.5 ? teamB : teamA;
        const favProb = prob >= 0.5 ? prob : (1 - prob);

        let insight = '';
        if (favProb > 0.9) insight = 'Dominant favorite. Upsets at this seed matchup are extremely rare.';
        else if (favProb > 0.75) insight = 'Strong favorite. The higher seed should win comfortably.';
        else if (favProb > 0.6) insight = 'Moderate favorite. Upsets are possible but not expected.';
        else if (favProb > 0.52) insight = 'Near toss-up. This game could go either way.';
        else insight = 'Coin flip. Seed difference is minimal here.';

        return {
            favorite, underdog, probability: favProb,
            insight,
            historicalNote: getHistoricalNote(teamA.seed, teamB.seed)
        };
    }

    function getHistoricalNote(seedA, seedB) {
        const matchups = {
            '1v16': 'Only 2 times has a 16 seed beaten a 1 seed (UMBC over Virginia 2018, FDU over Purdue 2023).',
            '2v15': '15 seeds have won about 5.6% of the time — notable: Oral Roberts 2021, St. Peter\'s 2022.',
            '5v12': 'The famous 5-12 upset occurs ~35% of the time. At least one happens almost every year.',
            '8v9': 'The closest matchup in the tournament. Essentially a coin flip historically.',
            '3v14': '14 seeds win about 15% of the time. A solid upset pick.',
            '4v13': '13 seeds win about 21% of the time. Notable: Sister Jean\'s Loyola-Chicago 2018.',
            '6v11': '11 seeds (often play-in teams) upset 6 seeds ~38% of the time.',
            '7v10': '10 seeds win about 39% of the time. Very competitive matchup.'
        };
        const key = `${Math.min(seedA, seedB)}v${Math.max(seedA, seedB)}`;
        return matchups[key] || '';
    }

    return {
        log5,
        getTeamStrength,
        getWinProbability,
        generateBotBracket,
        analyzeUserBracket,
        getMatchupInsight,
        getHistoricalNote
    };
})();
