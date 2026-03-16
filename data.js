// ============================================================
// MARCH MADNESS DATA MODULE
// Historical probabilities, team data, and tournament structure
// ============================================================

const MarchMadnessData = (() => {

    // Historical seed win rates in Round 1 (1985-2024, ~40 years of data)
    // Source: NCAA tournament historical results
    const ROUND1_HISTORICAL = {
        '1v16': 0.994, '2v15': 0.944, '3v14': 0.852, '4v13': 0.792,
        '5v12': 0.647, '6v11': 0.622, '7v10': 0.608, '8v9': 0.515
    };

    // Seed strength ratings calibrated to historical tournament performance
    // These represent the "true strength" of each seed, used in log5 calculations
    const SEED_STRENGTH = {
        1: 0.920, 2: 0.860, 3: 0.790, 4: 0.740,
        5: 0.680, 6: 0.660, 7: 0.640, 8: 0.540,
        9: 0.460, 10: 0.420, 11: 0.400, 12: 0.380,
        13: 0.300, 14: 0.250, 15: 0.180, 16: 0.060
    };

    // Historical probability of each seed reaching each round
    // (percentage of teams with that seed that reach each round)
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

    // Conference strength multipliers (affects predictions slightly)
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

    // Standard bracket matchup order (seed pairings for round 1)
    const BRACKET_ORDER = [
        [1, 16], [8, 9], [5, 12], [4, 13],
        [6, 11], [3, 14], [7, 10], [2, 15]
    ];

    // Region names
    const REGION_NAMES = ['East', 'West', 'South', 'Midwest'];

    // 2025 NCAA Tournament teams (most recent complete tournament data)
    // This data auto-loads as fallback; users can fetch current year or enter manually
    const TOURNAMENT_2025 = {
        year: 2025,
        regions: {
            'East': [
                { name: 'Duke', seed: 1, conference: 'ACC', rating: 94 },
                { name: 'Alabama', seed: 2, conference: 'SEC', rating: 90 },
                { name: 'Wisconsin', seed: 3, conference: 'Big Ten', rating: 87 },
                { name: 'Arizona', seed: 4, conference: 'Big 12', rating: 85 },
                { name: 'Oregon', seed: 5, conference: 'Big Ten', rating: 83 },
                { name: 'BYU', seed: 6, conference: 'Big 12', rating: 81 },
                { name: "St. Mary's", seed: 7, conference: 'WCC', rating: 79 },
                { name: 'UConn', seed: 8, conference: 'Big East', rating: 78 },
                { name: 'Oklahoma', seed: 9, conference: 'SEC', rating: 77 },
                { name: 'Arkansas', seed: 10, conference: 'SEC', rating: 76 },
                { name: 'Drake', seed: 11, conference: 'MVC', rating: 74 },
                { name: 'Liberty', seed: 12, conference: 'ASUN', rating: 73 },
                { name: 'Yale', seed: 13, conference: 'Ivy', rating: 70 },
                { name: 'Lipscomb', seed: 14, conference: 'ASUN', rating: 67 },
                { name: 'Robert Morris', seed: 15, conference: 'Horizon', rating: 63 },
                { name: 'American', seed: 16, conference: 'Patriot', rating: 58 }
            ],
            'West': [
                { name: 'Houston', seed: 1, conference: 'Big 12', rating: 95 },
                { name: 'Tennessee', seed: 2, conference: 'SEC', rating: 91 },
                { name: 'Kentucky', seed: 3, conference: 'SEC', rating: 86 },
                { name: 'Purdue', seed: 4, conference: 'Big Ten', rating: 84 },
                { name: 'Clemson', seed: 5, conference: 'ACC', rating: 82 },
                { name: 'Illinois', seed: 6, conference: 'Big Ten', rating: 80 },
                { name: 'UCLA', seed: 7, conference: 'Big Ten', rating: 79 },
                { name: 'Gonzaga', seed: 8, conference: 'WCC', rating: 78 },
                { name: 'Georgia', seed: 9, conference: 'SEC', rating: 76 },
                { name: 'Texas Tech', seed: 10, conference: 'Big 12', rating: 75 },
                { name: 'NC State', seed: 11, conference: 'ACC', rating: 74 },
                { name: 'McNeese', seed: 12, conference: 'Southland', rating: 72 },
                { name: 'High Point', seed: 13, conference: 'Big South', rating: 69 },
                { name: 'Troy', seed: 14, conference: 'Sun Belt', rating: 66 },
                { name: 'Omaha', seed: 15, conference: 'Summit', rating: 62 },
                { name: 'SIU Edwardsville', seed: 16, conference: 'OVC', rating: 57 }
            ],
            'South': [
                { name: 'Auburn', seed: 1, conference: 'SEC', rating: 96 },
                { name: 'Michigan State', seed: 2, conference: 'Big Ten', rating: 89 },
                { name: 'Iowa State', seed: 3, conference: 'Big 12', rating: 87 },
                { name: 'Texas A&M', seed: 4, conference: 'SEC', rating: 84 },
                { name: 'Michigan', seed: 5, conference: 'Big Ten', rating: 82 },
                { name: 'Missouri', seed: 6, conference: 'SEC', rating: 80 },
                { name: 'Marquette', seed: 7, conference: 'Big East', rating: 79 },
                { name: 'Louisville', seed: 8, conference: 'ACC', rating: 77 },
                { name: 'Creighton', seed: 9, conference: 'Big East', rating: 76 },
                { name: 'New Mexico', seed: 10, conference: 'MWC', rating: 75 },
                { name: 'VCU', seed: 11, conference: 'A-10', rating: 73 },
                { name: 'UC San Diego', seed: 12, conference: 'Big West', rating: 71 },
                { name: 'Vermont', seed: 13, conference: 'America East', rating: 69 },
                { name: 'Samford', seed: 14, conference: 'SoCon', rating: 66 },
                { name: 'Grambling', seed: 15, conference: 'SWAC', rating: 61 },
                { name: 'Longwood', seed: 16, conference: 'Big South', rating: 56 }
            ],
            'Midwest': [
                { name: 'Florida', seed: 1, conference: 'SEC', rating: 93 },
                { name: 'St. Johns', seed: 2, conference: 'Big East', rating: 89 },
                { name: 'Baylor', seed: 3, conference: 'Big 12', rating: 86 },
                { name: 'Maryland', seed: 4, conference: 'Big Ten', rating: 84 },
                { name: 'Memphis', seed: 5, conference: 'AAC', rating: 81 },
                { name: 'Kansas', seed: 6, conference: 'Big 12', rating: 80 },
                { name: 'Nevada', seed: 7, conference: 'MWC', rating: 78 },
                { name: 'San Diego State', seed: 8, conference: 'MWC', rating: 77 },
                { name: 'Boise State', seed: 9, conference: 'MWC', rating: 76 },
                { name: 'Vanderbilt', seed: 10, conference: 'SEC', rating: 75 },
                { name: 'Texas', seed: 11, conference: 'SEC', rating: 74 },
                { name: 'Colorado State', seed: 12, conference: 'MWC', rating: 72 },
                { name: 'Grand Canyon', seed: 13, conference: 'WAC', rating: 70 },
                { name: 'Colgate', seed: 14, conference: 'Patriot', rating: 67 },
                { name: 'Montana State', seed: 15, conference: 'Big Sky', rating: 63 },
                { name: 'Norfolk State', seed: 16, conference: 'MEAC', rating: 57 }
            ]
        }
    };

    // Get teams arranged in bracket matchup order for a region
    function getTeamsInBracketOrder(regionTeams) {
        const ordered = [];
        for (const [seedA, seedB] of BRACKET_ORDER) {
            const teamA = regionTeams.find(t => t.seed === seedA);
            const teamB = regionTeams.find(t => t.seed === seedB);
            if (teamA && teamB) {
                ordered.push(teamA, teamB);
            }
        }
        return ordered;
    }

    return {
        ROUND1_HISTORICAL,
        SEED_STRENGTH,
        SEED_ROUND_REACH,
        CONFERENCE_STRENGTH,
        BRACKET_ORDER,
        REGION_NAMES,
        TOURNAMENT_2025,
        getTeamsInBracketOrder
    };
})();
