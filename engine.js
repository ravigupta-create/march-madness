// ============================================================
// MARCH MADNESS PREDICTION ENGINE
// Log5 model, Monte Carlo simulation, bracket analysis,
// bot bracket generation, per-pick explanations
// ============================================================

const PredictionEngine = (() => {

    // Log5 formula: P(A beats B) given true win rates pA, pB
    function log5(pA, pB) {
        const num = pA * (1 - pB);
        const den = pA * (1 - pB) + pB * (1 - pA);
        return den === 0 ? 0.5 : num / den;
    }

    // Get adjusted strength for a team
    // Uses REAL season stats (every game analyzed) when available, falls back to seed-based
    function getTeamStrength(team) {
        if (!team) return 0.5;

        // If we have real season stats, use advanced rating (data from every game played)
        const advRating = MarchMadnessData.computeAdvancedRating(team.name);
        if (advRating !== null) {
            // Advanced rating is 30-99 scale from real game data
            // Convert to strength probability (0.05 - 0.98)
            const statsStrength = advRating / 105;

            // Blend: 65% real stats + 20% seed baseline + 15% historical
            const seedBase = MarchMadnessData.SEED_STRENGTH[team.seed] || 0.5;
            return Math.max(0.03, Math.min(0.97, statsStrength * 0.65 + seedBase * 0.20 + (team.rating || 75) / 100 * 0.15));
        }

        // Fallback: seed-based model with conference adjustment
        let base = MarchMadnessData.SEED_STRENGTH[team.seed] || 0.5;
        const confMult = MarchMadnessData.CONFERENCE_STRENGTH[team.conference]
            || MarchMadnessData.CONFERENCE_STRENGTH['default'];
        base *= confMult;

        if (team.rating != null) {
            const ratingAdj = (team.rating - 75) / 250;
            base = Math.max(0.02, Math.min(0.98, base + ratingAdj));
        }

        return base;
    }

    // Win probability: teamA beats teamB
    function getWinProbability(teamA, teamB) {
        if (!teamA || !teamB) return 0.5;

        const strA = getTeamStrength(teamA);
        const strB = getTeamStrength(teamB);
        let prob = log5(strA, strB);

        // Blend with historical first-round data when seeds match
        const seedKey = `${Math.min(teamA.seed, teamB.seed)}v${Math.max(teamA.seed, teamB.seed)}`;
        const historical = MarchMadnessData.ROUND1_HISTORICAL[seedKey];
        if (historical !== undefined) {
            const histProb = teamA.seed < teamB.seed ? historical : (1 - historical);
            prob = prob * 0.6 + histProb * 0.4;
        }

        return Math.max(0.001, Math.min(0.999, prob));
    }

    // Confidence interval using Wilson score interval approximation
    function getConfidenceInterval(prob, n = 160) {
        // n = effective sample size (160 = ~40 years × 4 regions)
        const z = 1.96; // 95% CI
        const phat = prob;
        const denom = 1 + z * z / n;
        const center = (phat + z * z / (2 * n)) / denom;
        const margin = (z * Math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))) / denom;
        return {
            low: Math.max(0.001, center - margin),
            high: Math.min(0.999, center + margin),
            center
        };
    }

    // Generate per-pick explanation — uses real season stats when available
    function getPickExplanation(teamA, teamB, winner) {
        const prob = getWinProbability(winner, winner === teamA ? teamB : teamA);
        const loser = winner === teamA ? teamB : teamA;
        const isUpset = winner.seed > loser.seed;

        const confA = MarchMadnessData.CONFERENCE_STRENGTH[teamA.conference] || 0.95;
        const confB = MarchMadnessData.CONFERENCE_STRENGTH[teamB.conference] || 0.95;

        let explanation = '';

        // Real stats-based explanation
        const statsW = MarchMadnessData.getSeasonStats()[winner.name];
        const statsL = MarchMadnessData.getSeasonStats()[loser.name];

        if (statsW && statsL && statsW.ppg && statsL.ppg) {
            const wRecord = statsW.wins && statsW.losses ? `${statsW.wins}-${statsW.losses}` : '';
            const lRecord = statsL.wins && statsL.losses ? `${statsL.wins}-${statsL.losses}` : '';

            if (prob > 0.75) {
                explanation = `${winner.name}${wRecord ? ' ('+wRecord+')' : ''} is a strong favorite. `;
            } else if (prob > 0.6) {
                explanation = `${winner.name}${wRecord ? ' ('+wRecord+')' : ''} has a moderate edge. `;
            } else if (prob > 0.52) {
                explanation = `Close matchup. `;
            } else {
                explanation = `Near coin flip. `;
            }

            // Stats comparison
            if (statsW.ppg && statsL.ppg) {
                explanation += `${winner.name} averages ${statsW.ppg.toFixed(1)} PPG vs ${loser.name}'s ${statsL.ppg.toFixed(1)}. `;
            }
            if (statsW.papg && statsL.papg) {
                const betterDef = statsW.papg < statsL.papg ? winner : loser;
                explanation += `${betterDef.name} has the better defense (${Math.min(statsW.papg, statsL.papg).toFixed(1)} PPG allowed). `;
            }
            if (statsW.fgPct && statsL.fgPct) {
                const betterShoot = statsW.fgPct > statsL.fgPct ? winner : loser;
                explanation += `${betterShoot.name} shoots ${(Math.max(statsW.fgPct, statsL.fgPct) * 100).toFixed(1)}% FG. `;
            }
            if (isUpset) {
                explanation += `Despite the seed difference, ${winner.name}'s season stats suggest they're the stronger team. `;
            }
        } else {
            // Fallback to seed-based explanation
            if (prob > 0.9) {
                explanation = `${winner.name} is an overwhelming favorite. Historically, ${winner.seed}-seeds beat ${loser.seed}-seeds over 90% of the time. `;
            } else if (prob > 0.75) {
                explanation = `${winner.name} is a strong favorite. The seed advantage is significant. `;
            } else if (prob > 0.6) {
                explanation = `${winner.name} has a moderate edge. `;
                if (isUpset) explanation += `${winner.name}'s metrics suggest they're the stronger team. `;
            } else if (prob > 0.52) {
                explanation = `Close matchup. ${winner.name}'s slightly higher efficiency gives them the edge. `;
            } else {
                explanation = `Essentially a coin flip. `;
            }
        }

        // Conference factor
        if (Math.abs(confA - confB) > 0.05) {
            const stronger = confA > confB ? teamA : teamB;
            explanation += `${stronger.name} benefits from the stronger ${stronger.conference}. `;
        }

        // Historical note
        const seedKey = `${Math.min(teamA.seed, teamB.seed)}v${Math.max(teamA.seed, teamB.seed)}`;
        const history = MarchMadnessData.SEED_MATCHUP_HISTORY[seedKey];
        if (history) {
            explanation += history.note;
        }

        return explanation.trim();
    }

    // Monte Carlo simulation — run N bracket simulations
    function monteCarloSimulate(tournamentData, numSims = 5000) {
        const results = {};

        // Initialize counters for each team
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            for (const team of tournamentData.regions[regionName]) {
                results[team.name] = {
                    team,
                    roundReach: [numSims, 0, 0, 0, 0, 0, 0], // R64 entry, R32, S16, E8, FF, Champ, Winner
                    championships: 0
                };
            }
        }

        for (let sim = 0; sim < numSims; sim++) {
            const regionChampions = [];

            for (const regionName of MarchMadnessData.REGION_NAMES) {
                const teams = tournamentData.regions[regionName];
                const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);

                // Simulate region
                let currentTeams = [...ordered];
                let roundIdx = 1;

                while (currentTeams.length > 1) {
                    const nextRound = [];
                    for (let i = 0; i < currentTeams.length; i += 2) {
                        const tA = currentTeams[i];
                        const tB = currentTeams[i + 1];
                        const prob = getWinProbability(tA, tB);
                        const winner = Math.random() < prob ? tA : tB;
                        results[winner.name].roundReach[roundIdx]++;
                        nextRound.push(winner);
                    }
                    currentTeams = nextRound;
                    roundIdx++;
                }
                regionChampions.push(currentTeams[0]);
            }

            // Final Four
            const ff1prob = getWinProbability(regionChampions[0], regionChampions[1]);
            const ff1Winner = Math.random() < ff1prob ? regionChampions[0] : regionChampions[1];
            results[ff1Winner.name].roundReach[5]++;

            const ff2prob = getWinProbability(regionChampions[2], regionChampions[3]);
            const ff2Winner = Math.random() < ff2prob ? regionChampions[2] : regionChampions[3];
            results[ff2Winner.name].roundReach[5]++;

            // Championship
            const champProb = getWinProbability(ff1Winner, ff2Winner);
            const champion = Math.random() < champProb ? ff1Winner : ff2Winner;
            results[champion.name].roundReach[6]++;
            results[champion.name].championships++;
        }

        // Convert to probabilities
        for (const key of Object.keys(results)) {
            results[key].roundReach = results[key].roundReach.map(c => c / numSims);
            results[key].championshipProb = results[key].championships / numSims;
        }

        return results;
    }

    // Generate the bot's optimal bracket
    function generateBotBracket(tournamentData) {
        const bracket = {};

        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const teams = tournamentData.regions[regionName];
            const orderedTeams = MarchMadnessData.getTeamsInBracketOrder(teams);
            const regionGames = [];

            const roundData = [orderedTeams];
            const roundNames = [1, 2, 3, 4];

            for (let round = 0; round < 4; round++) {
                const prev = roundData[round];
                const winners = [];
                for (let i = 0; i < prev.length; i += 2) {
                    const teamA = prev[i];
                    const teamB = prev[i + 1];
                    const prob = getWinProbability(teamA, teamB);
                    const winner = prob >= 0.5 ? teamA : teamB;
                    const winProb = prob >= 0.5 ? prob : (1 - prob);
                    winners.push(winner);
                    regionGames.push({
                        teamA, teamB, winner, probability: winProb,
                        round: round + 1,
                        isUpset: winner.seed > Math.min(teamA.seed, teamB.seed),
                        explanation: getPickExplanation(teamA, teamB, winner),
                        ci: getConfidenceInterval(winProb)
                    });
                }
                roundData.push(winners);
            }

            bracket[regionName] = {
                games: regionGames,
                champion: roundData[4][0]
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

        const champProb = getWinProbability(ff1Winner, ff2Winner);
        const champion = champProb >= 0.5 ? ff1Winner : ff2Winner;

        bracket.finalFour = {
            game1: {
                teamA: ff1A, teamB: ff1B, winner: ff1Winner,
                probability: ff1Prob >= 0.5 ? ff1Prob : 1 - ff1Prob,
                explanation: getPickExplanation(ff1A, ff1B, ff1Winner)
            },
            game2: {
                teamA: ff2A, teamB: ff2B, winner: ff2Winner,
                probability: ff2Prob >= 0.5 ? ff2Prob : 1 - ff2Prob,
                explanation: getPickExplanation(ff2A, ff2B, ff2Winner)
            }
        };
        bracket.championship = {
            teamA: ff1Winner, teamB: ff2Winner, winner: champion,
            probability: champProb >= 0.5 ? champProb : 1 - champProb,
            explanation: getPickExplanation(ff1Winner, ff2Winner, champion)
        };
        bracket.champion = champion;

        return bracket;
    }

    // Analyze a user's bracket picks
    function analyzeUserBracket(userPicks, tournamentData) {
        const analysis = {
            totalGames: 63,
            totalFilled: 0,
            picks: [],
            overallProbability: 1,
            log10Probability: 0,
            bracketScore: 0,
            upsetCount: 0,
            riskLevel: '',
            suggestions: [],
            roundBreakdown: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
            expectedPoints: {},
            percentile: 0,
            seedDistribution: {}
        };

        if (!userPicks) return analysis;

        // Analyze region picks
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const regionData = userPicks.regions?.[regionName];
            if (!regionData) continue;

            const teams = tournamentData.regions[regionName];
            const orderedTeams = MarchMadnessData.getTeamsInBracketOrder(teams);
            let prevRoundTeams = orderedTeams;

            for (let round = 0; round < regionData.length; round++) {
                const roundPicks = regionData[round];
                if (!roundPicks) continue;

                for (let i = 0; i < roundPicks.length; i++) {
                    const winner = roundPicks[i];
                    if (!winner) continue;

                    analysis.totalFilled++;
                    const teamA = prevRoundTeams[i * 2];
                    const teamB = prevRoundTeams[i * 2 + 1];
                    if (!teamA || !teamB) continue;

                    const prob = getWinProbability(winner, winner === teamA ? teamB : teamA);
                    const isUpset = winner.seed > Math.min(teamA.seed, teamB.seed);
                    if (isUpset) analysis.upsetCount++;

                    const pick = {
                        winner, loser: winner === teamA ? teamB : teamA,
                        probability: prob,
                        ci: getConfidenceInterval(prob),
                        round: round + 1,
                        region: regionName,
                        isUpset,
                        riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot',
                        explanation: getPickExplanation(teamA, teamB, winner)
                    };

                    analysis.picks.push(pick);
                    analysis.roundBreakdown[round + 1].push(pick);
                    analysis.overallProbability *= prob;

                    // Track seed distribution
                    const seedKey = `Seed ${winner.seed}`;
                    analysis.seedDistribution[seedKey] = (analysis.seedDistribution[seedKey] || 0) + 1;
                }

                prevRoundTeams = roundPicks;
            }
        }

        // Final Four + Championship
        if (userPicks.finalFour) {
            for (const game of [userPicks.finalFour.game1, userPicks.finalFour.game2]) {
                if (game?.winner && game?.teamA && game?.teamB) {
                    analysis.totalFilled++;
                    const prob = getWinProbability(game.winner, game.winner === game.teamA ? game.teamB : game.teamA);
                    const isUpset = game.winner.seed > Math.min(game.teamA.seed, game.teamB.seed);
                    if (isUpset) analysis.upsetCount++;
                    const pick = {
                        winner: game.winner, loser: game.winner === game.teamA ? game.teamB : game.teamA,
                        probability: prob, ci: getConfidenceInterval(prob),
                        round: 5, region: 'Final Four', isUpset,
                        riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot',
                        explanation: getPickExplanation(game.teamA, game.teamB, game.winner)
                    };
                    analysis.picks.push(pick);
                    analysis.roundBreakdown[5].push(pick);
                    analysis.overallProbability *= prob;
                }
            }

            if (userPicks.championship?.winner && userPicks.championship?.teamA && userPicks.championship?.teamB) {
                analysis.totalFilled++;
                const game = userPicks.championship;
                const prob = getWinProbability(game.winner, game.winner === game.teamA ? game.teamB : game.teamA);
                const isUpset = game.winner.seed > Math.min(game.teamA.seed, game.teamB.seed);
                if (isUpset) analysis.upsetCount++;
                const pick = {
                    winner: game.winner, loser: game.winner === game.teamA ? game.teamB : game.teamA,
                    probability: prob, ci: getConfidenceInterval(prob),
                    round: 6, region: 'Championship', isUpset,
                    riskCategory: prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot',
                    explanation: getPickExplanation(game.teamA, game.teamB, game.winner)
                };
                analysis.picks.push(pick);
                analysis.roundBreakdown[6].push(pick);
                analysis.overallProbability *= prob;
            }
        }

        // Calculate bracket score
        if (analysis.totalFilled > 0) {
            analysis.log10Probability = Math.log10(analysis.overallProbability);
            const chalkyLog = -8.5;
            const randomLog = -19;
            const userLog = analysis.log10Probability;
            analysis.bracketScore = Math.max(0, Math.min(100,
                ((userLog - randomLog) / (chalkyLog - randomLog)) * 100
            ));
        }

        // Calculate expected points for each scoring system
        for (const [key, system] of Object.entries(MarchMadnessData.SCORING_SYSTEMS)) {
            let expected = 0;
            for (const pick of analysis.picks) {
                let pts = system.points[pick.round - 1] || 0;
                if (system.seedMultiplier) pts *= pick.winner.seed;
                if (system.upsetMultiplier && pick.isUpset) pts *= 1.5;
                expected += pts * pick.probability;
            }
            analysis.expectedPoints[key] = Math.round(expected);
        }

        // Percentile estimation (based on bracket score)
        // Calibrated: score 80+ = top 5%, 60-80 = top 25%, 40-60 = top 50%
        if (analysis.bracketScore >= 90) analysis.percentile = 98;
        else if (analysis.bracketScore >= 80) analysis.percentile = 95;
        else if (analysis.bracketScore >= 70) analysis.percentile = 85;
        else if (analysis.bracketScore >= 60) analysis.percentile = 70;
        else if (analysis.bracketScore >= 50) analysis.percentile = 50;
        else if (analysis.bracketScore >= 40) analysis.percentile = 35;
        else if (analysis.bracketScore >= 30) analysis.percentile = 20;
        else if (analysis.bracketScore >= 20) analysis.percentile = 10;
        else analysis.percentile = 5;

        // Risk level
        if (analysis.upsetCount <= 3) analysis.riskLevel = 'Conservative (Chalk)';
        else if (analysis.upsetCount <= 7) analysis.riskLevel = 'Moderate';
        else if (analysis.upsetCount <= 12) analysis.riskLevel = 'Aggressive';
        else analysis.riskLevel = 'Chaos Agent';

        // Generate suggestions
        analysis.suggestions = generateSuggestions(analysis);

        return analysis;
    }

    function generateSuggestions(analysis) {
        const suggestions = [];

        // Riskiest picks
        const riskyPicks = analysis.picks
            .filter(p => p.riskCategory === 'longshot' || p.riskCategory === 'risky')
            .sort((a, b) => a.probability - b.probability);

        for (const pick of riskyPicks.slice(0, 5)) {
            suggestions.push({
                type: 'risk',
                severity: pick.probability < 0.15 ? 'high' : 'medium',
                message: `${pick.winner.name} (${pick.winner.seed}) over ${pick.loser.name} (${pick.loser.seed}) in ${MarchMadnessData.ROUND_NAMES[pick.round - 1]} has only a ${(pick.probability * 100).toFixed(1)}% chance. Switching to ${pick.loser.name} would significantly improve your bracket's probability.`,
                pick,
                alternative: pick.loser,
                probImprovement: ((1 - pick.probability) / pick.probability).toFixed(1) + 'x more likely'
            });
        }

        // Strategic analysis
        if (analysis.upsetCount === 0 && analysis.totalFilled > 10) {
            suggestions.push({
                type: 'strategy',
                message: 'Your bracket has zero upsets. Historically, 8-10 upsets occur per tournament. Without any upsets, your bracket will look identical to millions of others. Consider picking 2-3 upsets (12-over-5 and 11-over-6 are the most common) to differentiate yourself in a bracket pool.'
            });
        }

        if (analysis.upsetCount > 15) {
            suggestions.push({
                type: 'strategy',
                message: 'You have over 15 upsets — thats significantly more than the historical average of 8-10. While a few well-placed upsets differentiate your bracket, too many reduce your overall probability dramatically. Consider removing some lower-confidence upsets in later rounds.'
            });
        }

        // Check 5v12 upsets (the classic)
        const has5v12 = analysis.picks.some(p => p.round === 1 && p.winner.seed === 12 && p.loser.seed === 5);
        if (!has5v12 && analysis.totalFilled >= 32) {
            suggestions.push({
                type: 'info',
                message: 'You have no 12-over-5 upsets. Historically, at least one 12-seed wins in the first round about 65% of tournaments. This is the most common upset pick.'
            });
        }

        // Check Final Four seeds
        const ffPicks = analysis.roundBreakdown[5] || [];
        if (ffPicks.length >= 2) {
            const allOneSeeds = ffPicks.every(p => p.winner.seed === 1);
            if (allOneSeeds) {
                suggestions.push({
                    type: 'info',
                    message: 'All your Final Four teams are 1-seeds. Since 1985, only one tournament (2008) has had all four 1-seeds in the Final Four. Consider having at least one 2 or 3 seed.'
                });
            }
        }

        // Champion seed check
        const champPick = analysis.roundBreakdown[6]?.[0];
        if (champPick) {
            if (champPick.winner.seed > 8) {
                suggestions.push({
                    type: 'risk',
                    severity: 'high',
                    message: `A ${champPick.winner.seed}-seed champion would be historic. The lowest seed to ever win was 8-seed Villanova in 1985. Consider a higher-seeded champion for better probability.`,
                    pick: champPick
                });
            } else if (champPick.winner.seed > 4) {
                suggestions.push({
                    type: 'info',
                    message: `A ${champPick.winner.seed}-seed champion is rare but possible. Since 1985, seeds 1-3 have won ~82% of championships.`
                });
            }
        }

        // Upset distribution check
        const r1Upsets = (analysis.roundBreakdown[1] || []).filter(p => p.isUpset).length;
        if (r1Upsets > 10 && analysis.totalFilled >= 32) {
            suggestions.push({
                type: 'strategy',
                message: `You have ${r1Upsets} first-round upsets. The historical average is about 5.4. Consider being more selective — focus on the classic 5/12, 6/11, and 7/10 matchups.`
            });
        }

        return suggestions;
    }

    // "What if" simulation: if user changes one pick, how does score change?
    function whatIfAnalysis(userPicks, tournamentData, regionName, round, matchupIdx, newWinner) {
        // Clone and modify
        const modified = JSON.parse(JSON.stringify(userPicks));
        // This is a simplified version — full implementation would cascade
        if (modified.regions[regionName]?.[round]) {
            const teams = tournamentData.regions[regionName];
            const team = teams.find(t => t.name === newWinner);
            if (team) {
                modified.regions[regionName][round][matchupIdx] = team;
            }
        }
        const original = analyzeUserBracket(userPicks, tournamentData);
        const newAnalysis = analyzeUserBracket(modified, tournamentData);
        return {
            scoreDelta: newAnalysis.bracketScore - original.bracketScore,
            probRatio: newAnalysis.overallProbability / original.overallProbability,
            newScore: newAnalysis.bracketScore
        };
    }

    // Get matchup insight
    function getMatchupInsight(teamA, teamB) {
        const prob = getWinProbability(teamA, teamB);
        const favorite = prob >= 0.5 ? teamA : teamB;
        const underdog = prob >= 0.5 ? teamB : teamA;
        const favProb = prob >= 0.5 ? prob : (1 - prob);

        let insight = '';
        if (favProb > 0.9) insight = 'Dominant favorite. Upsets extremely rare at this seed matchup.';
        else if (favProb > 0.75) insight = 'Strong favorite. The higher seed should win comfortably.';
        else if (favProb > 0.6) insight = 'Moderate favorite. Upsets possible but not expected.';
        else if (favProb > 0.52) insight = 'Near toss-up. Could go either way.';
        else insight = 'Coin flip. Minimal seed difference here.';

        const seedKey = `${Math.min(teamA.seed, teamB.seed)}v${Math.max(teamA.seed, teamB.seed)}`;
        const history = MarchMadnessData.SEED_MATCHUP_HISTORY[seedKey];

        return {
            favorite, underdog, probability: favProb,
            insight,
            ci: getConfidenceInterval(favProb),
            historicalNote: history?.note || '',
            historicalRecord: history ? `${history.wins}-${history.losses}` : ''
        };
    }

    return {
        log5, getTeamStrength, getWinProbability, getConfidenceInterval,
        getPickExplanation, monteCarloSimulate,
        generateBotBracket, analyzeUserBracket,
        whatIfAnalysis, getMatchupInsight
    };
})();
