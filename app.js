// ============================================================
// MARCH MADNESS APP — Complete UI, Settings, Undo/Redo,
// Keyboard Nav, Export, Simulation, Analysis
// ============================================================

const App = (() => {
    // ---- State ----
    let tournamentData = null;
    let botBracket = null;
    let mcResults = null;
    let currentView = 'bracket';
    let activeRegion = 0;

    let userBracket = { regions: {}, finalFour: { game1: {}, game2: {} }, championship: {} };
    let totalPicks = 0;
    const TOTAL_GAMES = 63;

    // Undo/Redo stacks
    const undoStack = [];
    const redoStack = [];
    const MAX_UNDO = 30;

    // Settings
    let settings = {
        dark: true,
        particles: true,
        probs: true,
        sounds: true,
        autosave: true,
        scoring: 'standard'
    };

    // Audio context
    let audioCtx = null;

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playSound(freq, dur, type = 'sine') {
        if (!settings.sounds) return;
        try {
            const ctx = getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = type;
            osc.frequency.value = freq;
            gain.gain.value = 0.08;
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
            osc.stop(ctx.currentTime + dur);
        } catch (e) { /* silent */ }
    }

    function playClick() { playSound(800, 0.08); }

    function playAdvance() {
        if (!settings.sounds) return;
        try {
            const ctx = getAudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.value = 523;
            gain.gain.value = 0.1;
            osc.start();
            osc.frequency.exponentialRampToValueAtTime(784, ctx.currentTime + 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
            osc.stop(ctx.currentTime + 0.2);
        } catch (e) { /* silent */ }
    }

    function playChampion() {
        if (!settings.sounds) return;
        try {
            const ctx = getAudioCtx();
            [523, 659, 784, 1047].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.value = freq;
                gain.gain.value = 0.12;
                osc.start(ctx.currentTime + i * 0.15);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
                osc.stop(ctx.currentTime + i * 0.15 + 0.3);
            });
        } catch (e) { /* silent */ }
    }

    // ---- Initialize ----
    function init() {
        const year = new Date().getFullYear();
        document.getElementById('year-badge').textContent = year;
        document.title = `March Madness ${year} Bracket`;

        tournamentData = MarchMadnessData.TOURNAMENT_2025;
        botBracket = PredictionEngine.generateBotBracket(tournamentData);

        loadSettings();
        applySettings();
        initUserBracket();
        loadBracket();

        setupNav();
        setupRegionTabs();
        setupControls();
        setupSettings();
        setupSeedLegend();
        setupOnboarding();
        setupKeyboard();
        initBackground();

        renderBracket();
        renderFinalFour();
        renderBotBracket();
        updateProgress();
    }

    function initUserBracket() {
        userBracket = { regions: {}, finalFour: { game1: {}, game2: {} }, championship: {} };
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            userBracket.regions[regionName] = [
                new Array(8).fill(null),
                new Array(4).fill(null),
                new Array(2).fill(null),
                new Array(1).fill(null)
            ];
        }
        userBracket.finalFour = {
            game1: { teamA: null, teamB: null, winner: null },
            game2: { teamA: null, teamB: null, winner: null }
        };
        userBracket.championship = { teamA: null, teamB: null, winner: null };
    }

    // ---- Undo/Redo ----
    function pushUndoState() {
        undoStack.push(JSON.stringify(userBracket));
        if (undoStack.length > MAX_UNDO) undoStack.shift();
        redoStack.length = 0;
        updateUndoButtons();
    }

    function undo() {
        if (undoStack.length === 0) return;
        redoStack.push(JSON.stringify(userBracket));
        userBracket = JSON.parse(undoStack.pop());
        restoreTeamRefs();
        refreshAll();
        showToast('Undone');
        updateUndoButtons();
    }

    function redo() {
        if (redoStack.length === 0) return;
        undoStack.push(JSON.stringify(userBracket));
        userBracket = JSON.parse(redoStack.pop());
        restoreTeamRefs();
        refreshAll();
        showToast('Redone');
        updateUndoButtons();
    }

    function updateUndoButtons() {
        const undoBtn = document.getElementById('btn-undo');
        const redoBtn = document.getElementById('btn-redo');
        if (undoBtn) undoBtn.disabled = undoStack.length === 0;
        if (redoBtn) redoBtn.disabled = redoStack.length === 0;
    }

    // After JSON parse, replace team name strings with actual team object refs
    function restoreTeamRefs() {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const rounds = userBracket.regions[regionName];
            for (let r = 0; r < rounds.length; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    if (rounds[r][m]) {
                        rounds[r][m] = findTeamByName(rounds[r][m].name) || rounds[r][m];
                    }
                }
            }
        }
        const ff = userBracket.finalFour;
        for (const game of [ff.game1, ff.game2]) {
            if (game.teamA) game.teamA = findTeamByName(game.teamA.name) || game.teamA;
            if (game.teamB) game.teamB = findTeamByName(game.teamB.name) || game.teamB;
            if (game.winner) game.winner = findTeamByName(game.winner.name) || game.winner;
        }
        const ch = userBracket.championship;
        if (ch.teamA) ch.teamA = findTeamByName(ch.teamA.name) || ch.teamA;
        if (ch.teamB) ch.teamB = findTeamByName(ch.teamB.name) || ch.teamB;
        if (ch.winner) ch.winner = findTeamByName(ch.winner.name) || ch.winner;
    }

    function refreshAll() {
        renderBracket();
        renderFinalFour();
        updateProgress();
        if (settings.autosave) saveBracket();
        showRegion(activeRegion);
    }

    // ---- Navigation ----
    function setupNav() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });
    }

    function switchView(view) {
        currentView = view;
        document.querySelectorAll('.nav-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.view === view)
        );
        document.querySelectorAll('.view').forEach(v =>
            v.classList.toggle('active', v.id === `view-${view}`)
        );
        if (view === 'analysis') renderAnalysis();
        if (view === 'h2h') renderH2H();
        if (view === 'simulate') runSimulation();
    }

    // ---- Region tabs ----
    function setupRegionTabs() {
        const container = document.getElementById('region-tabs');
        const names = [...MarchMadnessData.REGION_NAMES, 'Final Four'];
        names.forEach((name, i) => {
            const btn = document.createElement('button');
            btn.className = `region-tab${i === 0 ? ' active' : ''}`;
            btn.textContent = name;
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
            btn.addEventListener('click', () => {
                activeRegion = i;
                container.querySelectorAll('.region-tab').forEach(t => {
                    t.classList.remove('active');
                    t.setAttribute('aria-selected', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-selected', 'true');
                showRegion(i);
            });
            container.appendChild(btn);
        });
    }

    function showRegion(index) {
        document.querySelectorAll('.bracket-region').forEach((r, i) =>
            r.classList.toggle('active', i === index)
        );
        const ffSection = document.getElementById('final-four-section');
        if (index === 4) {
            ffSection.classList.add('active');
            document.querySelectorAll('.bracket-region').forEach(r => r.classList.remove('active'));
        } else {
            ffSection.classList.remove('active');
        }
    }

    // ---- Bracket Rendering ----
    function renderBracket() {
        const container = document.getElementById('bracket-container');
        container.innerHTML = '';

        MarchMadnessData.REGION_NAMES.forEach((regionName, ri) => {
            const regionEl = document.createElement('div');
            regionEl.className = `bracket-region${ri === activeRegion && activeRegion < 4 ? ' active' : ''}`;
            regionEl.dataset.region = regionName;
            regionEl.setAttribute('role', 'tabpanel');
            regionEl.setAttribute('aria-label', `${regionName} Region bracket`);

            const teams = tournamentData.regions[regionName];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
            const roundNames = MarchMadnessData.ROUND_NAMES.slice(0, 4);
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

                    let teamA, teamB;
                    if (round === 0) {
                        teamA = ordered[m * 2];
                        teamB = ordered[m * 2 + 1];
                    } else {
                        teamA = userBracket.regions[regionName][round - 1][m * 2] || null;
                        teamB = userBracket.regions[regionName][round - 1][m * 2 + 1] || null;
                    }

                    const winner = userBracket.regions[regionName][round][m];

                    pair.appendChild(createTeamSlot(teamA, winner, regionName, round, m, 0, teamB));
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
        slot.setAttribute('tabindex', team ? '0' : '-1');
        slot.setAttribute('role', 'button');

        if (!team) {
            slot.classList.add('empty');
            slot.innerHTML = '<span class="team-name">&mdash;</span>';
            slot.removeAttribute('role');
            slot.setAttribute('tabindex', '-1');
            return slot;
        }

        const isWinner = winner && winner.name === team.name;
        const isEliminated = winner && winner.name !== team.name;

        if (isWinner) slot.classList.add('winner');
        if (isEliminated) slot.classList.add('eliminated');

        slot.setAttribute('aria-label', `${team.name}, seed ${team.seed}${isWinner ? ', selected' : ''}${isEliminated ? ', eliminated' : ''}`);

        const seedEl = document.createElement('span');
        seedEl.className = 'team-seed';
        seedEl.textContent = team.seed;

        const nameEl = document.createElement('span');
        nameEl.className = 'team-name';
        nameEl.textContent = team.name;

        slot.appendChild(seedEl);
        slot.appendChild(nameEl);

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
            slot.appendChild(probEl);
        }

        const handleSelect = () => {
            if (!team) return;
            selectWinner(regionName, round, matchupIdx, team);
            playClick();
        };

        slot.addEventListener('click', handleSelect);
        slot.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect();
            }
        });

        slot.addEventListener('mouseenter', (e) => {
            if (team && opponent) showTooltip(e, team, opponent);
        });
        slot.addEventListener('mouseleave', hideTooltip);
        slot.addEventListener('focus', (e) => {
            if (team && opponent) showTooltip(e, team, opponent);
        });
        slot.addEventListener('blur', hideTooltip);

        return slot;
    }

    function selectWinner(regionName, round, matchupIdx, team) {
        pushUndoState();
        const regionRounds = userBracket.regions[regionName];
        const prevWinner = regionRounds[round][matchupIdx];

        regionRounds[round][matchupIdx] = team;

        if (prevWinner && prevWinner.name !== team.name) {
            clearDownstream(regionName, round, matchupIdx, prevWinner);
        }

        updateFinalFourTeams();
        refreshAll();
    }

    function clearDownstream(regionName, round, matchupIdx, oldTeam) {
        const regionRounds = userBracket.regions[regionName];
        for (let r = round + 1; r < 4; r++) {
            for (let m = 0; m < regionRounds[r].length; m++) {
                if (regionRounds[r][m]?.name === oldTeam.name) {
                    regionRounds[r][m] = null;
                }
            }
        }
        // Clear FF/Championship
        const ff = userBracket.finalFour;
        const ch = userBracket.championship;
        for (const game of [ff.game1, ff.game2]) {
            if (game.teamA?.name === oldTeam.name) game.teamA = null;
            if (game.teamB?.name === oldTeam.name) game.teamB = null;
            if (game.winner?.name === oldTeam.name) game.winner = null;
        }
        if (ch.teamA?.name === oldTeam.name) ch.teamA = null;
        if (ch.teamB?.name === oldTeam.name) ch.teamB = null;
        if (ch.winner?.name === oldTeam.name) ch.winner = null;
    }

    function updateFinalFourTeams() {
        const regions = MarchMadnessData.REGION_NAMES;
        const ff = userBracket.finalFour;

        ff.game1.teamA = userBracket.regions[regions[0]]?.[3]?.[0] || null;
        ff.game1.teamB = userBracket.regions[regions[1]]?.[3]?.[0] || null;
        ff.game2.teamA = userBracket.regions[regions[2]]?.[3]?.[0] || null;
        ff.game2.teamB = userBracket.regions[regions[3]]?.[3]?.[0] || null;

        userBracket.championship.teamA = ff.game1.winner || null;
        userBracket.championship.teamB = ff.game2.winner || null;

        // Validate FF winners
        if (ff.game1.winner && ff.game1.winner.name !== ff.game1.teamA?.name && ff.game1.winner.name !== ff.game1.teamB?.name) {
            ff.game1.winner = null;
            userBracket.championship.teamA = null;
        }
        if (ff.game2.winner && ff.game2.winner.name !== ff.game2.teamA?.name && ff.game2.winner.name !== ff.game2.teamB?.name) {
            ff.game2.winner = null;
            userBracket.championship.teamB = null;
        }
        if (userBracket.championship.winner && userBracket.championship.winner.name !== userBracket.championship.teamA?.name && userBracket.championship.winner.name !== userBracket.championship.teamB?.name) {
            userBracket.championship.winner = null;
        }
    }

    // ---- Final Four ----
    function renderFinalFour() {
        const gamesEl = document.getElementById('ff-games');
        const champGameEl = document.getElementById('championship-game');
        gamesEl.innerHTML = '';
        champGameEl.innerHTML = '';

        const ff = userBracket.finalFour;
        const regions = MarchMadnessData.REGION_NAMES;

        gamesEl.appendChild(createFFGame(ff.game1, `${regions[0]} vs ${regions[1]}`, 'ff1'));
        gamesEl.appendChild(createFFGame(ff.game2, `${regions[2]} vs ${regions[3]}`, 'ff2'));

        const champLabel = document.createElement('div');
        champLabel.style.cssText = 'font-size:1rem;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--accent-gold);margin-bottom:6px;';
        champLabel.textContent = 'Championship';
        champGameEl.appendChild(champLabel);
        champGameEl.appendChild(createFFGame(userBracket.championship, 'National Championship', 'champ'));

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
        labelEl.className = 'ff-label';
        labelEl.textContent = label;
        container.appendChild(labelEl);

        for (const [team, isA] of [[game.teamA, true], [game.teamB, false]]) {
            const slot = document.createElement('div');
            slot.className = 'team-slot';
            if (isA) slot.style.borderBottom = '1px solid var(--border)';

            if (!team) {
                slot.classList.add('empty');
                slot.innerHTML = '<span class="team-name">TBD</span>';
                slot.setAttribute('tabindex', '-1');
            } else {
                if (game.winner?.name === team.name) slot.classList.add('winner');
                if (game.winner && game.winner.name !== team.name) slot.classList.add('eliminated');
                slot.setAttribute('tabindex', '0');
                slot.setAttribute('role', 'button');
                slot.setAttribute('aria-label', `${team.name}, seed ${team.seed}`);

                slot.innerHTML = `<span class="team-seed">${team.seed}</span><span class="team-name">${team.name}</span>`;

                const other = isA ? game.teamB : game.teamA;
                if (other) {
                    const prob = PredictionEngine.getWinProbability(team, other);
                    const pct = (prob * 100).toFixed(0);
                    const cls = prob >= 0.7 ? 'safe' : prob >= 0.45 ? 'moderate' : prob >= 0.25 ? 'risky' : 'longshot';
                    slot.innerHTML += `<span class="team-prob ${cls}">${pct}%</span>`;
                }

                const handleClick = () => selectFFWinner(id, team);
                slot.addEventListener('click', handleClick);
                slot.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
                });
            }
            container.appendChild(slot);
        }
        return container;
    }

    function selectFFWinner(gameId, team) {
        pushUndoState();
        playClick();
        const ff = userBracket.finalFour;
        const ch = userBracket.championship;

        if (gameId === 'ff1') {
            const old = ff.game1.winner;
            ff.game1.winner = team;
            ch.teamA = team;
            if (old && old.name !== team.name && ch.winner?.name === old.name) ch.winner = null;
        } else if (gameId === 'ff2') {
            const old = ff.game2.winner;
            ff.game2.winner = team;
            ch.teamB = team;
            if (old && old.name !== team.name && ch.winner?.name === old.name) ch.winner = null;
        } else if (gameId === 'champ') {
            ch.winner = team;
            playChampion();
            launchConfetti();
        }

        renderFinalFour();
        updateProgress();
        if (settings.autosave) saveBracket();
    }

    // ---- Controls ----
    function setupControls() {
        document.getElementById('btn-reset').addEventListener('click', () => {
            if (confirm('Reset entire bracket? This cannot be undone.')) {
                pushUndoState();
                initUserBracket();
                refreshAll();
                showToast('Bracket reset');
            }
        });

        document.getElementById('btn-randomize').addEventListener('click', () => {
            pushUndoState();
            randomizeBracket();
            showToast('Bracket randomized!');
        });

        document.getElementById('btn-autofill').addEventListener('click', () => {
            pushUndoState();
            autoFillBracket();
            showToast('Auto-filled with most probable picks');
        });

        document.getElementById('btn-copy-bot').addEventListener('click', () => {
            pushUndoState();
            copyBotBracket();
            showToast('Bot bracket copied!');
        });

        document.getElementById('btn-undo').addEventListener('click', undo);
        document.getElementById('btn-redo').addEventListener('click', redo);

        document.getElementById('btn-print').addEventListener('click', () => window.print());

        updateUndoButtons();
    }

    function randomizeBracket() {
        initUserBracket();
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const ordered = MarchMadnessData.getTeamsInBracketOrder(tournamentData.regions[regionName]);
            const rounds = userBracket.regions[regionName];
            for (let m = 0; m < 8; m++) {
                const prob = PredictionEngine.getWinProbability(ordered[m * 2], ordered[m * 2 + 1]);
                rounds[0][m] = Math.random() < prob ? ordered[m * 2] : ordered[m * 2 + 1];
            }
            for (let r = 1; r < 4; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    const tA = rounds[r - 1][m * 2], tB = rounds[r - 1][m * 2 + 1];
                    if (tA && tB) {
                        const prob = PredictionEngine.getWinProbability(tA, tB);
                        rounds[r][m] = Math.random() < prob ? tA : tB;
                    }
                }
            }
        }
        updateFinalFourTeams();
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
        refreshAll();
    }

    function autoFillBracket() {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const ordered = MarchMadnessData.getTeamsInBracketOrder(tournamentData.regions[regionName]);
            const rounds = userBracket.regions[regionName];
            for (let m = 0; m < 8; m++) {
                if (!rounds[0][m]) {
                    const prob = PredictionEngine.getWinProbability(ordered[m * 2], ordered[m * 2 + 1]);
                    rounds[0][m] = prob >= 0.5 ? ordered[m * 2] : ordered[m * 2 + 1];
                }
            }
            for (let r = 1; r < 4; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    if (!rounds[r][m]) {
                        const tA = rounds[r - 1][m * 2], tB = rounds[r - 1][m * 2 + 1];
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
            ff.game1.winner = PredictionEngine.getWinProbability(ff.game1.teamA, ff.game1.teamB) >= 0.5 ? ff.game1.teamA : ff.game1.teamB;
            userBracket.championship.teamA = ff.game1.winner;
        }
        if (!ff.game2.winner && ff.game2.teamA && ff.game2.teamB) {
            ff.game2.winner = PredictionEngine.getWinProbability(ff.game2.teamA, ff.game2.teamB) >= 0.5 ? ff.game2.teamA : ff.game2.teamB;
            userBracket.championship.teamB = ff.game2.winner;
        }
        if (!userBracket.championship.winner && userBracket.championship.teamA && userBracket.championship.teamB) {
            userBracket.championship.winner = PredictionEngine.getWinProbability(userBracket.championship.teamA, userBracket.championship.teamB) >= 0.5 ? userBracket.championship.teamA : userBracket.championship.teamB;
        }
        refreshAll();
    }

    function copyBotBracket() {
        initUserBracket();
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const botRegion = botBracket[regionName];
            let gameIdx = 0;
            const matchupsPerRound = [8, 4, 2, 1];
            for (let r = 0; r < 4; r++) {
                for (let m = 0; m < matchupsPerRound[r]; m++) {
                    userBracket.regions[regionName][r][m] = botRegion.games[gameIdx].winner;
                    gameIdx++;
                }
            }
        }
        updateFinalFourTeams();
        const ff = userBracket.finalFour;
        ff.game1.winner = botBracket.finalFour.game1.winner;
        userBracket.championship.teamA = ff.game1.winner;
        ff.game2.winner = botBracket.finalFour.game2.winner;
        userBracket.championship.teamB = ff.game2.winner;
        userBracket.championship.winner = botBracket.championship.winner;
        refreshAll();
    }

    // ---- Progress ----
    function updateProgress() {
        let count = 0;
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            for (const round of userBracket.regions[regionName]) {
                count += round.filter(w => w !== null).length;
            }
        }
        if (userBracket.finalFour.game1.winner) count++;
        if (userBracket.finalFour.game2.winner) count++;
        if (userBracket.championship.winner) count++;

        totalPicks = count;
        const pct = (count / TOTAL_GAMES) * 100;
        const bar = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');
        bar.style.width = `${pct}%`;
        bar.parentElement.setAttribute('aria-valuenow', count);
        text.textContent = `${count} / ${TOTAL_GAMES}`;
    }

    // ---- Tooltip ----
    function showTooltip(e, teamA, teamB) {
        const tip = document.getElementById('tooltip');
        const insight = PredictionEngine.getMatchupInsight(teamA, teamB);

        tip.querySelector('.tip-matchup').textContent = `(${teamA.seed}) ${teamA.name} vs (${teamB.seed}) ${teamB.name}`;
        tip.querySelector('.tip-prob').textContent = `${insight.favorite.name}: ${(insight.probability * 100).toFixed(1)}% (CI: ${(insight.ci.low * 100).toFixed(0)}%-${(insight.ci.high * 100).toFixed(0)}%)`;
        tip.querySelector('.tip-record').textContent = insight.historicalRecord ? `Historical: ${insight.historicalRecord}` : '';
        tip.querySelector('.tip-note').textContent = insight.historicalNote || insight.insight;

        const rect = (e.target || e.currentTarget).getBoundingClientRect();
        tip.style.left = `${Math.min(rect.right + 8, window.innerWidth - 310)}px`;
        tip.style.top = `${Math.min(rect.top, window.innerHeight - 120)}px`;
        tip.classList.add('visible');
        tip.setAttribute('aria-hidden', 'false');
    }

    function hideTooltip() {
        const tip = document.getElementById('tooltip');
        tip.classList.remove('visible');
        tip.setAttribute('aria-hidden', 'true');
    }

    // ---- Toast ----
    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('visible');
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // ---- Confetti ----
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

    // ---- Bot Bracket ----
    function renderBotBracket() {
        const grid = document.getElementById('bot-picks-grid');
        grid.innerHTML = '';

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
                row.style.cursor = 'pointer';
                row.setAttribute('tabindex', '0');
                row.setAttribute('role', 'button');
                row.setAttribute('aria-label', `${game.winner.name} over ${game.winner === game.teamA ? game.teamB.name : game.teamA.name}`);

                const loser = game.winner === game.teamA ? game.teamB : game.teamA;
                row.innerHTML = `
                    <span class="bot-pick-round">${MarchMadnessData.ROUND_SHORT[game.round - 1]}</span>
                    <span class="bot-pick-winner" style="${game.isUpset ? 'color:var(--accent-orange)' : ''}">(${game.winner.seed}) ${game.winner.name}</span>
                    <span class="bot-pick-vs">over (${loser.seed}) ${loser.name}</span>
                    <span class="bot-pick-prob" style="color:${game.probability >= 0.7 ? 'var(--safe)' : game.probability >= 0.45 ? 'var(--moderate)' : 'var(--risky)'}">${(game.probability * 100).toFixed(0)}%</span>
                    <div class="bot-pick-explain">${game.explanation}</div>
                `;

                const toggle = () => row.classList.toggle('expanded');
                row.addEventListener('click', toggle);
                row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
                card.appendChild(row);
            }

            const champRow = document.createElement('div');
            champRow.style.cssText = 'margin-top:6px;padding-top:6px;border-top:1px solid var(--border);text-align:center;font-weight:700;color:var(--accent-gold);font-size:0.82rem;';
            champRow.textContent = `Region Winner: (${regionData.champion.seed}) ${regionData.champion.name}`;
            card.appendChild(champRow);

            grid.appendChild(card);
        }

        // Bot Final Four
        const ffDisplay = document.getElementById('bot-ff-display');
        ffDisplay.innerHTML = '';

        const ffGames = document.createElement('div');
        ffGames.className = 'final-four-games';

        for (const [game, label] of [[botBracket.finalFour.game1, 'Semifinal 1'], [botBracket.finalFour.game2, 'Semifinal 2']]) {
            const el = document.createElement('div');
            el.className = 'ff-game';
            el.innerHTML = `
                <div class="ff-label">${label}</div>
                <div class="team-slot ${game.winner.name === game.teamA.name ? 'winner' : 'eliminated'}" style="border-bottom:1px solid var(--border)">
                    <span class="team-seed">${game.teamA.seed}</span><span class="team-name">${game.teamA.name}</span>
                </div>
                <div class="team-slot ${game.winner.name === game.teamB.name ? 'winner' : 'eliminated'}">
                    <span class="team-seed">${game.teamB.seed}</span><span class="team-name">${game.teamB.name}</span>
                </div>
            `;
            ffGames.appendChild(el);
        }
        ffDisplay.appendChild(ffGames);

        const ch = botBracket.championship;
        const champDiv = document.createElement('div');
        champDiv.className = 'champion-display';
        champDiv.style.marginTop = '14px';
        champDiv.innerHTML = `
            <div class="label">Bot's National Champion</div>
            <div class="champ-name">${ch.winner.name}</div>
            <div class="champ-seed">#${ch.winner.seed} Seed &mdash; ${(ch.probability * 100).toFixed(1)}% win probability</div>
        `;
        ffDisplay.appendChild(champDiv);
    }

    // ---- Analysis ----
    function renderAnalysis() {
        const container = document.getElementById('analysis-content');

        if (totalPicks < 1) {
            container.innerHTML = '<div class="empty-state"><div class="icon">📊</div><h3>Fill in your bracket first</h3><p>Complete at least a few picks to see your analysis.</p></div>';
            return;
        }

        const analysis = PredictionEngine.analyzeUserBracket(userBracket, tournamentData);
        const riskMeterClass = analysis.bracketScore >= 70 ? 'safe' : analysis.bracketScore >= 40 ? 'moderate' : 'risky';
        const riskColor = analysis.bracketScore >= 70 ? 'var(--safe)' : analysis.bracketScore >= 40 ? 'var(--moderate)' : 'var(--risky)';

        const scoringName = MarchMadnessData.SCORING_SYSTEMS[settings.scoring]?.name || 'Standard';
        const expectedPts = analysis.expectedPoints[settings.scoring] || 0;

        container.innerHTML = `
            <div class="analysis-grid">
                <div class="analysis-card">
                    <h3>Bracket Score</h3>
                    <div style="text-align:center;padding:8px 0;">
                        <div class="stat-value score">${analysis.bracketScore.toFixed(1)}</div>
                        <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">out of 100 (higher = more probable)</div>
                    </div>
                    <div class="meter"><div class="meter-fill ${riskMeterClass}" style="width:${analysis.bracketScore}%"></div></div>
                    <div class="stat-row" style="margin-top:10px;">
                        <span class="stat-label">Percentile</span>
                        <span class="stat-value" style="font-size:0.85rem;color:var(--accent-gold);">Top ${100 - analysis.percentile}%</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Overall Probability</span>
                        <span class="stat-value" style="font-size:0.8rem;">${analysis.overallProbability.toExponential(2)}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Picks Made</span>
                        <span class="stat-value" style="font-size:0.8rem;">${analysis.totalFilled} / ${TOTAL_GAMES}</span>
                    </div>
                </div>

                <div class="analysis-card">
                    <h3>Risk Profile</h3>
                    <div class="stat-row">
                        <span class="stat-label">Risk Level</span>
                        <span class="stat-value" style="font-size:0.85rem;color:${riskColor};">${analysis.riskLevel}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Total Upsets</span>
                        <span class="stat-value" style="font-size:0.85rem;">${analysis.upsetCount} <span style="font-size:0.65rem;color:var(--text-muted);">(avg: ~8-10)</span></span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Safe Picks (&gt;70%)</span>
                        <span class="stat-value" style="font-size:0.85rem;color:var(--safe);">${analysis.picks.filter(p => p.riskCategory === 'safe').length}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Moderate (45-70%)</span>
                        <span class="stat-value" style="font-size:0.85rem;color:var(--moderate);">${analysis.picks.filter(p => p.riskCategory === 'moderate').length}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Risky (&lt;45%)</span>
                        <span class="stat-value" style="font-size:0.85rem;color:var(--risky);">${analysis.picks.filter(p => p.riskCategory === 'risky' || p.riskCategory === 'longshot').length}</span>
                    </div>
                    <div class="stat-row" style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
                        <span class="stat-label">Expected Points (${scoringName})</span>
                        <span class="stat-value" style="font-size:0.95rem;color:var(--accent-gold);">${expectedPts}</span>
                    </div>
                </div>

                <div class="analysis-card full-width">
                    <h3>Suggestions</h3>
                    ${analysis.suggestions.length === 0 ? '<p style="color:var(--text-secondary);font-size:0.8rem;">No suggestions yet — keep filling in your bracket!</p>' :
                    analysis.suggestions.map(s => `
                        <div class="suggestion-item ${s.type}">
                            <span class="suggestion-icon">${s.type === 'risk' ? (s.severity === 'high' ? '!!' : '!') : s.type === 'strategy' ? '*' : 'i'}</span>
                            <span class="suggestion-text">${s.message}${s.probImprovement ? ` <strong>(${s.probImprovement})</strong>` : ''}</span>
                        </div>
                    `).join('')}
                </div>

                <div class="analysis-card full-width">
                    <h3>All Picks by Risk (${analysis.totalFilled} picks)</h3>
                    <div class="pick-list">
                        ${analysis.picks.sort((a, b) => a.probability - b.probability).map(p => `
                            <div class="pick-item" title="${p.explanation}">
                                <span class="round-badge">${MarchMadnessData.ROUND_SHORT[p.round - 1]}</span>
                                <span style="font-weight:600;">(${p.winner.seed}) ${p.winner.name}</span>
                                <span class="vs-text">over (${p.loser.seed}) ${p.loser.name}</span>
                                <span class="prob-badge ${p.riskCategory}">${(p.probability * 100).toFixed(1)}%</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ---- Head to Head ----
    function renderH2H() {
        const container = document.getElementById('h2h-content');

        if (totalPicks < 1) {
            container.innerHTML = '<div class="empty-state"><div class="icon">&#9876;</div><h3>Make your picks first</h3><p>Fill in your bracket to compare against the bot.</p></div>';
            return;
        }

        let matches = 0, diffs = 0;
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
                        match ? matches++ : diffs++;
                        comparisons.push({ round: r + 1, region: regionName, userPick, botPick: botGame.winner, match });
                    }
                }
            }
        }

        for (const [game, botGame] of [[userBracket.finalFour.game1, botBracket.finalFour.game1], [userBracket.finalFour.game2, botBracket.finalFour.game2]]) {
            if (game.winner) {
                const m = botGame.winner.name === game.winner.name;
                m ? matches++ : diffs++;
                comparisons.push({ round: 5, region: 'FF', userPick: game.winner, botPick: botGame.winner, match: m });
            }
        }
        if (userBracket.championship.winner) {
            const m = botBracket.championship.winner.name === userBracket.championship.winner.name;
            m ? matches++ : diffs++;
            comparisons.push({ round: 6, region: 'CH', userPick: userBracket.championship.winner, botPick: botBracket.championship.winner, match: m });
        }

        const total = matches + diffs;
        const agreePct = total > 0 ? ((matches / total) * 100).toFixed(0) : 0;

        container.innerHTML = `
            <div class="h2h-header">
                <div class="pct">${agreePct}%</div>
                <div class="label">Agreement Rate &mdash; ${matches} matches, ${diffs} differences out of ${total} picks</div>
            </div>
            <div class="h2h-container">
                <div class="h2h-column user">
                    <h3>Your Picks</h3>
                    ${comparisons.map(c => `
                        <div class="h2h-row ${c.match ? 'match' : 'differ'}">
                            <span class="round-badge">${MarchMadnessData.ROUND_SHORT[c.round - 1]}</span>
                            <span class="h2h-pick-name">${c.userPick.name}</span>
                            <span class="h2h-pick-seed">(${c.userPick.seed})</span>
                        </div>
                    `).join('')}
                </div>
                <div class="h2h-diff">
                    ${comparisons.map(c => `<div class="h2h-vs">${c.match ? '=' : '&#8800;'}</div>`).join('')}
                </div>
                <div class="h2h-column bot">
                    <h3>Bot Picks</h3>
                    ${comparisons.map(c => `
                        <div class="h2h-row ${c.match ? 'match' : 'differ'}">
                            <span class="round-badge">${MarchMadnessData.ROUND_SHORT[c.round - 1]}</span>
                            <span class="h2h-pick-name">${c.botPick.name}</span>
                            <span class="h2h-pick-seed">(${c.botPick.seed})</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // ---- Monte Carlo Simulation ----
    let simHasRun = false;
    function runSimulation() {
        const container = document.getElementById('simulate-content');

        if (simHasRun && mcResults) {
            renderSimResults(container);
            return;
        }

        container.innerHTML = '<div class="empty-state"><div class="icon">&#127922;</div><h3>Running 5,000 Simulations...</h3><div class="loading-spinner" style="margin:16px auto;"></div></div>';

        // Run in next frame to allow UI to update
        requestAnimationFrame(() => {
            setTimeout(() => {
                mcResults = PredictionEngine.monteCarloSimulate(tournamentData, 5000);
                simHasRun = true;
                renderSimResults(container);
            }, 50);
        });
    }

    function renderSimResults(container) {
        // Sort by championship probability
        const sorted = Object.values(mcResults).sort((a, b) => b.championshipProb - a.championshipProb);
        const top = sorted.slice(0, 20);
        const maxChamp = top[0]?.championshipProb || 0.01;

        const roundHeaders = ['R64', 'R32', 'S16', 'E8', 'FF', 'Champ', 'Win'];

        let html = `
            <div class="analysis-card full-width" style="margin-bottom:14px;">
                <h3>Monte Carlo Championship Probabilities (5,000 simulations)</h3>
                <p style="font-size:0.76rem;color:var(--text-secondary);margin-bottom:12px;">Each team's probability of winning the national championship, calculated by simulating the entire tournament 5,000 times with randomized outcomes weighted by the prediction model.</p>
                ${top.map(t => `
                    <div class="mc-bar">
                        <span class="bar-label">(${t.team.seed}) ${t.team.name}</span>
                        <div style="flex:1;background:var(--bg-input);border-radius:4px;overflow:hidden;">
                            <div class="bar-fill" style="width:${(t.championshipProb / maxChamp) * 100}%"></div>
                        </div>
                        <span class="bar-pct">${(t.championshipProb * 100).toFixed(1)}%</span>
                    </div>
                `).join('')}
            </div>

            <div class="analysis-card full-width">
                <h3>Full Round-by-Round Probabilities (Top 20)</h3>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border);">
                                <th style="text-align:left;padding:4px 6px;color:var(--text-muted);font-size:0.65rem;">TEAM</th>
                                ${roundHeaders.map(r => `<th style="text-align:center;padding:4px 4px;color:var(--text-muted);font-size:0.65rem;">${r}</th>`).join('')}
                            </tr>
                        </thead>
                        <tbody>
                            ${top.map(t => `
                                <tr style="border-bottom:1px solid rgba(128,128,128,0.05);">
                                    <td style="padding:4px 6px;font-weight:600;white-space:nowrap;">(${t.team.seed}) ${t.team.name}</td>
                                    ${t.roundReach.map((p, i) => `<td style="text-align:center;padding:4px;font-family:'JetBrains Mono',monospace;font-size:0.68rem;color:${p > 0.5 ? 'var(--safe)' : p > 0.2 ? 'var(--moderate)' : p > 0.05 ? 'var(--text-secondary)' : 'var(--text-muted)'};">${(p * 100).toFixed(1)}%</td>`).join('')}
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    // ---- Settings ----
    function setupSettings() {
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');

        document.getElementById('btn-settings').addEventListener('click', () => {
            panel.classList.add('open');
            overlay.classList.add('active');
            overlay.setAttribute('aria-hidden', 'false');
        });

        const close = () => {
            panel.classList.remove('open');
            overlay.classList.remove('active');
            overlay.setAttribute('aria-hidden', 'true');
        };

        document.getElementById('btn-close-settings').addEventListener('click', close);
        overlay.addEventListener('click', close);

        // Setting toggles
        document.getElementById('setting-dark').addEventListener('change', (e) => {
            settings.dark = e.target.checked;
            applySettings();
            saveSettings();
        });
        document.getElementById('setting-particles').addEventListener('change', (e) => {
            settings.particles = e.target.checked;
            applySettings();
            saveSettings();
        });
        document.getElementById('setting-probs').addEventListener('change', (e) => {
            settings.probs = e.target.checked;
            applySettings();
            saveSettings();
        });
        document.getElementById('setting-sounds').addEventListener('change', (e) => {
            settings.sounds = e.target.checked;
            saveSettings();
        });
        document.getElementById('setting-autosave').addEventListener('change', (e) => {
            settings.autosave = e.target.checked;
            saveSettings();
        });
        document.getElementById('setting-scoring').addEventListener('change', (e) => {
            settings.scoring = e.target.value;
            saveSettings();
            if (currentView === 'analysis') renderAnalysis();
        });
    }

    function applySettings() {
        document.documentElement.setAttribute('data-theme', settings.dark ? 'dark' : 'light');
        document.body.setAttribute('data-particles', settings.particles ? 'on' : 'off');
        document.body.setAttribute('data-show-probs', settings.probs ? 'on' : 'off');

        // Sync toggle UI
        const darkEl = document.getElementById('setting-dark');
        const partEl = document.getElementById('setting-particles');
        const probEl = document.getElementById('setting-probs');
        const soundEl = document.getElementById('setting-sounds');
        const saveEl = document.getElementById('setting-autosave');
        const scorEl = document.getElementById('setting-scoring');
        if (darkEl) darkEl.checked = settings.dark;
        if (partEl) partEl.checked = settings.particles;
        if (probEl) probEl.checked = settings.probs;
        if (soundEl) soundEl.checked = settings.sounds;
        if (saveEl) saveEl.checked = settings.autosave;
        if (scorEl) scorEl.value = settings.scoring;
    }

    function saveSettings() {
        try { localStorage.setItem('mm-settings', JSON.stringify(settings)); } catch (e) { /* */ }
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem('mm-settings'));
            if (saved) settings = { ...settings, ...saved };
        } catch (e) { /* */ }
    }

    // ---- Seed Legend ----
    function setupSeedLegend() {
        document.getElementById('btn-seed-legend').addEventListener('click', () => {
            document.getElementById('seed-legend-modal').classList.add('active');
            renderSeedLegend();
        });
        document.getElementById('btn-close-legend').addEventListener('click', () => {
            document.getElementById('seed-legend-modal').classList.remove('active');
        });
        document.getElementById('seed-legend-modal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                document.getElementById('seed-legend-modal').classList.remove('active');
            }
        });
    }

    function renderSeedLegend() {
        const container = document.getElementById('seed-legend-rows');
        container.innerHTML = '';

        const matchups = ['1v16', '2v15', '3v14', '4v13', '5v12', '6v11', '7v10', '8v9'];
        for (const key of matchups) {
            const h = MarchMadnessData.SEED_MATCHUP_HISTORY[key];
            const hist = MarchMadnessData.ROUND1_HISTORICAL[key];
            const row = document.createElement('div');
            row.className = 'seed-row';
            const pct = (hist * 100).toFixed(1);
            row.innerHTML = `
                <span style="font-weight:700;color:var(--accent-blue);">${key}</span>
                <div>
                    <div class="seed-bar" style="width:${pct}%;max-width:100%;"></div>
                    <div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px;">${h?.note || ''}</div>
                </div>
                <span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;">${h ? h.wins + '-' + h.losses : ''}</span>
                <span style="font-family:'JetBrains Mono',monospace;font-size:0.72rem;font-weight:700;color:var(--safe);">${pct}%</span>
            `;
            container.appendChild(row);
        }
    }

    // ---- Onboarding ----
    function setupOnboarding() {
        const onboarding = document.getElementById('onboarding');
        const seen = localStorage.getItem('mm-onboarding-seen');
        if (!seen) {
            onboarding.classList.add('active');
        }
        document.getElementById('btn-start').addEventListener('click', () => {
            onboarding.classList.remove('active');
            localStorage.setItem('mm-onboarding-seen', '1');
        });
    }

    // ---- Keyboard Navigation ----
    function setupKeyboard() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Z / Cmd+Z = undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            }
            // Ctrl+Shift+Z / Cmd+Shift+Z = redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                redo();
            }
            // Ctrl+Y = redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                redo();
            }
            // Escape closes settings/modals
            if (e.key === 'Escape') {
                document.getElementById('settings-panel').classList.remove('open');
                document.getElementById('settings-overlay').classList.remove('active');
                document.getElementById('seed-legend-modal').classList.remove('active');
                document.getElementById('onboarding').classList.remove('active');
            }
            // Arrow keys to switch regions (1-5)
            if (e.key >= '1' && e.key <= '5' && !e.ctrlKey && !e.metaKey && !e.target.closest('input,select,textarea')) {
                const idx = parseInt(e.key) - 1;
                const tabs = document.querySelectorAll('.region-tab');
                if (tabs[idx]) {
                    tabs[idx].click();
                }
            }
        });
    }

    // ---- Save/Load ----
    function saveBracket() {
        try {
            const data = { year: new Date().getFullYear(), regions: {} };
            for (const r of MarchMadnessData.REGION_NAMES) {
                data.regions[r] = userBracket.regions[r].map(round => round.map(t => t ? t.name : null));
            }
            data.finalFour = {
                game1: { winner: userBracket.finalFour.game1.winner?.name || null },
                game2: { winner: userBracket.finalFour.game2.winner?.name || null }
            };
            data.championship = { winner: userBracket.championship.winner?.name || null };
            localStorage.setItem('march-madness-bracket', JSON.stringify(data));
        } catch (e) { /* */ }
    }

    function loadBracket() {
        try {
            const saved = JSON.parse(localStorage.getItem('march-madness-bracket'));
            if (!saved || saved.year !== new Date().getFullYear()) return;

            for (const regionName of MarchMadnessData.REGION_NAMES) {
                if (!saved.regions[regionName]) continue;
                const teams = tournamentData.regions[regionName];
                const savedRounds = saved.regions[regionName];
                for (let r = 0; r < savedRounds.length; r++) {
                    for (let m = 0; m < savedRounds[r].length; m++) {
                        if (savedRounds[r][m]) {
                            const team = teams.find(t => t.name === savedRounds[r][m]);
                            if (team) userBracket.regions[regionName][r][m] = team;
                        }
                    }
                }
            }

            updateFinalFourTeams();

            if (saved.finalFour?.game1?.winner) {
                const t = findTeamByName(saved.finalFour.game1.winner);
                const ff = userBracket.finalFour;
                if (t && (ff.game1.teamA?.name === t.name || ff.game1.teamB?.name === t.name)) {
                    ff.game1.winner = t;
                    userBracket.championship.teamA = t;
                }
            }
            if (saved.finalFour?.game2?.winner) {
                const t = findTeamByName(saved.finalFour.game2.winner);
                const ff = userBracket.finalFour;
                if (t && (ff.game2.teamA?.name === t.name || ff.game2.teamB?.name === t.name)) {
                    ff.game2.winner = t;
                    userBracket.championship.teamB = t;
                }
            }
            if (saved.championship?.winner) {
                const t = findTeamByName(saved.championship.winner);
                if (t) userBracket.championship.winner = t;
            }
        } catch (e) { /* */ }
    }

    function findTeamByName(name) {
        for (const regionName of MarchMadnessData.REGION_NAMES) {
            const team = tournamentData.regions[regionName].find(t => t.name === name);
            if (team) return team;
        }
        return null;
    }

    // ---- Background Animation ----
    let bgAnimId = null;
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

        for (let i = 0; i < 35; i++) {
            particles.push({
                x: Math.random() * (w || 1000),
                y: Math.random() * (h || 800),
                r: 1 + Math.random() * 2,
                dx: (Math.random() - 0.5) * 0.25,
                dy: (Math.random() - 0.5) * 0.25,
                color: ['#ff6b35', '#4ecdc4', '#ffd700'][Math.floor(Math.random() * 3)]
            });
        }

        function draw() {
            if (!settings.particles) {
                bgAnimId = requestAnimationFrame(draw);
                return;
            }

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

            ctx.lineWidth = 0.3;
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 140) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(78, 205, 196, ${(1 - dist / 140) * 0.15})`;
                        ctx.stroke();
                    }
                }
            }

            bgAnimId = requestAnimationFrame(draw);
        }
        draw();

        // Pause when tab not visible (performance)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && bgAnimId) {
                cancelAnimationFrame(bgAnimId);
                bgAnimId = null;
            } else if (!document.hidden && !bgAnimId) {
                draw();
            }
        });
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);

    return { switchView, showToast };
})();
