// ============================================================
// MARCH MADNESS DATA MODULE
// Historical probabilities, team data, tournament structure,
// scoring systems, and live data fetching
// ============================================================

const MarchMadnessData = (() => {

    // Historical seed win rates in Round 1 (1985-2024, ~40 years)
    const ROUND1_HISTORICAL = {
        '1v16': 0.994, '2v15': 0.944, '3v14': 0.852, '4v13': 0.792,
        '5v12': 0.647, '6v11': 0.622, '7v10': 0.608, '8v9': 0.515
    };

    // Seed strength ratings calibrated to historical tournament performance
    const SEED_STRENGTH = {
        1: 0.920, 2: 0.860, 3: 0.790, 4: 0.740,
        5: 0.680, 6: 0.660, 7: 0.640, 8: 0.540,
        9: 0.460, 10: 0.420, 11: 0.400, 12: 0.380,
        13: 0.300, 14: 0.250, 15: 0.180, 16: 0.060
    };

    // Historical seed-by-seed Round 1 records (wins-losses for lower seed)
    const SEED_MATCHUP_HISTORY = {
        '1v16': { wins: 155, losses: 1, note: 'Only UMBC over Virginia (2018) and FDU over Purdue (2023)' },
        '2v15': { wins: 151, losses: 9, note: '15-seeds win ~5.6%. Notable: Oral Roberts (2021), St. Peters (2022)' },
        '3v14': { wins: 136, losses: 24, note: '14-seeds win ~15%. Abilene Christian (2021), Fairleigh Dickinson (2023)' },
        '4v13': { wins: 127, losses: 33, note: '13-seeds win ~21%. Sister Jeans Loyola-Chicago (2018)' },
        '5v12': { wins: 103, losses: 57, note: '12-seeds win ~35%. At least one 12-over-5 most years' },
        '6v11': { wins: 100, losses: 60, note: '11-seeds win ~38%. Often play-in teams with momentum' },
        '7v10': { wins: 97, losses: 63, note: '10-seeds win ~39%. Very competitive matchup' },
        '8v9': { wins: 82, losses: 78, note: 'Near coin flip. 8-seeds only slightly favored historically' }
    };

    // Historical probability of each seed reaching each round
    const SEED_ROUND_REACH = {
        1:  [1.00, 0.994, 0.88, 0.72, 0.52, 0.38, 0.22],
        2:  [1.00, 0.944, 0.78, 0.56, 0.35, 0.22, 0.12],
        3:  [1.00, 0.852, 0.66, 0.42, 0.24, 0.14, 0.07],
        4:  [1.00, 0.792, 0.56, 0.34, 0.17, 0.09, 0.04],
        5:  [1.00, 0.647, 0.40, 0.20, 0.10, 0.05, 0.02],
        6:  [1.00, 0.622, 0.40, 0.18, 0.09, 0.04, 0.02],
        7:  [1.00, 0.608, 0.36, 0.16, 0.06, 0.03, 0.01],
        8:  [1.00, 0.515, 0.24, 0.10, 0.04, 0.02, 0.01],
        9:  [1.00, 0.485, 0.20, 0.08, 0.03, 0.01, 0.005],
        10: [1.00, 0.392, 0.18, 0.07, 0.03, 0.01, 0.004],
        11: [1.00, 0.378, 0.17, 0.08, 0.04, 0.02, 0.01],
        12: [1.00, 0.353, 0.14, 0.04, 0.01, 0.005, 0.002],
        13: [1.00, 0.208, 0.06, 0.01, 0.003, 0.001, 0.0005],
        14: [1.00, 0.148, 0.03, 0.005, 0.001, 0.0003, 0.0001],
        15: [1.00, 0.056, 0.01, 0.003, 0.001, 0.0002, 0.0001],
        16: [1.00, 0.006, 0.001, 0.0002, 0.00005, 0.00001, 0.000002]
    };

    // Average upsets per tournament by round (historical)
    const AVG_UPSETS_PER_ROUND = {
        1: 5.4, 2: 2.8, 3: 1.5, 4: 0.8, 5: 0.5, 6: 0.3
    };

    // Conference strength multipliers
    const CONFERENCE_STRENGTH = {
        'SEC': 1.08, 'Big Ten': 1.06, 'Big 12': 1.06, 'ACC': 1.04,
        'Big East': 1.03, 'Pac-12': 1.02, 'AAC': 1.00, 'MWC': 0.99,
        'WCC': 0.98, 'A-10': 0.97, 'MVC': 0.96, 'CAA': 0.95,
        'Ivy': 0.94, 'MAAC': 0.93, 'Horizon': 0.93, 'WAC': 0.92,
        'Big Sky': 0.92, 'Summit': 0.91, 'Patriot': 0.91, 'SWAC': 0.88,
        'MEAC': 0.88, 'NEC': 0.89, 'Southland': 0.90, 'Big South': 0.90,
        'OVC': 0.90, 'America East': 0.91, 'SoCon': 0.93, 'Sun Belt': 0.94,
        'MAC': 0.94, 'C-USA': 0.94, 'Big West': 0.93, 'ASUN': 0.92,
        'default': 0.95
    };

    // Scoring systems for bracket pools
    const SCORING_SYSTEMS = {
        standard: { name: 'Standard', points: [10, 20, 40, 80, 160, 320] },
        espn: { name: 'ESPN', points: [10, 20, 40, 80, 160, 320] },
        upset: { name: 'Upset Bonus', points: [10, 20, 40, 80, 160, 320], upsetMultiplier: true },
        seed: { name: 'Seed Weighted', points: [1, 2, 4, 8, 16, 32], seedMultiplier: true }
    };

    // Standard bracket matchup order (seed pairings for round 1)
    const BRACKET_ORDER = [
        [1, 16], [8, 9], [5, 12], [4, 13],
        [6, 11], [3, 14], [7, 10], [2, 15]
    ];

    const REGION_NAMES = ['East', 'West', 'South', 'Midwest'];

    const ROUND_NAMES = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
    const ROUND_SHORT = ['R64', 'R32', 'S16', 'E8', 'FF', 'CHAMP'];

    // 2026 NCAA Tournament teams — Official bracket from ESPN/NCAA
    // First Four play-in games (March 17-18): NC State/Texas (11), SMU/Miami OH (11), Howard/UMBC (16), Lehigh/Prairie View (16)
    const TOURNAMENT_2026 = {
        year: 2026,
        regions: {
            'East': [
                { name: 'Duke', seed: 1, conference: 'ACC', rating: 96 },
                { name: 'UConn', seed: 2, conference: 'Big East', rating: 92 },
                { name: 'Michigan State', seed: 3, conference: 'Big Ten', rating: 88 },
                { name: 'Kansas', seed: 4, conference: 'Big 12', rating: 86 },
                { name: "St. John's", seed: 5, conference: 'Big East', rating: 83 },
                { name: 'Louisville', seed: 6, conference: 'ACC', rating: 81 },
                { name: 'UCLA', seed: 7, conference: 'Big Ten', rating: 80 },
                { name: 'Ohio State', seed: 8, conference: 'Big Ten', rating: 78 },
                { name: 'TCU', seed: 9, conference: 'Big 12', rating: 77 },
                { name: 'UCF', seed: 10, conference: 'Big 12', rating: 76 },
                { name: 'South Florida', seed: 11, conference: 'AAC', rating: 74 },
                { name: 'Northern Iowa', seed: 12, conference: 'MVC', rating: 72 },
                { name: 'CA Baptist', seed: 13, conference: 'WAC', rating: 69 },
                { name: 'N Dakota State', seed: 14, conference: 'Summit', rating: 66 },
                { name: 'Furman', seed: 15, conference: 'SoCon', rating: 62 },
                { name: 'Siena', seed: 16, conference: 'MAAC', rating: 57 }
            ],
            'West': [
                { name: 'Arizona', seed: 1, conference: 'Big 12', rating: 95 },
                { name: 'Purdue', seed: 2, conference: 'Big Ten', rating: 91 },
                { name: 'Gonzaga', seed: 3, conference: 'WCC', rating: 87 },
                { name: 'Arkansas', seed: 4, conference: 'SEC', rating: 85 },
                { name: 'Wisconsin', seed: 5, conference: 'Big Ten', rating: 83 },
                { name: 'BYU', seed: 6, conference: 'Big 12', rating: 81 },
                { name: 'Miami', seed: 7, conference: 'ACC', rating: 79 },
                { name: 'Villanova', seed: 8, conference: 'Big East', rating: 78 },
                { name: 'Utah State', seed: 9, conference: 'MWC', rating: 76 },
                { name: 'Missouri', seed: 10, conference: 'SEC', rating: 75 },
                { name: 'NC State', seed: 11, conference: 'ACC', rating: 74 },
                { name: 'High Point', seed: 12, conference: 'Big South', rating: 71 },
                { name: "Hawai'i", seed: 13, conference: 'Big West', rating: 68 },
                { name: 'Kennesaw State', seed: 14, conference: 'ASUN', rating: 65 },
                { name: 'Queens', seed: 15, conference: 'ASUN', rating: 61 },
                { name: 'Long Island', seed: 16, conference: 'NEC', rating: 56 }
            ],
            'South': [
                { name: 'Florida', seed: 1, conference: 'SEC', rating: 95 },
                { name: 'Houston', seed: 2, conference: 'Big 12', rating: 92 },
                { name: 'Illinois', seed: 3, conference: 'Big Ten', rating: 87 },
                { name: 'Nebraska', seed: 4, conference: 'Big Ten', rating: 84 },
                { name: 'Vanderbilt', seed: 5, conference: 'SEC', rating: 82 },
                { name: 'North Carolina', seed: 6, conference: 'ACC', rating: 81 },
                { name: "Saint Mary's", seed: 7, conference: 'WCC', rating: 79 },
                { name: 'Clemson', seed: 8, conference: 'ACC', rating: 78 },
                { name: 'Iowa', seed: 9, conference: 'Big Ten', rating: 76 },
                { name: 'Texas A&M', seed: 10, conference: 'SEC', rating: 75 },
                { name: 'VCU', seed: 11, conference: 'A-10', rating: 73 },
                { name: 'McNeese', seed: 12, conference: 'Southland', rating: 71 },
                { name: 'Troy', seed: 13, conference: 'Sun Belt', rating: 68 },
                { name: 'Penn', seed: 14, conference: 'Ivy', rating: 65 },
                { name: 'Idaho', seed: 15, conference: 'Big Sky', rating: 61 },
                { name: 'Lehigh', seed: 16, conference: 'Patriot', rating: 56 }
            ],
            'Midwest': [
                { name: 'Michigan', seed: 1, conference: 'Big Ten', rating: 94 },
                { name: 'Iowa State', seed: 2, conference: 'Big 12', rating: 91 },
                { name: 'Virginia', seed: 3, conference: 'ACC', rating: 86 },
                { name: 'Alabama', seed: 4, conference: 'SEC', rating: 85 },
                { name: 'Texas Tech', seed: 5, conference: 'Big 12', rating: 82 },
                { name: 'Tennessee', seed: 6, conference: 'SEC', rating: 81 },
                { name: 'Kentucky', seed: 7, conference: 'SEC', rating: 80 },
                { name: 'Georgia', seed: 8, conference: 'SEC', rating: 77 },
                { name: 'Saint Louis', seed: 9, conference: 'A-10', rating: 76 },
                { name: 'Santa Clara', seed: 10, conference: 'WCC', rating: 74 },
                { name: 'SMU', seed: 11, conference: 'ACC', rating: 73 },
                { name: 'Akron', seed: 12, conference: 'MAC', rating: 70 },
                { name: 'Hofstra', seed: 13, conference: 'CAA', rating: 68 },
                { name: 'Wright State', seed: 14, conference: 'Horizon', rating: 65 },
                { name: 'Tennessee State', seed: 15, conference: 'OVC', rating: 61 },
                { name: 'Howard', seed: 16, conference: 'MEAC', rating: 56 }
            ]
        }
    };

    function getTeamsInBracketOrder(regionTeams) {
        const ordered = [];
        for (const [seedA, seedB] of BRACKET_ORDER) {
            const teamA = regionTeams.find(t => t.seed === seedA);
            const teamB = regionTeams.find(t => t.seed === seedB);
            if (teamA && teamB) ordered.push(teamA, teamB);
        }
        return ordered;
    }

    // Attempt to fetch live tournament data from ESPN public API
    async function fetchLiveData(year) {
        try {
            const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100&dates=${year}0315`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) return null;
            const data = await resp.json();
            // Parse ESPN data format (if available)
            if (data.events && data.events.length > 0) {
                return { source: 'espn', events: data.events, year };
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    return {
        ROUND1_HISTORICAL, SEED_STRENGTH, SEED_ROUND_REACH,
        SEED_MATCHUP_HISTORY, AVG_UPSETS_PER_ROUND,
        CONFERENCE_STRENGTH, SCORING_SYSTEMS,
        BRACKET_ORDER, REGION_NAMES, ROUND_NAMES, ROUND_SHORT,
        TOURNAMENT_2026, getTeamsInBracketOrder, fetchLiveData
    };
})();
