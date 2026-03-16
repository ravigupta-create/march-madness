// ============================================================
// MARCH MADNESS APP — Main UI Logic
// Bracket rendering, interaction, analysis display
// ============================================================

const App = (() => {
    // State
    let tournamentData = null;
    let botBracket = null;
    let currentView = 'bracket';
    let activeRegion = 0;

    // User bracket state: for each region, an array of rounds;
    // each round is an array of winners (team objects or null)
    let userBracket = {
        regions: {},
        finalFour: { game1: {}, game2: {} },
        championship: {}
    };

    let totalPicks = 0;
    const TOTAL_GAMES = 63;

    // Sound effects using Web Audio
    let audioCtx = null;
    function playClick() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.08;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.stop(audioCtx.currentTime + 0.08);
    }

    function playAdvance() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'triangle';
        osc.frequency.value = 523;
        gain.gain.value = 0.1;
        osc.start();
        osc.frequency.exponentialRampToValueAtTime(784, audioCtx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        osc.stop(audioCtx.currentTime + 0.2);
    }

    function playChampion() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [523, 659, 784, 1047];
        notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.value = 0.12;
            osc.start(audioCtx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.15 + 0.3);
            osc.stop(audioCtx.currentTime + i * 0.15 + 0.3);
        });
    }

    // Initialize
    function init() {
        const year = new Date().getFullYear();
        document.getElementById('year-badge').textContent = year;
        document.title = `March Madness ${year} Bracket`;

        // Load tournament data (use 2025 as fallback)
        tournamentData = MarchMadnessData.TOURNAMENT_2025;

        // Generate bot bracket
        botBracket = PredictionEngine.generateBotBracket(tournamentData);

        // Initialize user bracket structure
        initUserBracket();

        // Load saved bracket from localStorage
        loadBracket();

        // Render
        setupNav();
        setupRegionTabs();
        renderBracket();
        renderFinalFour();
        renderBotBracket();
        setupControls();
        initBackground();
        updateProgress();
    }

    function initUserBracket() {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const teams = tournamentData.regions[regionName];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
            userBracket.regions[regionName] = [
                new Array(8).fill(null),  // Round 1 winners
                new Array(4).fill(null),  // Round 2 winners
                new Array(2).fill(null),  // Sweet 16 winners
                new Array(1).fill(null),  // Elite 8 winner
            ];
        }
        userBracket.finalFour = {
            game1: { teamA: null, teamB: null, winner: null },
            game2: { teamA: null, teamB: null, winner: null }
        };
        userBracket.championship = { teamA: null, teamB: null, winner: null };
    }

    // Navigation
    function setupNav() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const view = btn.dataset.view;
                switchView(view);
            });
        });
    }

    function switchView(view) {
        currentView = view;
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));

        if (view === 'analysis') renderAnalysis();
        if (view === 'h2h') renderH2H();
    }

    // Region tabs
    function setupRegionTabs() {
        const container = document.getElementById('region-tabs');
        const names = [...MarchMadnessData.REGION_NAMES, 'Final Four'];
        names.forEach((name, i) => {
            const btn = document.createElement('button');
            btn.className = `region-tab${i === 0 ? ' active' : ''}`;
            btn.textContent = name;
            btn.addEventListener('click', () => {
                activeRegion = i;
                container.querySelectorAll('.region-tab').forEach(t => t.classList.remove('active'));
                btn.classList.add('active');
                showRegion(i);
            });
            container.appendChild(btn);
        });
    }

    function showRegion(index) {
        document.querySelectorAll('.bracket-region').forEach((r, i) => {
            r.classList.toggle('active', i === index);
        });
        const ffSection = document.getElementById('final-four-section');
        if (index === 4) {
            ffSection.classList.add('active');
            document.querySelectorAll('.bracket-region').forEach(r => r.classList.remove('active'));
        } else {
            ffSection.classList.remove('active');
        }
    }

    // Render bracket
    function renderBracket() {
        const container = document.getElementById('bracket-container');
        container.innerHTML = '';

        MarchMadnessData.REGION_NAMES.forEach((regionName, ri) => {
            const regionEl = document.createElement('div');
            regionEl.className = `bracket-region${ri === 0 ? ' active' : ''}`;
            regionEl.dataset.region = regionName;

            const teams = tournamentData.regions[regionName];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);

            const roundNames = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8'];
            const matchupsPerRound = [8, 4, 2, 1];

            for (let round = 0; round < 4; round++) {
                const roundEl = document.createElement('div');
                roundEl.className = 'bracket-round';

                const header = document.createElement('div');
                header.className = 'round-header';
                header.textContent = roundNames[round];
                roundEl.appendChild(header);

                for (let m = 0; m < matchupsPerRound[round]; m++) {
                    const matchup = document.createElement('div');
                    matchup.className = 'matchup';

                    const pair = document.createElement('div');
                    pair.className = 'matchup-pair';

                    // Get the two teams for this matchup
                    let teamA, teamB;
                    if (round === 0) {
                        teamA = ordered[m * 2];
                        teamB = ordered[m * 2 + 1];
                    } else {
                        // Get from previous round winners
                        teamA = userBracket.regions[regionName][round - 1][m * 2] || null;
                        teamB = userBracket.regions[regionName][round - 1][m * 2 + 1] || null;
                    }

                    const winner = userBracket.regions[regionName][round][m];

                    // Team A slot
                    pair.appendChild(createTeamSlot(teamA, winner, regionName, round, m, 0, teamB));
                    // Team B slot
                    pair.appendChild(createTeamSlot(teamB, winner, regionName, round, m, 1, teamA));

                    matchup.appendChild(pair);
                    roundEl.appendChild(matchup);
                }

                regionEl.appendChild(roundEl);
            }

            container.appendChild(regionEl);
        });
    }

    function createTeamSlot(team, winner, regionName, round, matchupIdx, slotIdx, opponent) {
        const slot = document.createElement('div');
        slot.className = 'team-slot';

        if (!team) {
            slot.classList.add('empty');
            slot.innerHTML = '<span class="team-name">—</span>';
            return slot;
        }

        const isWinner = winner && winner.name === team.name;
        const isEliminated = winner && winner.name !== team.name;

        if (isWinner) slot.classList.add('winner');
        if (isEliminated) slot.classList.add('eliminated');

        // Seed badge
        const seedEl = document.createElement('span');
        seedEl.className = 'team-seed';
        seedEl.textContent = team.seed;

        // Team name
        const nameEl = document.createElement('span');
        nameEl.className = 'team-name';
        nameEl.textContent = team.name;

        // Win probability
        if (opponent) {
            const prob = PredictionEngine.getWinProbability(team, opponent);
            const probEl = document.createElement('span');
            probEl.className = 'team-prob';
            const pct = (prob * 100).toFixed(0);
            probEl.textContent = `${pct}%`;
            if (prob >= 0.7) probEl.classList.add('safe');
            else if (prob >= 0.45) probEl.classList.add('moderate');
            else if (prob >= 0.25) probEl.classList.add('risky');
            else probEl.classList.add('longshot');
            slot.appendChild(seedEl);
            slot.appendChild(nameEl);
            slot.appendChild(probEl);
        } else {
            slot.appendChild(seedEl);
            slot.appendChild(nameEl);
        }

        // Click handler
        slot.addEventListener('click', () => {
            if (!team) return;
            selectWinner(regionName, round, matchupIdx, team);
            playClick();
        });

        // Tooltip on hover
        slot.addEventListener('mouseenter', (e) => {
            if (team && opponent) {
                showTooltip(e, team, opponent);
            }
        });
        slot.addEventListener('mouseleave', hideTooltip);

        return slot;
    }

    function selectWinner(regionName, round, matchupIdx, team) {
        const regionRounds = userBracket.regions[regionName];
        const prevWinner = regionRounds[round][matchupIdx];

        // Set winner
        regionRounds[round][matchupIdx] = team;

        // If winner changed, clear downstream picks that depended on the old winner
        if (prevWinner && prevWinner.name !== team.name) {
            clearDownstream(regionName, round, matchupIdx, prevWinner);
        }

        // Propagate to next round
        if (round < 3) {
            // Nothing to propagate here - next round matchup auto-picks up the winner
        }

        // Update Final Four teams
        updateFinalFourTeams();

        // Re-render and save
        renderBracket();
        renderFinalFour();
        updateProgress();
        saveBracket();
        showRegion(activeRegion);
    }

    function clearDownstream(regionName, round, matchupIdx, oldTeam) {
        const regionRounds = userBracket.regions[regionName];
        // Clear subsequent rounds if they had the old team
        for (let r = round + 1; r < 4; r++) {
            for (let m = 0; m < regionRounds[r].length; m++) {
                if (regionRounds[r][m] && regionRounds[r][m].name === oldTeam.name) {
                    regionRounds[r][m] = null;
                }
            }
        }

        // Clear Final Four / Championship if affected
        const ff = userBracket.finalFour;
        const champ = userBracket.championship;
        if (ff.game1.teamA?.name === oldTeam.name) ff.game1.teamA = null;
        if (ff.game1.teamB?.name === oldTeam.name) ff.game1.teamB = null;
        if (ff.game1.winner?.name === oldTeam.name) ff.game1.winner = null;
        if (ff.game2.teamA?.name === oldTeam.name) ff.game2.teamA = null;
        if (ff.game2.teamB?.name === oldTeam.name) ff.game2.teamB = null;
        if (ff.game2.winner?.name === oldTeam.name) ff.game2.winner = null;
        if (champ.teamA?.name === oldTeam.name) champ.teamA = null;
        if (champ.teamB?.name === oldTeam.name) champ.teamB = null;
        if (champ.winner?.name === oldTeam.name) champ.winner = null;
    }

    function updateFinalFourTeams() {
        const regions = MarchMadnessData.REGION_NAMES;
        const ff = userBracket.finalFour;

        // Game 1: Region 0 winner vs Region 1 winner
        ff.game1.teamA = userBracket.regions[regions[0]]?.[3]?.[0] || null;
        ff.game1.teamB = userBracket.regions[regions[1]]?.[3]?.[0] || null;

        // Game 2: Region 2 winner vs Region 3 winner
        ff.game2.teamA = userBracket.regions[regions[2]]?.[3]?.[0] || null;
        ff.game2.teamB = userBracket.regions[regions[3]]?.[3]?.[0] || null;

        // Update championship teams
        userBracket.championship.teamA = ff.game1.winner || null;
        userBracket.championship.teamB = ff.game2.winner || null;

        // Validate FF winners still valid
        if (ff.game1.winner) {
            if ((!ff.game1.teamA || ff.game1.winner.name !== ff.game1.teamA.name) &&
                (!ff.game1.teamB || ff.game1.winner.name !== ff.game1.teamB.name)) {
                ff.game1.winner = null;
                userBracket.championship.teamA = null;
            }
        }
        if (ff.game2.winner) {
            if ((!ff.game2.teamA || ff.game2.winner.name !== ff.game2.teamA.name) &&
                (!ff.game2.teamB || ff.game2.winner.name !== ff.game2.teamB.name)) {
                ff.game2.winner = null;
                userBracket.championship.teamB = null;
            }
        }
        if (userBracket.championship.winner) {
            if ((!userBracket.championship.teamA || userBracket.championship.winner.name !== userBracket.championship.teamA.name) &&
                (!userBracket.championship.teamB || userBracket.championship.winner.name !== userBracket.championship.teamB.name)) {
                userBracket.championship.winner = null;
            }
        }
    }

    // Final Four rendering
    function renderFinalFour() {
        const gamesEl = document.getElementById('ff-games');
        const champGameEl = document.getElementById('championship-game');
        gamesEl.innerHTML = '';
        champGameEl.innerHTML = '';

        const ff = userBracket.finalFour;
        const regions = MarchMadnessData.REGION_NAMES;

        // Game 1
        gamesEl.appendChild(createFFGame(ff.game1, `${regions[0]} vs ${regions[1]}`, 'ff1'));
        // Game 2
        gamesEl.appendChild(createFFGame(ff.game2, `${regions[2]} vs ${regions[3]}`, 'ff2'));

        // Championship
        const champLabel = document.createElement('div');
        champLabel.style.cssText = 'font-size:1.1rem;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--accent-gold);margin-bottom:8px;text-align:center;';
        champLabel.textContent = 'Championship';
        champGameEl.appendChild(champLabel);
        champGameEl.appendChild(createFFGame(userBracket.championship, 'National Championship', 'champ'));

        // Champion display
        const champDisplay = document.getElementById('champion-display');
        if (userBracket.championship.winner) {
            champDisplay.style.display = 'block';
            document.getElementById('champ-name').textContent = userBracket.championship.winner.name;
            document.getElementById('champ-seed').textContent = `#${userBracket.championship.winner.seed} Seed`;
        } else {
            champDisplay.style.display = 'none';
        }
    }

    function createFFGame(game, label, id) {
        const container = document.createElement('div');
        container.className = 'ff-game';

        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'text-align:center;font-size:0.7rem;font-weight:700;color:var(--text-muted);padding:6px 8px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);';
        labelEl.textContent = label;
        container.appendChild(labelEl);

        // Team A
        const slotA = document.createElement('div');
        slotA.className = 'team-slot';
        if (!game.teamA) {
            slotA.classList.add('empty');
            slotA.innerHTML = '<span class="team-name">TBD</span>';
        } else {
            if (game.winner?.name === game.teamA.name) slotA.classList.add('winner');
            if (game.winner && game.winner.name !== game.teamA.name) slotA.classList.add('eliminated');
            slotA.innerHTML = `<span class="team-seed">${game.teamA.seed}</span><span class="team-name">${game.teamA.name}</span>`;
            if (game.teamB) {
                const prob = PredictionEngine.getWinProbability(game.teamA, game.teamB);
                const pct = (prob * 100).toFixed(0);
                const cls = prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot';
                slotA.innerHTML += `<span class="team-prob ${cls}">${pct}%</span>`;
            }
            slotA.addEventListener('click', () => {
                selectFFWinner(id, game.teamA);
            });
        }
        slotA.style.borderBottom = '1px solid var(--border)';
        container.appendChild(slotA);

        // Team B
        const slotB = document.createElement('div');
        slotB.className = 'team-slot';
        if (!game.teamB) {
            slotB.classList.add('empty');
            slotB.innerHTML = '<span class="team-name">TBD</span>';
        } else {
            if (game.winner?.name === game.teamB.name) slotB.classList.add('winner');
            if (game.winner && game.winner.name !== game.teamB.name) slotB.classList.add('eliminated');
            slotB.innerHTML = `<span class="team-seed">${game.teamB.seed}</span><span class="team-name">${game.teamB.name}</span>`;
            if (game.teamA) {
                const prob = PredictionEngine.getWinProbability(game.teamB, game.teamA);
                const pct = (prob * 100).toFixed(0);
                const cls = prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot';
                slotB.innerHTML += `<span class="team-prob ${cls}">${pct}%</span>`;
            }
            slotB.addEventListener('click', () => {
                selectFFWinner(id, game.teamB);
            });
        }
        container.appendChild(slotB);

        return container;
    }

    function selectFFWinner(gameId, team) {
        playClick();
        const ff = userBracket.finalFour;
        const champ = userBracket.championship;

        if (gameId === 'ff1') {
            const old = ff.game1.winner;
            ff.game1.winner = team;
            champ.teamA = team;
            if (old && old.name !== team.name && champ.winner?.name === old.name) {
                champ.winner = null;
            }
        } else if (gameId === 'ff2') {
            const old = ff.game2.winner;
            ff.game2.winner = team;
            champ.teamB = team;
            if (old && old.name !== team.name && champ.winner?.name === old.name) {
                champ.winner = null;
            }
        } else if (gameId === 'champ') {
            champ.winner = team;
            playChampion();
            launchConfetti();
        }

        renderFinalFour();
        updateProgress();
        saveBracket();
    }

    // Controls
    function setupControls() {
        document.getElementById('btn-reset').addEventListener('click', () => {
            if (confirm('Reset entire bracket? This cannot be undone.')) {
                initUserBracket();
                renderBracket();
                renderFinalFour();
                updateProgress();
                saveBracket();
                showRegion(activeRegion);
                showToast('Bracket reset');
            }
        });

        document.getElementById('btn-randomize').addEventListener('click', () => {
            randomizeBracket();
            showToast('Bracket randomized!');
        });

        document.getElementById('btn-autofill').addEventListener('click', () => {
            autoFillBracket();
            showToast('Bracket auto-filled with probable picks');
        });
    }

    function randomizeBracket() {
        initUserBracket();

        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const teams = tournamentData.regions[regionName];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
            const rounds = userBracket.regions[regionName];

            // Round 1
            for (let m = 0; m < 8; m++) {
                const tA = ordered[m * 2];
                const tB = ordered[m * 2 + 1];
                const prob = PredictionEngine.getWinProbability(tA, tB);
                rounds[0][m] = Math.random() < prob ? tA : tB;
            }

            // Rounds 2-4
            for (let r = 1; r < 4; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    const tA = rounds[r - 1][m * 2];
                    const tB = rounds[r - 1][m * 2 + 1];
                    if (tA && tB) {
                        const prob = PredictionEngine.getWinProbability(tA, tB);
                        rounds[r][m] = Math.random() < prob ? tA : tB;
                    }
                }
            }
        }

        updateFinalFourTeams();

        // Final Four
        const ff = userBracket.finalFour;
        if (ff.game1.teamA && ff.game1.teamB) {
            const p = PredictionEngine.getWinProbability(ff.game1.teamA, ff.game1.teamB);
            ff.game1.winner = Math.random() < p ? ff.game1.teamA : ff.game1.teamB;
            userBracket.championship.teamA = ff.game1.winner;
        }
        if (ff.game2.teamA && ff.game2.teamB) {
            const p = PredictionEngine.getWinProbability(ff.game2.teamA, ff.game2.teamB);
            ff.game2.winner = Math.random() < p ? ff.game2.teamA : ff.game2.teamB;
            userBracket.championship.teamB = ff.game2.winner;
        }
        if (userBracket.championship.teamA && userBracket.championship.teamB) {
            const p = PredictionEngine.getWinProbability(userBracket.championship.teamA, userBracket.championship.teamB);
            userBracket.championship.winner = Math.random() < p ? userBracket.championship.teamA : userBracket.championship.teamB;
        }

        renderBracket();
        renderFinalFour();
        updateProgress();
        saveBracket();
        showRegion(activeRegion);
    }

    function autoFillBracket() {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const teams = tournamentData.regions[regionName];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
            const rounds = userBracket.regions[regionName];

            // Round 1 - fill empty
            for (let m = 0; m < 8; m++) {
                if (!rounds[0][m]) {
                    const tA = ordered[m * 2];
                    const tB = ordered[m * 2 + 1];
                    const prob = PredictionEngine.getWinProbability(tA, tB);
                    rounds[0][m] = prob >= 0.5 ? tA : tB;
                }
            }

            // Rounds 2-4
            for (let r = 1; r < 4; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    if (!rounds[r][m]) {
                        const tA = rounds[r - 1][m * 2];
                        const tB = rounds[r - 1][m * 2 + 1];
                        if (tA && tB) {
                            const prob = PredictionEngine.getWinProbability(tA, tB);
                            rounds[r][m] = prob >= 0.5 ? tA : tB;
                        }
                    }
                }
            }
        }

        updateFinalFourTeams();

        const ff = userBracket.finalFour;
        if (!ff.game1.winner && ff.game1.teamA && ff.game1.teamB) {
            const p = PredictionEngine.getWinProbability(ff.game1.teamA, ff.game1.teamB);
            ff.game1.winner = p >= 0.5 ? ff.game1.teamA : ff.game1.teamB;
            userBracket.championship.teamA = ff.game1.winner;
        }
        if (!ff.game2.winner && ff.game2.teamA && ff.game2.teamB) {
            const p = PredictionEngine.getWinProbability(ff.game2.teamA, ff.game2.teamB);
            ff.game2.winner = p >= 0.5 ? ff.game2.teamA : ff.game2.teamB;
            userBracket.championship.teamB = ff.game2.winner;
        }
        if (!userBracket.championship.winner && userBracket.championship.teamA && userBracket.championship.teamB) {
            const p = PredictionEngine.getWinProbability(userBracket.championship.teamA, userBracket.championship.teamB);
            userBracket.championship.winner = p >= 0.5 ? userBracket.championship.teamA : userBracket.championship.teamB;
        }

        renderBracket();
        renderFinalFour();
        updateProgress();
        saveBracket();
        showRegion(activeRegion);
    }

    // Progress tracking
    function updateProgress() {
        let count = 0;
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const rounds = userBracket.regions[regionName];
            for (const round of rounds) {
                count += round.filter(w => w !== null).length;
            }
        }
        if (userBracket.finalFour.game1.winner) count++;
        if (userBracket.finalFour.game2.winner) count++;
        if (userBracket.championship.winner) count++;

        totalPicks = count;
        const pct = (count / TOTAL_GAMES) * 100;
        document.getElementById('progress-fill').style.width = `${pct}%`;
        document.getElementById('progress-text').textContent = `${count} / ${TOTAL_GAMES}`;
    }

    // Tooltip
    function showTooltip(e, teamA, teamB) {
        const tip = document.getElementById('tooltip');
        const insight = PredictionEngine.getMatchupInsight(teamA, teamB);

        tip.querySelector('.tip-matchup').textContent = `(${teamA.seed}) ${teamA.name} vs (${teamB.seed}) ${teamB.name}`;
        tip.querySelector('.tip-prob').textContent = `${insight.favorite.name} favored: ${(insight.probability * 100).toFixed(1)}%`;
        tip.querySelector('.tip-note').textContent = insight.historicalNote || insight.insight;

        tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 300)}px`;
        tip.style.top = `${Math.min(e.clientY + 12, window.innerHeight - 120)}px`;
        tip.classList.add('visible');
    }

    function hideTooltip() {
        document.getElementById('tooltip').classList.remove('visible');
    }

    // Toast
    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // Confetti
    function launchConfetti() {
        const container = document.getElementById('confetti-container');
        const colors = ['#ff6b35', '#4ecdc4', '#ffd700', '#a855f7', '#22c55e', '#ef4444'];
        for (let i = 0; i < 80; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = `${Math.random() * 100}%`;
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = `${2 + Math.random() * 2}s`;
            piece.style.animationDelay = `${Math.random() * 0.5}s`;
            piece.style.width = `${6 + Math.random() * 8}px`;
            piece.style.height = `${6 + Math.random() * 8}px`;
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '0';
            container.appendChild(piece);
        }
        setTimeout(() => { container.innerHTML = ''; }, 4000);
    }

    // Render Bot Bracket
    function renderBotBracket() {
        const grid = document.getElementById('bot-picks-grid');
        grid.innerHTML = '';

        const roundNames = ['R64', 'R32', 'S16', 'E8'];

        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const card = document.createElement('div');
            card.className = 'bot-region-card';

            const h4 = document.createElement('h4');
            h4.textContent = `${regionName} Region`;
            card.appendChild(h4);

            const regionData = botBracket[regionName];
            for (const game of regionData.games) {
                const row = document.createElement('div');
                row.className = 'bot-pick-row';

                const roundEl = document.createElement('span');
                roundEl.className = 'bot-pick-round';
                roundEl.textContent = roundNames[game.round - 1];

                const winnerEl = document.createElement('span');
                winnerEl.className = 'bot-pick-winner';
                winnerEl.textContent = `(${game.winner.seed}) ${game.winner.name}`;
                if (game.isUpset) winnerEl.style.color = 'var(--accent-orange)';

                const vsEl = document.createElement('span');
                vsEl.style.cssText = 'font-size:0.65rem;color:var(--text-muted);';
                vsEl.textContent = `over (${game.winner === game.teamA ? game.teamB.seed : game.teamA.seed}) ${game.winner === game.teamA ? game.teamB.name : game.teamA.name}`;

                const probEl = document.createElement('span');
                probEl.className = 'bot-pick-prob';
                probEl.textContent = `${(game.probability * 100).toFixed(0)}%`;
                probEl.style.color = game.probability >= 0.7 ? 'var(--safe)' : game.probability >= 0.45 ? 'var(--moderate)' : 'var(--danger)';

                row.appendChild(roundEl);
                row.appendChild(winnerEl);
                row.appendChild(vsEl);
                row.appendChild(probEl);
                card.appendChild(row);
            }

            // Region champion
            const champRow = document.createElement('div');
            champRow.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid var(--border);text-align:center;font-weight:700;color:var(--accent-gold);font-size:0.85rem;';
            champRow.textContent = `Region Winner: (${regionData.champion.seed}) ${regionData.champion.name}`;
            card.appendChild(champRow);

            grid.appendChild(card);
        }

        // Bot Final Four display
        const ffDisplay = document.getElementById('bot-ff-display');
        ffDisplay.innerHTML = '';
        const ffGames = document.createElement('div');
        ffGames.className = 'final-four-games';

        const g1 = botBracket.finalFour.game1;
        const g2 = botBracket.finalFour.game2;
        const ch = botBracket.championship;

        ffGames.innerHTML = `
            <div class="ff-game">
                <div style="text-align:center;font-size:0.7rem;font-weight:700;color:var(--text-muted);padding:6px;border-bottom:1px solid var(--border);">SEMIFINAL 1</div>
                <div class="team-slot ${g1.winner.name === g1.teamA.name ? 'winner' : 'eliminated'}" style="border-bottom:1px solid var(--border);">
                    <span class="team-seed">${g1.teamA.seed}</span><span class="team-name">${g1.teamA.name}</span>
                </div>
                <div class="team-slot ${g1.winner.name === g1.teamB.name ? 'winner' : 'eliminated'}">
                    <span class="team-seed">${g1.teamB.seed}</span><span class="team-name">${g1.teamB.name}</span>
                </div>
            </div>
            <div class="ff-game">
                <div style="text-align:center;font-size:0.7rem;font-weight:700;color:var(--text-muted);padding:6px;border-bottom:1px solid var(--border);">SEMIFINAL 2</div>
                <div class="team-slot ${g2.winner.name === g2.teamA.name ? 'winner' : 'eliminated'}" style="border-bottom:1px solid var(--border);">
                    <span class="team-seed">${g2.teamA.seed}</span><span class="team-name">${g2.teamA.name}</span>
                </div>
                <div class="team-slot ${g2.winner.name === g2.teamB.name ? 'winner' : 'eliminated'}">
                    <span class="team-seed">${g2.teamB.seed}</span><span class="team-name">${g2.teamB.name}</span>
                </div>
            </div>
        `;
        ffDisplay.appendChild(ffGames);

        const champDiv = document.createElement('div');
        champDiv.className = 'champion-display';
        champDiv.style.marginTop = '16px';
        champDiv.innerHTML = `
            <div class="label">Bot's National Champion</div>
            <div class="champ-name">${ch.winner.name}</div>
            <div class="champ-seed">#${ch.winner.seed} Seed — ${(ch.probability * 100).toFixed(1)}% win probability</div>
        `;
        ffDisplay.appendChild(champDiv);
    }

    // Render Analysis
    function renderAnalysis() {
        const container = document.getElementById('analysis-content');

        if (totalPicks < 1) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">📊</div>
                    <h3>Fill in your bracket first</h3>
                    <p>Complete at least a few picks in "My Bracket" to see your analysis.</p>
                </div>`;
            return;
        }

        const analysis = PredictionEngine.analyzeUserBracket(userBracket, tournamentData);

        const riskColor = analysis.bracketScore >= 70 ? 'var(--safe)' : analysis.bracketScore >= 40 ? 'var(--moderate)' : 'var(--danger)';
        const riskMeterClass = analysis.bracketScore >= 70 ? 'safe' : analysis.bracketScore >= 40 ? 'moderate' : 'risky';

        container.innerHTML = `
            <div class="analysis-grid">
                <div class="analysis-card">
                    <h3>Bracket Score</h3>
                    <div style="text-align:center;padding:10px 0;">
                        <div class="stat-value score">${analysis.bracketScore.toFixed(1)}</div>
                        <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">out of 100 (higher = more probable)</div>
                    </div>
                    <div class="meter"><div class="meter-fill ${riskMeterClass}" style="width:${analysis.bracketScore}%"></div></div>
                    <div class="stat-row" style="margin-top:12px;">
                        <span class="stat-label">Overall Probability</span>
                        <span class="stat-value" style="font-size:0.85rem;">${analysis.overallProbability.toExponential(2)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Picks Made</span>
                        <span class="stat-value" style="font-size:0.85rem;">${analysis.totalFilled} / ${TOTAL_GAMES}</span>
                    </div>
                </div>

                <div class="analysis-card">
                    <h3>Risk Profile</h3>
                    <div class="stat-row">
                        <span class="stat-label">Risk Level</span>
                        <span class="stat-value" style="font-size:0.9rem;color:${riskColor};">${analysis.riskLevel}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Upsets</span>
                        <span class="stat-value" style="font-size:0.9rem;">${analysis.upsetCount}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Safe Picks (>70%)</span>
                        <span class="stat-value" style="font-size:0.9rem;color:var(--safe);">${analysis.picks.filter(p => p.riskCategory === 'safe').length}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Moderate (45-70%)</span>
                        <span class="stat-value" style="font-size:0.9rem;color:var(--moderate);">${analysis.picks.filter(p => p.riskCategory === 'moderate').length}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Risky (<45%)</span>
                        <span class="stat-value" style="font-size:0.9rem;color:var(--danger);">${analysis.picks.filter(p => p.riskCategory === 'risky').length + analysis.picks.filter(p => p.riskCategory === 'longshot').length}</span>
                    </div>
                </div>

                <div class="analysis-card full-width">
                    <h3>Suggestions</h3>
                    ${analysis.suggestions.length === 0 ? '<p style="color:var(--text-secondary);font-size:0.82rem;">No suggestions yet — keep filling in your bracket!</p>' :
                    analysis.suggestions.map(s => `
                        <div class="suggestion-item ${s.type}">
                            <span class="suggestion-icon">${s.type === 'risk' ? '⚠' : s.type === 'strategy' ? '💡' : 'ℹ'}</span>
                            <span class="suggestion-text">${s.message}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="analysis-card full-width">
                    <h3>All Picks by Risk</h3>
                    <div class="pick-list">
                        ${analysis.picks.sort((a, b) => a.probability - b.probability).map(p => {
                            const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'FF', 6: 'CH' };
                            return `
                            <div class="pick-item">
                                <span class="round-badge">${roundNames[p.round]}</span>
                                <span style="font-weight:600;">(${p.winner.seed}) ${p.winner.name}</span>
                                <span class="vs-text">over (${p.loser.seed}) ${p.loser.name}</span>
                                <span class="prob-badge ${p.riskCategory}">${(p.probability * 100).toFixed(1)}%</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // Render Head to Head
    function renderH2H() {
        const container = document.getElementById('h2h-content');

        if (totalPicks < 1) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">⚔</div>
                    <h3>Make your picks first</h3>
                    <p>Fill in your bracket to compare it against the bot's predictions.</p>
                </div>`;
            return;
        }

        // Compare user vs bot picks
        let matches = 0;
        let diffs = 0;
        const comparisons = [];

        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const userRounds = userBracket.regions[regionName];
            const botGames = botBracket[regionName].games;

            let botIdx = 0;
            for (let r = 0; r < 4; r++) {
                for (let m = 0; m < userRounds[r].length; m++) {
                    const userPick = userRounds[r][m];
                    const botGame = botGames[botIdx];
                    botIdx++;

                    if (userPick) {
                        const match = botGame.winner.name === userPick.name;
                        if (match) matches++;
                        else diffs++;
                        comparisons.push({
                            round: r + 1,
                            region: regionName,
                            userPick,
                            botPick: botGame.winner,
                            match
                        });
                    }
                }
            }
        }

        // Final Four comparison
        if (userBracket.finalFour.game1.winner) {
            const m = botBracket.finalFour.game1.winner.name === userBracket.finalFour.game1.winner.name;
            if (m) matches++; else diffs++;
            comparisons.push({ round: 5, region: 'FF', userPick: userBracket.finalFour.game1.winner, botPick: botBracket.finalFour.game1.winner, match: m });
        }
        if (userBracket.finalFour.game2.winner) {
            const m = botBracket.finalFour.game2.winner.name === userBracket.finalFour.game2.winner.name;
            if (m) matches++; else diffs++;
            comparisons.push({ round: 5, region: 'FF', userPick: userBracket.finalFour.game2.winner, botPick: botBracket.finalFour.game2.winner, match: m });
        }
        if (userBracket.championship.winner) {
            const m = botBracket.championship.winner.name === userBracket.championship.winner.name;
            if (m) matches++; else diffs++;
            comparisons.push({ round: 6, region: 'Champ', userPick: userBracket.championship.winner, botPick: botBracket.championship.winner, match: m });
        }

        const total = matches + diffs;
        const agreePct = total > 0 ? ((matches / total) * 100).toFixed(0) : 0;

        const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'FF', 6: 'CH' };

        container.innerHTML = `
            <div style="text-align:center;margin-bottom:16px;">
                <div style="font-size:2rem;font-weight:900;color:var(--accent-orange);">${agreePct}%</div>
                <div style="font-size:0.85rem;color:var(--text-secondary);">Agreement Rate (${matches} matches, ${diffs} differences)</div>
            </div>
            <div class="h2h-container">
                <div class="h2h-column user">
                    <h3>Your Picks</h3>
                    ${comparisons.map(c => `
                        <div class="h2h-row ${c.match ? 'match' : 'differ'}">
                            <span class="round-badge">${roundNames[c.round]}</span>
                            <span class="h2h-pick-name">${c.userPick.name}</span>
                            <span class="h2h-pick-seed">(${c.userPick.seed})</span>
                        </div>
                    `).join('')}
                </div>
                <div class="h2h-diff">
                    ${comparisons.map(c => `
                        <div class="h2h-vs">${c.match ? '=' : '≠'}</div>
                    `).join('')}
                </div>
                <div class="h2h-column bot">
                    <h3>Bot Picks</h3>
                    ${comparisons.map(c => `
                        <div class="h2h-row ${c.match ? 'match' : 'differ'}">
                            <span class="round-badge">${roundNames[c.round]}</span>
                            <span class="h2h-pick-name">${c.botPick.name}</span>
                            <span class="h2h-pick-seed">(${c.botPick.seed})</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Save / Load
    function saveBracket() {
        try {
            const data = {
                year: new Date().getFullYear(),
                regions: {},
                finalFour: userBracket.finalFour,
                championship: userBracket.championship
            };
            for (const r of MarchMadnessData.REGION_NAMES) {
                data.regions[r] = userBracket.regions[r].map(round =>
                    round.map(team => team ? team.name : null)
                );
            }
            data.finalFour = {
                game1: { winner: userBracket.finalFour.game1.winner?.name || null },
                game2: { winner: userBracket.finalFour.game2.winner?.name || null }
            };
            data.championship = { winner: userBracket.championship.winner?.name || null };
            localStorage.setItem('march-madness-bracket', JSON.stringify(data));
        } catch (e) { /* ignore */ }
    }

    function loadBracket() {
        try {
            const saved = JSON.parse(localStorage.getItem('march-madness-bracket'));
            if (!saved || saved.year !== new Date().getFullYear()) return;

            // Restore region picks
            for (const regionName of MarchMadnessData.REGION_NAMES) {
                if (!saved.regions[regionName]) continue;
                const teams = tournamentData.regions[regionName];
                const allTeams = MarchMadnessData.getTeamsInBracketOrder(teams);
                const savedRounds = saved.regions[regionName];

                for (let r = 0; r < savedRounds.length; r++) {
                    for (let m = 0; m < savedRounds[r].length; m++) {
                        const name = savedRounds[r][m];
                        if (name) {
                            // Find team in region
                            const team = teams.find(t => t.name === name);
                            if (team) userBracket.regions[regionName][r][m] = team;
                        }
                    }
                }
            }

            updateFinalFourTeams();

            // Restore FF winners
            if (saved.finalFour) {
                const ff = userBracket.finalFour;
                if (saved.finalFour.game1?.winner) {
                    const team = findTeamByName(saved.finalFour.game1.winner);
                    if (team && (ff.game1.teamA?.name === team.name || ff.game1.teamB?.name === team.name)) {
                        ff.game1.winner = team;
                        userBracket.championship.teamA = team;
                    }
                }
                if (saved.finalFour.game2?.winner) {
                    const team = findTeamByName(saved.finalFour.game2.winner);
                    if (team && (ff.game2.teamA?.name === team.name || ff.game2.teamB?.name === team.name)) {
                        ff.game2.winner = team;
                        userBracket.championship.teamB = team;
                    }
                }
            }
            if (saved.championship?.winner) {
                const team = findTeamByName(saved.championship.winner);
                if (team) userBracket.championship.winner = team;
            }
        } catch (e) { /* ignore */ }
    }

    function findTeamByName(name) {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const team = tournamentData.regions[regionName].find(t => t.name === name);
            if (team) return team;
        }
        return null;
    }

    // Background animation
    function initBackground() {
        const canvas = document.getElementById('bg-canvas');
        const ctx = canvas.getContext('2d');
        let w, h;
        const particles = [];

        function resize() {
            w = canvas.width = window.innerWidth;
            h = canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        // Create particles
        for (let i = 0; i < 40; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                r: 1 + Math.random() * 2,
                dx: (Math.random() - 0.5) * 0.3,
                dy: (Math.random() - 0.5) * 0.3,
                color: ['#ff6b35', '#4ecdc4', '#ffd700'][Math.floor(Math.random() * 3)]
            });
        }

        function draw() {
            ctx.clearRect(0, 0, w, h);
            for (const p of particles) {
                p.x += p.dx;
                p.y += p.dy;
                if (p.x < 0) p.x = w;
                if (p.x > w) p.x = 0;
                if (p.y < 0) p.y = h;
                if (p.y > h) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
            }

            // Draw connections
            ctx.lineWidth = 0.3;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 150) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(78, 205, 196, ${(1 - dist / 150) * 0.2})`;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }
        draw();
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);

    return { switchView, showToast };
})();
