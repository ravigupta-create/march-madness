// ============================================================
// MARCH MADNESS APP — 100/100 Complete
// Bracket, Settings, Undo/Redo, Export, Share, Charts,
// Mobile Swipe, Multiple Brackets, Keyboard, Accessibility
// ============================================================

const App = (() => {
    let tournamentData = null, botBracket = null, mcResults = null;
    let currentView = 'bracket', activeRegion = 0;
    let userBracket = { regions: {}, finalFour: { game1: {}, game2: {} }, championship: {} };
    let totalPicks = 0;
    const TOTAL_GAMES = 63;
    const undoStack = [], redoStack = [];
    let settings = { dark:true, particles:true, probs:true, sounds:true, autosave:true, scoring:'standard', seedColors:true, reduceMotion:false };
    let audioCtx = null;
    let touchStartX = 0;

    // ---- Audio ----
    function getCtx() { if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)(); return audioCtx; }
    function playSound(f,d,t='sine') { if(!settings.sounds) return; try { const c=getCtx(),o=c.createOscillator(),g=c.createGain(); o.connect(g); g.connect(c.destination); o.type=t; o.frequency.value=f; g.gain.value=.08; o.start(); g.gain.exponentialRampToValueAtTime(.001,c.currentTime+d); o.stop(c.currentTime+d); } catch(e){} }
    function playClick() { playSound(800,.08); }
    function playChampion() { if(!settings.sounds) return; try { const c=getCtx(); [523,659,784,1047].forEach((f,i)=>{const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.type='triangle';o.frequency.value=f;g.gain.value=.12;o.start(c.currentTime+i*.15);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+i*.15+.3);o.stop(c.currentTime+i*.15+.3);}); } catch(e){} }

    // ---- Init ----
    function init() {
        const yr = new Date().getFullYear();
        document.getElementById('year-badge').textContent = yr;
        document.title = `March Madness ${yr} Bracket`;
        tournamentData = MarchMadnessData.TOURNAMENT_2026;
        botBracket = PredictionEngine.generateBotBracket(tournamentData);
        loadSettings(); applySettings(); initUserBracket(); loadBracket();
        setupNav(); setupRegionTabs(); setupControls(); setupSettings();
        setupSeedLegend(); setupKeysModal(); setupOnboarding(); setupKeyboard();
        setupExport(); setupShare(); setupMultipleBrackets(); setupSwipe(); setupResults(); setupAskBot();
        initBackground(); renderFirstFour(); renderFullBracket(); renderBracket(); renderFinalFour(); renderBotBracket(); updateProgress();

        // Fetch real season stats from ESPN (analyzes every game played this season)
        // Runs in background — predictions auto-upgrade when stats arrive
        fetchAndUpgrade();
        // Bracket name
        const nameInput = document.getElementById('bracket-name-input');
        const savedName = localStorage.getItem('mm-bracket-name');
        if (savedName) nameInput.value = savedName;
        nameInput.addEventListener('input', () => localStorage.setItem('mm-bracket-name', nameInput.value));
    }

    // Fetch real season stats from ESPN and rebuild predictions
    async function fetchAndUpgrade() {
        try {
            showToast('Loading season stats from ESPN...');
            await MarchMadnessData.fetchAllSeasonStats(tournamentData);
            if (MarchMadnessData.hasSeasonStats()) {
                // Regenerate bot bracket with real stats
                botBracket = PredictionEngine.generateBotBracket(tournamentData);
                renderBotBracket();
                renderFullBracket();
                renderBracket();
                renderFinalFour();
                // Reset simulation so it re-runs with new data
                simDone = false; mcResults = null;
                const statCount = Object.keys(MarchMadnessData.getSeasonStats()).length;
                showToast(`Loaded real stats for ${statCount} teams — predictions upgraded`);
            }
        } catch (e) {
            // Silent fallback to seed-based predictions
        }
    }

    // ---- First Four Play-In Games ----
    let firstFourPicks = {};
    function renderFirstFour() {
        const container = document.getElementById('first-four-games');
        if (!container) return;
        container.innerHTML = '';
        const saved = JSON.parse(localStorage.getItem('mm-first-four') || '{}');
        firstFourPicks = saved;

        for (const game of MarchMadnessData.FIRST_FOUR) {
            const card = document.createElement('div');
            card.className = 'ff4-game';
            const box = document.createElement('div');
            box.className = 'matchup-pair';
            const label = document.createElement('div');
            label.className = 'ff4-label';
            label.textContent = `${game.seed}-seed \u2022 ${game.region}`;
            box.appendChild(label);

            const key = `${game.teamA}_${game.teamB}`;
            const winner = firstFourPicks[key] || null;

            for (const [name, conf] of [[game.teamA, game.confA], [game.teamB, game.confB]]) {
                const slot = document.createElement('div');
                slot.className = 'team-slot';
                slot.setAttribute('tabindex', '0');
                slot.setAttribute('role', 'button');
                if (winner === name) slot.classList.add('winner');
                if (winner && winner !== name) slot.classList.add('eliminated');
                slot.innerHTML = `<span class="team-seed" data-tier="4">${game.seed}</span><span class="team-name">${name}</span><span style="font-size:.58rem;color:var(--text-muted)">${conf}</span>`;
                const pick = () => {
                    firstFourPicks[key] = name;
                    localStorage.setItem('mm-first-four', JSON.stringify(firstFourPicks));
                    playClick();
                    renderFirstFour();
                };
                slot.addEventListener('click', pick);
                slot.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
                if (name !== game.teamA) slot.style.borderTop = '1px solid var(--border)';
                box.appendChild(slot);
            }
            card.appendChild(box);
            container.appendChild(card);
        }
    }

    // ---- Results Tracking ----
    let actualResults = {};
    function setupResults() {
        // Load saved results
        actualResults = JSON.parse(localStorage.getItem('mm-results') || '{}');
    }

    function renderResults() {
        const container = document.getElementById('results-content');
        if (totalPicks < 1) {
            container.innerHTML = '<div class="empty-state"><div class="icon">&#9989;</div><h3>Fill in your bracket first</h3><p>Make picks, then enter actual game results here to track your score.</p></div>';
            return;
        }

        // Build results UI
        const scoringSystem = MarchMadnessData.SCORING_SYSTEMS[settings.scoring];
        const roundNames = MarchMadnessData.ROUND_NAMES;
        let totalPoints = 0, correctPicks = 0, incorrectPicks = 0, pendingPicks = 0;
        const items = [];

        // Collect all user picks
        for (const rn of MarchMadnessData.REGION_NAMES) {
            const rounds = userBracket.regions[rn];
            const teams = tournamentData.regions[rn];
            const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
            let prevTeams = ordered;

            for (let r = 0; r < rounds.length; r++) {
                for (let m = 0; m < rounds[r].length; m++) {
                    const pick = rounds[r][m];
                    if (!pick) continue;

                    const tA = prevTeams[m * 2];
                    const tB = prevTeams[m * 2 + 1];
                    if (!tA || !tB) continue;

                    const gameKey = `${rn}_R${r}_${m}`;
                    const actual = actualResults[gameKey] || null;

                    let status = 'pending';
                    let pts = 0;
                    if (actual) {
                        if (actual === pick.name) {
                            status = 'correct';
                            pts = scoringSystem.points[r] || 0;
                            if (scoringSystem.seedMultiplier) pts *= pick.seed;
                            if (scoringSystem.upsetMultiplier && pick.seed > Math.min(tA.seed, tB.seed)) pts *= 1.5;
                            correctPicks++;
                            totalPoints += pts;
                        } else {
                            status = 'incorrect';
                            incorrectPicks++;
                        }
                    } else {
                        pendingPicks++;
                    }

                    items.push({ pick, loser: pick === tA ? tB : tA, round: r, region: rn, gameKey, actual, status, pts, tA, tB });
                }
                prevTeams = rounds[r];
            }
        }

        // FF + Championship
        for (const [game, label, r] of [
            [userBracket.finalFour.game1, 'FF1', 4],
            [userBracket.finalFour.game2, 'FF2', 4],
            [userBracket.championship, 'Champ', 5]
        ]) {
            if (game.winner && game.teamA && game.teamB) {
                const gameKey = `${label}`;
                const actual = actualResults[gameKey] || null;
                let status = 'pending', pts = 0;
                if (actual) {
                    if (actual === game.winner.name) {
                        status = 'correct'; pts = scoringSystem.points[r] || 0;
                        if (scoringSystem.seedMultiplier) pts *= game.winner.seed;
                        correctPicks++; totalPoints += pts;
                    } else { status = 'incorrect'; incorrectPicks++; }
                } else { pendingPicks++; }
                items.push({ pick: game.winner, loser: game.winner === game.teamA ? game.teamB : game.teamA, round: r, region: label, gameKey, actual, status, pts, tA: game.teamA, tB: game.teamB });
            }
        }

        const totalAnswered = correctPicks + incorrectPicks;
        const accuracy = totalAnswered > 0 ? ((correctPicks / totalAnswered) * 100).toFixed(0) : '-';

        container.innerHTML = `
            <div class="results-score">
                <div class="big-score">${totalPoints}</div>
                <div class="score-label">Points (${MarchMadnessData.SCORING_SYSTEMS[settings.scoring].name})</div>
                <div style="margin-top:6px;font-size:.78rem;color:var(--text-secondary)">${correctPicks} correct, ${incorrectPicks} wrong, ${pendingPicks} pending &mdash; ${accuracy}% accuracy</div>
            </div>
            <div class="results-controls">
                <button class="btn btn-sm" id="btn-clear-results">Clear All Results</button>
            </div>
            <div class="analysis-card full-width">
                <h3>Game Results &mdash; Click to mark actual winners</h3>
                <div class="pick-list">
                    ${items.map(it => `
                        <div class="result-item ${it.status}">
                            <span class="round-badge">${MarchMadnessData.ROUND_SHORT[it.round]}</span>
                            <span style="font-weight:600">(${it.pick.seed}) ${it.pick.name}</span>
                            <span class="vs-text">vs (${it.loser.seed}) ${it.loser.name}</span>
                            ${it.status === 'correct' ? `<span class="prob-badge safe">+${it.pts}</span>` : ''}
                            ${it.status === 'incorrect' ? `<span class="prob-badge risky">X</span>` : ''}
                            <button class="btn btn-sm" data-key="${it.gameKey}" data-a="${it.tA.name}" data-b="${it.tB.name}" onclick="App.markResult(this)" style="margin-left:auto;font-size:.6rem">${it.actual ? it.actual : 'Set Winner'}</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        document.getElementById('btn-clear-results')?.addEventListener('click', () => {
            actualResults = {};
            localStorage.setItem('mm-results', '{}');
            renderResults();
            showToast('Results cleared');
        });
    }

    function markResult(btn) {
        const key = btn.dataset.key;
        const a = btn.dataset.a;
        const b = btn.dataset.b;
        const current = actualResults[key];
        // Cycle: none → A → B → none
        if (!current) actualResults[key] = a;
        else if (current === a) actualResults[key] = b;
        else { delete actualResults[key]; }
        localStorage.setItem('mm-results', JSON.stringify(actualResults));
        renderResults();
    }

    function initUserBracket() {
        userBracket = { regions:{}, finalFour:{game1:{teamA:null,teamB:null,winner:null},game2:{teamA:null,teamB:null,winner:null}}, championship:{teamA:null,teamB:null,winner:null} };
        for (const r of MarchMadnessData.REGION_NAMES) userBracket.regions[r] = [Array(8).fill(null),Array(4).fill(null),Array(2).fill(null),Array(1).fill(null)];
    }

    // ---- Undo/Redo ----
    function pushUndo() { undoStack.push(JSON.stringify(userBracket)); if(undoStack.length>30) undoStack.shift(); redoStack.length=0; updateUndoBtns(); }
    function undo() { if(!undoStack.length) return; redoStack.push(JSON.stringify(userBracket)); userBracket=JSON.parse(undoStack.pop()); restoreRefs(); refreshAll(); showToast('Undone'); updateUndoBtns(); }
    function redo() { if(!redoStack.length) return; undoStack.push(JSON.stringify(userBracket)); userBracket=JSON.parse(redoStack.pop()); restoreRefs(); refreshAll(); showToast('Redone'); updateUndoBtns(); }
    function updateUndoBtns() { document.getElementById('btn-undo').disabled=!undoStack.length; document.getElementById('btn-redo').disabled=!redoStack.length; }
    function restoreRefs() {
        for (const rn of MarchMadnessData.REGION_NAMES) { const rs=userBracket.regions[rn]; for(let r=0;r<rs.length;r++) for(let m=0;m<rs[r].length;m++) if(rs[r][m]) rs[r][m]=findTeam(rs[r][m].name)||rs[r][m]; }
        for (const g of [userBracket.finalFour.game1,userBracket.finalFour.game2]) { if(g.teamA) g.teamA=findTeam(g.teamA.name)||g.teamA; if(g.teamB) g.teamB=findTeam(g.teamB.name)||g.teamB; if(g.winner) g.winner=findTeam(g.winner.name)||g.winner; }
        const c=userBracket.championship; if(c.teamA) c.teamA=findTeam(c.teamA.name)||c.teamA; if(c.teamB) c.teamB=findTeam(c.teamB.name)||c.teamB; if(c.winner) c.winner=findTeam(c.winner.name)||c.winner;
    }
    function refreshAll() { renderFullBracket(); renderBracket(); renderFinalFour(); updateProgress(); if(settings.autosave) saveBracket(); showRegion(activeRegion); }

    // ---- Nav ----
    function setupNav() {
        document.querySelectorAll('.nav-btn,.mobile-nav-btn').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
    }
    function switchView(v) {
        currentView=v;
        document.querySelectorAll('.nav-btn,.mobile-nav-btn').forEach(b => b.classList.toggle('active',b.dataset.view===v));
        document.querySelectorAll('.view').forEach(el => el.classList.toggle('active',el.id===`view-${v}`));
        if(v==='analysis') renderAnalysis(); if(v==='h2h') renderH2H(); if(v==='simulate') runSim(); if(v==='results') renderResults();
    }

    // ---- Region tabs ----
    function setupRegionTabs() {
        const c=document.getElementById('region-tabs');
        [...MarchMadnessData.REGION_NAMES,'Final Four'].forEach((n,i) => {
            const b=document.createElement('button'); b.className=`region-tab${i===0?' active':''}`; b.textContent=n; b.setAttribute('role','tab'); b.setAttribute('aria-selected',i===0?'true':'false');
            b.addEventListener('click',()=>{ activeRegion=i; c.querySelectorAll('.region-tab').forEach(t=>{t.classList.remove('active');t.setAttribute('aria-selected','false');}); b.classList.add('active'); b.setAttribute('aria-selected','true'); showRegion(i); });
            c.appendChild(b);
        });
    }
    function showRegion(i) {
        document.querySelectorAll('.bracket-region').forEach((r,j) => r.classList.toggle('active',j===i));
        const ff=document.getElementById('final-four-section');
        if(i===4){ ff.classList.add('active'); document.querySelectorAll('.bracket-region').forEach(r=>r.classList.remove('active')); } else ff.classList.remove('active');
    }

    // ---- Seed tier ----
    function seedTier(s) { return s<=2?'1':s<=4?'2':s<=8?'3':'4'; }

    // ---- Full NCAA/ESPN Bracket (Desktop) ----
    function renderFullBracket() {
        const fb = document.getElementById('full-bracket');
        if (!fb) return;
        fb.innerHTML = '';

        const R = MarchMadnessData.REGION_NAMES;
        // Layout: Left side = Region 0 (top) + Region 1 (bottom), flowing right
        //         Right side = Region 2 (top) + Region 3 (bottom), flowing left (reversed)
        //         Center = Final Four + Championship

        // Left side
        const leftSide = document.createElement('div');
        leftSide.className = 'fb-side';
        leftSide.appendChild(buildFBRegion(R[0], false));
        const divL = document.createElement('div'); divL.className = 'fb-divider'; leftSide.appendChild(divL);
        leftSide.appendChild(buildFBRegion(R[1], false));
        fb.appendChild(leftSide);

        // Center
        const center = document.createElement('div');
        center.className = 'fb-center';
        center.appendChild(buildFBCenter());
        fb.appendChild(center);

        // Right side
        const rightSide = document.createElement('div');
        rightSide.className = 'fb-side';
        rightSide.appendChild(buildFBRegion(R[2], true));
        const divR = document.createElement('div'); divR.className = 'fb-divider'; rightSide.appendChild(divR);
        rightSide.appendChild(buildFBRegion(R[3], true));
        fb.appendChild(rightSide);
    }

    function buildFBRegion(regionName, reversed) {
        const region = document.createElement('div');
        region.className = 'fb-region' + (reversed ? ' reversed' : '');

        // Region label
        const label = document.createElement('div');
        label.className = 'fb-region-label';
        label.textContent = regionName;
        region.appendChild(label);

        const teams = tournamentData.regions[regionName];
        const ordered = MarchMadnessData.getTeamsInBracketOrder(teams);
        const matchups = [8, 4, 2, 1];
        const roundNames = MarchMadnessData.ROUND_NAMES.slice(0, 4);

        for (let round = 0; round < 4; round++) {
            const rEl = document.createElement('div');
            rEl.className = 'bracket-round';

            const hd = document.createElement('div');
            hd.className = 'round-header';
            hd.textContent = round < 2 ? MarchMadnessData.ROUND_SHORT[round] : roundNames[round];
            rEl.appendChild(hd);

            for (let m = 0; m < matchups[round]; m++) {
                const mu = document.createElement('div');
                mu.className = 'matchup';
                const pair = document.createElement('div');
                pair.className = 'matchup-pair';

                let tA, tB;
                if (round === 0) { tA = ordered[m * 2]; tB = ordered[m * 2 + 1]; }
                else { tA = userBracket.regions[regionName][round - 1][m * 2] || null; tB = userBracket.regions[regionName][round - 1][m * 2 + 1] || null; }
                const w = userBracket.regions[regionName][round][m];

                pair.appendChild(mkSlot(tA, w, regionName, round, m, tB));
                pair.appendChild(mkSlot(tB, w, regionName, round, m, tA));
                mu.appendChild(pair);
                rEl.appendChild(mu);
            }
            region.appendChild(rEl);

            // Add connector column between rounds
            if (round < 3) {
                const connCol = document.createElement('div');
                connCol.className = 'bracket-connectors';
                const nextCount = matchups[round + 1];
                for (let c = 0; c < nextCount; c++) {
                    const conn = document.createElement('div');
                    conn.className = 'bracket-connector';
                    conn.appendChild(Object.assign(document.createElement('div'), { className: 'conn-top' }));
                    conn.appendChild(Object.assign(document.createElement('div'), { className: 'conn-bot' }));
                    connCol.appendChild(conn);
                }
                region.appendChild(connCol);
            }
        }
        return region;
    }

    function buildFBCenter() {
        const c = document.createElement('div');
        const ff = userBracket.finalFour;
        const R = MarchMadnessData.REGION_NAMES;

        // FF Game 1 (left regions)
        const ffLabel1 = document.createElement('div');
        ffLabel1.className = 'fb-ff-label';
        ffLabel1.textContent = 'Final Four';
        c.appendChild(ffLabel1);
        c.appendChild(mkFFCompact(ff.game1, `${R[0]} / ${R[1]}`, 'ff1'));

        // Championship
        const champLabel = document.createElement('div');
        champLabel.className = 'fb-champ-label';
        champLabel.textContent = 'Championship';
        c.appendChild(champLabel);
        c.appendChild(mkFFCompact(userBracket.championship, 'Title Game', 'champ'));

        // Champion display
        if (userBracket.championship.winner) {
            const chd = document.createElement('div');
            chd.className = 'fb-champion';
            chd.innerHTML = `<div class="champ-name">${userBracket.championship.winner.name}</div><div class="champ-seed">#${userBracket.championship.winner.seed}</div>`;
            c.appendChild(chd);
        }

        // FF Game 2 (right regions)
        const ffLabel2 = document.createElement('div');
        ffLabel2.className = 'fb-ff-label';
        ffLabel2.style.marginTop = '4px';
        ffLabel2.textContent = 'Final Four';
        c.appendChild(ffLabel2);
        c.appendChild(mkFFCompact(ff.game2, `${R[2]} / ${R[3]}`, 'ff2'));

        return c;
    }

    function mkFFCompact(game, label, id) {
        const box = document.createElement('div');
        box.className = 'matchup-pair';
        box.style.minWidth = '125px';
        if (id === 'champ') { box.style.borderColor = 'var(--accent-gold)'; box.style.boxShadow = '0 0 8px rgba(255,215,0,.1)'; }

        for (const [tm, isA] of [[game.teamA, true], [game.teamB, false]]) {
            const s = document.createElement('div');
            s.className = 'team-slot';
            if (isA) s.style.borderBottom = '1px solid var(--border)';
            if (!tm) { s.classList.add('empty'); s.innerHTML = '<span class="team-name" style="font-size:.65rem">TBD</span>'; }
            else {
                if (game.winner?.name === tm.name) s.classList.add('winner');
                if (game.winner && game.winner.name !== tm.name) s.classList.add('eliminated');
                s.setAttribute('tabindex', '0'); s.setAttribute('role', 'button');
                const other = isA ? game.teamB : game.teamA;
                let probHTML = '';
                if (other) { const p = PredictionEngine.getWinProbability(tm, other), pct = (p * 100).toFixed(0), cls = p >= .7 ? 'safe' : p >= .45 ? 'moderate' : p >= .25 ? 'risky' : 'longshot'; probHTML = `<span class="team-prob ${cls}">${pct}%</span>`; }
                s.innerHTML = `<span class="team-seed" data-tier="${seedTier(tm.seed)}">${tm.seed}</span><span class="team-name">${tm.name}</span>${probHTML}`;
                const pick = () => selectFF(id, tm);
                s.addEventListener('click', pick);
                s.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
            }
            box.appendChild(s);
        }
        return box;
    }

    // ---- Mobile Bracket render (tabbed) ----
    function renderBracket() {
        const container=document.getElementById('bracket-container'); container.innerHTML='';
        MarchMadnessData.REGION_NAMES.forEach((rn,ri) => {
            const reg=document.createElement('div'); reg.className=`bracket-region${ri===activeRegion&&activeRegion<4?' active':''}`; reg.setAttribute('role','tabpanel');
            const teams=tournamentData.regions[rn], ordered=MarchMadnessData.getTeamsInBracketOrder(teams);
            const matchups=[8,4,2,1];
            for(let round=0;round<4;round++){
                const rEl=document.createElement('div'); rEl.className='bracket-round';
                const hd=document.createElement('div'); hd.className='round-header'; hd.textContent=MarchMadnessData.ROUND_NAMES[round]; rEl.appendChild(hd);
                for(let m=0;m<matchups[round];m++){
                    const mu=document.createElement('div'); mu.className='matchup';
                    const pair=document.createElement('div'); pair.className='matchup-pair';
                    let tA,tB;
                    if(round===0){tA=ordered[m*2];tB=ordered[m*2+1];} else {tA=userBracket.regions[rn][round-1][m*2]||null;tB=userBracket.regions[rn][round-1][m*2+1]||null;}
                    const w=userBracket.regions[rn][round][m];
                    pair.appendChild(mkSlot(tA,w,rn,round,m,tB));
                    pair.appendChild(mkSlot(tB,w,rn,round,m,tA));
                    mu.appendChild(pair); rEl.appendChild(mu);
                }
                reg.appendChild(rEl);
            }
            container.appendChild(reg);
        });
    }

    function mkSlot(team,winner,rn,round,mi,opp) {
        const s=document.createElement('div'); s.className='team-slot';
        if(!team){ s.classList.add('empty'); s.innerHTML='<span class="team-name">&mdash;</span>'; s.setAttribute('tabindex','-1'); return s; }
        const isW=winner&&winner.name===team.name, isE=winner&&!isW;
        if(isW) s.classList.add('winner'); if(isE) s.classList.add('eliminated');
        s.setAttribute('tabindex','0'); s.setAttribute('role','button');
        s.setAttribute('aria-label',`${team.name}, seed ${team.seed}${isW?', selected':''}${isE?', eliminated':''}`);
        const sd=document.createElement('span'); sd.className='team-seed'; sd.textContent=team.seed; sd.setAttribute('data-tier',seedTier(team.seed));
        const nm=document.createElement('span'); nm.className='team-name'; nm.textContent=team.name;
        s.appendChild(sd); s.appendChild(nm);
        if(opp){
            const p=PredictionEngine.getWinProbability(team,opp), pct=(p*100).toFixed(0);
            const pe=document.createElement('span'); pe.className='team-prob'; pe.textContent=pct+'%';
            pe.classList.add(p>=.7?'safe':p>=.45?'moderate':p>=.25?'risky':'longshot'); s.appendChild(pe);
        }
        const pick=()=>{if(team){selectWinner(rn,round,mi,team);playClick();}};
        s.addEventListener('click',pick); s.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
        s.addEventListener('mouseenter',e=>{if(team&&opp) showTip(e,team,opp);}); s.addEventListener('mouseleave',hideTip);
        s.addEventListener('focus',e=>{if(team&&opp) showTip(e,team,opp);}); s.addEventListener('blur',hideTip);
        return s;
    }

    function selectWinner(rn,round,mi,team) {
        pushUndo(); const rr=userBracket.regions[rn], prev=rr[round][mi]; rr[round][mi]=team;
        if(prev&&prev.name!==team.name) clearDown(rn,round,prev);
        updateFF(); refreshAll();
    }
    function clearDown(rn,round,old) {
        const rr=userBracket.regions[rn]; for(let r=round+1;r<4;r++) for(let m=0;m<rr[r].length;m++) if(rr[r][m]?.name===old.name) rr[r][m]=null;
        for(const g of [userBracket.finalFour.game1,userBracket.finalFour.game2]){ if(g.teamA?.name===old.name)g.teamA=null; if(g.teamB?.name===old.name)g.teamB=null; if(g.winner?.name===old.name)g.winner=null; }
        const c=userBracket.championship; if(c.teamA?.name===old.name)c.teamA=null; if(c.teamB?.name===old.name)c.teamB=null; if(c.winner?.name===old.name)c.winner=null;
    }
    function updateFF() {
        const R=MarchMadnessData.REGION_NAMES, ff=userBracket.finalFour;
        ff.game1.teamA=userBracket.regions[R[0]]?.[3]?.[0]||null; ff.game1.teamB=userBracket.regions[R[1]]?.[3]?.[0]||null;
        ff.game2.teamA=userBracket.regions[R[2]]?.[3]?.[0]||null; ff.game2.teamB=userBracket.regions[R[3]]?.[3]?.[0]||null;
        userBracket.championship.teamA=ff.game1.winner||null; userBracket.championship.teamB=ff.game2.winner||null;
        if(ff.game1.winner&&ff.game1.winner.name!==ff.game1.teamA?.name&&ff.game1.winner.name!==ff.game1.teamB?.name){ff.game1.winner=null;userBracket.championship.teamA=null;}
        if(ff.game2.winner&&ff.game2.winner.name!==ff.game2.teamA?.name&&ff.game2.winner.name!==ff.game2.teamB?.name){ff.game2.winner=null;userBracket.championship.teamB=null;}
        if(userBracket.championship.winner&&userBracket.championship.winner.name!==userBracket.championship.teamA?.name&&userBracket.championship.winner.name!==userBracket.championship.teamB?.name) userBracket.championship.winner=null;
    }

    // ---- Final Four ----
    function renderFinalFour() {
        const ge=document.getElementById('ff-games'), ce=document.getElementById('championship-game');
        ge.innerHTML=''; ce.innerHTML='';
        const ff=userBracket.finalFour, R=MarchMadnessData.REGION_NAMES;
        ge.appendChild(mkFF(ff.game1,`${R[0]} vs ${R[1]}`,'ff1'));
        ge.appendChild(mkFF(ff.game2,`${R[2]} vs ${R[3]}`,'ff2'));
        const cl=document.createElement('div'); cl.style.cssText='font-size:.95rem;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:var(--accent-gold);margin-bottom:5px;'; cl.textContent='Championship'; ce.appendChild(cl);
        ce.appendChild(mkFF(userBracket.championship,'National Championship','champ'));
        const cd=document.getElementById('champion-display');
        if(userBracket.championship.winner){ cd.style.display='block'; document.getElementById('champ-name').textContent=userBracket.championship.winner.name; document.getElementById('champ-seed').textContent=`#${userBracket.championship.winner.seed} Seed`; } else cd.style.display='none';
    }
    function mkFF(game,label,id) {
        const c=document.createElement('div'); c.className='ff-game';
        const l=document.createElement('div'); l.className='ff-label'; l.textContent=label; c.appendChild(l);
        for(const [tm,isA] of [[game.teamA,true],[game.teamB,false]]){
            const s=document.createElement('div'); s.className='team-slot'; if(isA) s.style.borderBottom='1px solid var(--border)';
            if(!tm){ s.classList.add('empty'); s.innerHTML='<span class="team-name">TBD</span>'; }
            else {
                if(game.winner?.name===tm.name) s.classList.add('winner'); if(game.winner&&game.winner.name!==tm.name) s.classList.add('eliminated');
                s.setAttribute('tabindex','0'); s.setAttribute('role','button');
                const other=isA?game.teamB:game.teamA;
                let probHTML='';
                if(other){ const p=PredictionEngine.getWinProbability(tm,other),pct=(p*100).toFixed(0),cls=p>=.7?'safe':p>=.45?'moderate':p>=.25?'risky':'longshot'; probHTML=`<span class="team-prob ${cls}">${pct}%</span>`; }
                s.innerHTML=`<span class="team-seed" data-tier="${seedTier(tm.seed)}">${tm.seed}</span><span class="team-name">${tm.name}</span>${probHTML}`;
                const pick=()=>selectFF(id,tm); s.addEventListener('click',pick); s.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
            }
            c.appendChild(s);
        }
        return c;
    }
    function selectFF(id,team) {
        pushUndo(); playClick(); const ff=userBracket.finalFour, ch=userBracket.championship;
        if(id==='ff1'){const o=ff.game1.winner;ff.game1.winner=team;ch.teamA=team;if(o&&o.name!==team.name&&ch.winner?.name===o.name)ch.winner=null;}
        else if(id==='ff2'){const o=ff.game2.winner;ff.game2.winner=team;ch.teamB=team;if(o&&o.name!==team.name&&ch.winner?.name===o.name)ch.winner=null;}
        else if(id==='champ'){ch.winner=team;playChampion();launchConfetti();}
        renderFinalFour(); updateProgress(); if(settings.autosave) saveBracket();
    }

    // ---- Controls ----
    function setupControls() {
        document.getElementById('btn-reset').addEventListener('click',()=>{ if(confirm('Reset entire bracket?')){pushUndo();initUserBracket();refreshAll();showToast('Reset');} });
        document.getElementById('btn-randomize').addEventListener('click',()=>{pushUndo();randomize();showToast('Randomized!');});
        document.getElementById('btn-autofill').addEventListener('click',()=>{pushUndo();autoFill();showToast('Auto-filled');});
        document.getElementById('btn-copy-bot').addEventListener('click',()=>{pushUndo();copyBot();showToast('Bot bracket copied');});
        document.getElementById('btn-undo').addEventListener('click',undo);
        document.getElementById('btn-redo').addEventListener('click',redo);
        document.getElementById('btn-print').addEventListener('click',()=>window.print());
        updateUndoBtns();
    }

    function randomize() {
        initUserBracket();
        for(const rn of MarchMadnessData.REGION_NAMES){
            const ord=MarchMadnessData.getTeamsInBracketOrder(tournamentData.regions[rn]),rs=userBracket.regions[rn];
            for(let m=0;m<8;m++){const p=PredictionEngine.getWinProbability(ord[m*2],ord[m*2+1]);rs[0][m]=Math.random()<p?ord[m*2]:ord[m*2+1];}
            for(let r=1;r<4;r++) for(let m=0;m<rs[r].length;m++){const a=rs[r-1][m*2],b=rs[r-1][m*2+1];if(a&&b){const p=PredictionEngine.getWinProbability(a,b);rs[r][m]=Math.random()<p?a:b;}}
        }
        updateFF(); const ff=userBracket.finalFour;
        if(ff.game1.teamA&&ff.game1.teamB){const p=PredictionEngine.getWinProbability(ff.game1.teamA,ff.game1.teamB);ff.game1.winner=Math.random()<p?ff.game1.teamA:ff.game1.teamB;userBracket.championship.teamA=ff.game1.winner;}
        if(ff.game2.teamA&&ff.game2.teamB){const p=PredictionEngine.getWinProbability(ff.game2.teamA,ff.game2.teamB);ff.game2.winner=Math.random()<p?ff.game2.teamA:ff.game2.teamB;userBracket.championship.teamB=ff.game2.winner;}
        if(userBracket.championship.teamA&&userBracket.championship.teamB){const p=PredictionEngine.getWinProbability(userBracket.championship.teamA,userBracket.championship.teamB);userBracket.championship.winner=Math.random()<p?userBracket.championship.teamA:userBracket.championship.teamB;}
        refreshAll();
    }

    function autoFill() {
        for(const rn of MarchMadnessData.REGION_NAMES){
            const ord=MarchMadnessData.getTeamsInBracketOrder(tournamentData.regions[rn]),rs=userBracket.regions[rn];
            for(let m=0;m<8;m++) if(!rs[0][m]){const p=PredictionEngine.getWinProbability(ord[m*2],ord[m*2+1]);rs[0][m]=p>=.5?ord[m*2]:ord[m*2+1];}
            for(let r=1;r<4;r++) for(let m=0;m<rs[r].length;m++) if(!rs[r][m]){const a=rs[r-1][m*2],b=rs[r-1][m*2+1];if(a&&b){const p=PredictionEngine.getWinProbability(a,b);rs[r][m]=p>=.5?a:b;}}
        }
        updateFF(); const ff=userBracket.finalFour;
        if(!ff.game1.winner&&ff.game1.teamA&&ff.game1.teamB){ff.game1.winner=PredictionEngine.getWinProbability(ff.game1.teamA,ff.game1.teamB)>=.5?ff.game1.teamA:ff.game1.teamB;userBracket.championship.teamA=ff.game1.winner;}
        if(!ff.game2.winner&&ff.game2.teamA&&ff.game2.teamB){ff.game2.winner=PredictionEngine.getWinProbability(ff.game2.teamA,ff.game2.teamB)>=.5?ff.game2.teamA:ff.game2.teamB;userBracket.championship.teamB=ff.game2.winner;}
        if(!userBracket.championship.winner&&userBracket.championship.teamA&&userBracket.championship.teamB) userBracket.championship.winner=PredictionEngine.getWinProbability(userBracket.championship.teamA,userBracket.championship.teamB)>=.5?userBracket.championship.teamA:userBracket.championship.teamB;
        refreshAll();
    }

    function copyBot() {
        initUserBracket();
        for(const rn of MarchMadnessData.REGION_NAMES){
            const bg=botBracket[rn],mp=[8,4,2,1]; let gi=0;
            for(let r=0;r<4;r++) for(let m=0;m<mp[r];m++) { userBracket.regions[rn][r][m]=bg.games[gi].winner; gi++; }
        }
        updateFF(); const ff=userBracket.finalFour;
        ff.game1.winner=botBracket.finalFour.game1.winner; userBracket.championship.teamA=ff.game1.winner;
        ff.game2.winner=botBracket.finalFour.game2.winner; userBracket.championship.teamB=ff.game2.winner;
        userBracket.championship.winner=botBracket.championship.winner;
        refreshAll();
    }

    // ---- Progress ----
    function updateProgress() {
        let c=0; for(const rn of MarchMadnessData.REGION_NAMES) for(const rd of userBracket.regions[rn]) c+=rd.filter(w=>w).length;
        if(userBracket.finalFour.game1.winner) c++; if(userBracket.finalFour.game2.winner) c++; if(userBracket.championship.winner) c++;
        totalPicks=c; const pct=(c/TOTAL_GAMES)*100;
        document.getElementById('progress-fill').style.width=pct+'%'; document.getElementById('progress-fill').parentElement.setAttribute('aria-valuenow',c);
        document.getElementById('progress-text').textContent=`${c} / ${TOTAL_GAMES}`;
    }

    // ---- Tooltip ----
    function showTip(e,tA,tB) {
        const tip=document.getElementById('tooltip'), ins=PredictionEngine.getMatchupInsight(tA,tB);
        tip.querySelector('.tip-matchup').textContent=`(${tA.seed}) ${tA.name} vs (${tB.seed}) ${tB.name}`;
        tip.querySelector('.tip-prob').textContent=`${ins.favorite.name}: ${(ins.probability*100).toFixed(1)}% (CI: ${(ins.ci.low*100).toFixed(0)}%-${(ins.ci.high*100).toFixed(0)}%)`;
        tip.querySelector('.tip-record').textContent=ins.historicalRecord?`Historical: ${ins.historicalRecord}`:'';
        tip.querySelector('.tip-note').textContent=ins.historicalNote||ins.insight;
        tip.querySelector('.tip-whatif').textContent='';
        const rect=(e.target||e.currentTarget).getBoundingClientRect();
        tip.style.left=Math.min(rect.right+8,window.innerWidth-300)+'px'; tip.style.top=Math.min(rect.top,window.innerHeight-130)+'px';
        tip.classList.add('visible');
    }
    function hideTip() { document.getElementById('tooltip').classList.remove('visible'); }

    // ---- Toast & Confetti ----
    function showToast(m) { const t=document.getElementById('toast'); t.textContent=m; t.classList.add('visible'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('visible'),2500); }
    function launchConfetti() {
        const c=document.getElementById('confetti-container'), cols=['#ff6b35','#4ecdc4','#ffd700','#a855f7','#22c55e','#ef4444'];
        for(let i=0;i<80;i++){const p=document.createElement('div');p.className='confetti-piece';p.style.left=Math.random()*100+'%';p.style.background=cols[Math.floor(Math.random()*cols.length)];p.style.animationDuration=2+Math.random()*2+'s';p.style.animationDelay=Math.random()*.5+'s';p.style.width=6+Math.random()*8+'px';p.style.height=6+Math.random()*8+'px';p.style.borderRadius=Math.random()>.5?'50%':'0';c.appendChild(p);}
        setTimeout(()=>{c.innerHTML='';},4000);
    }

    // ---- Bot Bracket ----
    function renderBotBracket() {
        const grid=document.getElementById('bot-picks-grid'); grid.innerHTML='';
        for(const rn of MarchMadnessData.REGION_NAMES){
            const card=document.createElement('div'); card.className='bot-region-card';
            const h4=document.createElement('h4'); h4.textContent=rn+' Region'; card.appendChild(h4);
            for(const g of botBracket[rn].games){
                const loser=g.winner===g.teamA?g.teamB:g.teamA;
                const row=document.createElement('div'); row.className='bot-pick-row'; row.setAttribute('tabindex','0'); row.style.cursor='pointer';
                row.innerHTML=`<span class="bot-pick-round">${MarchMadnessData.ROUND_SHORT[g.round-1]}</span><span class="bot-pick-winner" style="${g.isUpset?'color:var(--accent-orange)':''}">(${g.winner.seed}) ${g.winner.name}</span><span class="bot-pick-vs">over (${loser.seed}) ${loser.name}</span><span class="bot-pick-prob" style="color:${g.probability>=.7?'var(--safe)':g.probability>=.45?'var(--moderate)':'var(--risky)'}">${(g.probability*100).toFixed(0)}%</span><div class="bot-pick-explain">${g.explanation}</div>`;
                const toggle=()=>row.classList.toggle('expanded'); row.addEventListener('click',toggle); row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
                card.appendChild(row);
            }
            const cr=document.createElement('div'); cr.style.cssText='margin-top:5px;padding-top:5px;border-top:1px solid var(--border);text-align:center;font-weight:700;color:var(--accent-gold);font-size:.8rem;'; cr.textContent=`Winner: (${botBracket[rn].champion.seed}) ${botBracket[rn].champion.name}`; card.appendChild(cr);
            grid.appendChild(card);
        }
        // Bot FF
        const ffd=document.getElementById('bot-ff-display'); ffd.innerHTML='';
        const ffg=document.createElement('div'); ffg.className='final-four-games';
        for(const [g,l] of [[botBracket.finalFour.game1,'Semifinal 1'],[botBracket.finalFour.game2,'Semifinal 2']]){
            const el=document.createElement('div'); el.className='ff-game';
            el.innerHTML=`<div class="ff-label">${l}</div><div class="team-slot ${g.winner.name===g.teamA.name?'winner':'eliminated'}" style="border-bottom:1px solid var(--border)"><span class="team-seed" data-tier="${seedTier(g.teamA.seed)}">${g.teamA.seed}</span><span class="team-name">${g.teamA.name}</span></div><div class="team-slot ${g.winner.name===g.teamB.name?'winner':'eliminated'}"><span class="team-seed" data-tier="${seedTier(g.teamB.seed)}">${g.teamB.seed}</span><span class="team-name">${g.teamB.name}</span></div>`;
            ffg.appendChild(el);
        }
        ffd.appendChild(ffg);
        const ch=botBracket.championship, cd=document.createElement('div'); cd.className='champion-display'; cd.style.marginTop='12px';
        cd.innerHTML=`<div class="label">Bot's Champion</div><div class="champ-name">${ch.winner.name}</div><div class="champ-seed">#${ch.winner.seed} Seed &mdash; ${(ch.probability*100).toFixed(1)}%</div>`; ffd.appendChild(cd);
    }

    // ---- Analysis with Charts ----
    function renderAnalysis() {
        const container=document.getElementById('analysis-content');
        if(totalPicks<1){ container.innerHTML='<div class="empty-state"><div class="icon">📊</div><h3>Fill in your bracket first</h3></div>'; return; }
        const a=PredictionEngine.analyzeUserBracket(userBracket,tournamentData);
        const mc=a.bracketScore>=70?'safe':a.bracketScore>=40?'moderate':'risky';
        const rc=a.bracketScore>=70?'var(--safe)':a.bracketScore>=40?'var(--moderate)':'var(--risky)';
        const sn=MarchMadnessData.SCORING_SYSTEMS[settings.scoring]?.name||'Standard';
        const ep=a.expectedPoints[settings.scoring]||0;
        // Diversity score
        const ds=calcDiversity(a);
        const dsCls=ds>=70?'unique':ds>=40?'average':'common';
        const dsLabel=ds>=70?'Unique':ds>=40?'Average':'Common';

        container.innerHTML=`
        <div class="analysis-grid">
            <div class="analysis-card">
                <h3>Bracket Score</h3>
                <div style="text-align:center;padding:6px 0"><div class="stat-value score">${a.bracketScore.toFixed(1)}</div><div style="font-size:.7rem;color:var(--text-secondary)">out of 100</div></div>
                <div class="meter"><div class="meter-fill ${mc}" style="width:${a.bracketScore}%"></div></div>
                <div class="stat-row" style="margin-top:8px"><span class="stat-label">Percentile</span><span class="stat-value" style="font-size:.82rem;color:var(--accent-gold)">Top ${100-a.percentile}%</span></div>
                <div class="stat-row"><span class="stat-label">Diversity</span><span class="diversity-badge ${dsCls}">${dsLabel} (${ds})</span></div>
                <div class="stat-row"><span class="stat-label">Probability</span><span class="stat-value" style="font-size:.78rem">${a.overallProbability.toExponential(2)}</span></div>
                <div class="stat-row"><span class="stat-label">Picks</span><span class="stat-value" style="font-size:.78rem">${a.totalFilled}/${TOTAL_GAMES}</span></div>
            </div>
            <div class="analysis-card">
                <h3>Risk Profile</h3>
                <div class="stat-row"><span class="stat-label">Risk Level</span><span class="stat-value" style="font-size:.82rem;color:${rc}">${a.riskLevel}</span></div>
                <div class="stat-row"><span class="stat-label">Upsets</span><span class="stat-value" style="font-size:.82rem">${a.upsetCount} <span style="font-size:.62rem;color:var(--text-muted)">(avg ~8-10)</span></span></div>
                <div class="stat-row"><span class="stat-label">Safe (&gt;70%)</span><span class="stat-value" style="color:var(--safe)">${a.picks.filter(p=>p.riskCategory==='safe').length}</span></div>
                <div class="stat-row"><span class="stat-label">Moderate</span><span class="stat-value" style="color:var(--moderate)">${a.picks.filter(p=>p.riskCategory==='moderate').length}</span></div>
                <div class="stat-row"><span class="stat-label">Risky</span><span class="stat-value" style="color:var(--risky)">${a.picks.filter(p=>p.riskCategory==='risky'||p.riskCategory==='longshot').length}</span></div>
                <div class="stat-row" style="margin-top:6px;border-top:1px solid var(--border);padding-top:6px"><span class="stat-label">Expected Pts (${sn})</span><span class="stat-value" style="font-size:.9rem;color:var(--accent-gold)">${ep}</span></div>
            </div>
            <div class="analysis-card full-width">
                <h3>Pick Distribution</h3>
                <div class="chart-container" id="chart-container"></div>
            </div>
            <div class="analysis-card full-width">
                <h3>Suggestions</h3>
                ${a.suggestions.length===0?'<p style="color:var(--text-secondary);font-size:.78rem">No suggestions yet.</p>':a.suggestions.map(s=>`<div class="suggestion-item ${s.type}"><span class="suggestion-icon">${s.type==='risk'?'!!':s.type==='strategy'?'*':'i'}</span><span class="suggestion-text">${s.message}${s.probImprovement?` <strong>(${s.probImprovement})</strong>`:''}</span></div>`).join('')}
            </div>
            <div class="analysis-card full-width">
                <h3>All Picks by Risk (${a.totalFilled})</h3>
                <div class="pick-list">${a.picks.sort((x,y)=>x.probability-y.probability).map(p=>`<div class="pick-item" title="${p.explanation}"><span class="round-badge">${MarchMadnessData.ROUND_SHORT[p.round-1]}</span><span style="font-weight:600">(${p.winner.seed}) ${p.winner.name}</span><span class="vs-text">over (${p.loser.seed}) ${p.loser.name}</span><span class="prob-badge ${p.riskCategory}">${(p.probability*100).toFixed(1)}%</span></div>`).join('')}</div>
            </div>
        </div>`;

        // Draw charts
        setTimeout(()=>drawCharts(a),50);
    }

    function calcDiversity(a) {
        if(a.totalFilled===0) return 50;
        let score=50;
        score += a.upsetCount * 5; // Upsets add diversity
        const champSeed = a.roundBreakdown[6]?.[0]?.winner?.seed;
        if(champSeed && champSeed > 3) score += 15;
        if(champSeed && champSeed > 6) score += 10;
        const has12over5 = a.picks.some(p=>p.round===1&&p.winner.seed===12&&p.loser.seed===5);
        if(has12over5) score += 5;
        // Penalize pure chalk
        if(a.upsetCount===0) score -= 30;
        return Math.max(0,Math.min(100,score));
    }

    function drawCharts(a) {
        const container=document.getElementById('chart-container');
        if(!container) return;
        // Pie chart: risk distribution
        const safe=a.picks.filter(p=>p.riskCategory==='safe').length;
        const mod=a.picks.filter(p=>p.riskCategory==='moderate').length;
        const risk=a.picks.filter(p=>p.riskCategory==='risky').length;
        const long=a.picks.filter(p=>p.riskCategory==='longshot').length;
        const pieData=[{v:safe,c:'#22c55e',l:'Safe'},{v:mod,c:'#f59e0b',l:'Moderate'},{v:risk,c:'#ef4444',l:'Risky'},{v:long,c:'#a855f7',l:'Longshot'}].filter(d=>d.v>0);
        if(pieData.length>0){
            const card=document.createElement('div'); card.className='chart-card';
            const cv=document.createElement('canvas'); cv.width=160; cv.height=160; card.appendChild(cv);
            const title=document.createElement('div'); title.className='chart-title'; title.textContent='Risk Distribution'; card.appendChild(title);
            container.appendChild(card);
            const ctx=cv.getContext('2d'), total=pieData.reduce((s,d)=>s+d.v,0);
            let angle=-Math.PI/2;
            for(const d of pieData){
                const slice=d.v/total*Math.PI*2;
                ctx.beginPath(); ctx.moveTo(80,80); ctx.arc(80,80,70,angle,angle+slice); ctx.fillStyle=d.c; ctx.fill();
                // Label
                const mid=angle+slice/2, lx=80+Math.cos(mid)*45, ly=80+Math.sin(mid)*45;
                ctx.fillStyle='#fff'; ctx.font='bold 11px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(d.v,lx,ly+4);
                angle+=slice;
            }
            // Legend
            const leg=document.createElement('div'); leg.style.cssText='display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px;';
            for(const d of pieData) leg.innerHTML+=`<span style="font-size:.65rem;color:${d.c};font-weight:600">${d.l}: ${d.v}</span>`;
            card.appendChild(leg);
        }

        // Bar chart: upsets by round
        const barData=[];
        for(let r=1;r<=6;r++){
            const rPicks=a.roundBreakdown[r]||[];
            const upsets=rPicks.filter(p=>p.isUpset).length;
            const avg=MarchMadnessData.AVG_UPSETS_PER_ROUND[r]||0;
            barData.push({round:MarchMadnessData.ROUND_SHORT[r-1],upsets,avg});
        }
        if(barData.some(d=>d.upsets>0||d.avg>0)){
            const card=document.createElement('div'); card.className='chart-card';
            const cv=document.createElement('canvas'); cv.width=200; cv.height=160; card.appendChild(cv);
            const title=document.createElement('div'); title.className='chart-title'; title.textContent='Upsets by Round'; card.appendChild(title);
            container.appendChild(card);
            const ctx=cv.getContext('2d'), maxV=Math.max(...barData.map(d=>Math.max(d.upsets,d.avg)),1);
            const bw=22, gap=10, startX=15;
            for(let i=0;i<barData.length;i++){
                const x=startX+i*(bw*2+gap);
                // User bar
                const h1=(barData[i].upsets/maxV)*110;
                ctx.fillStyle='#ff6b35'; ctx.fillRect(x,140-h1,bw,h1);
                // Avg bar
                const h2=(barData[i].avg/maxV)*110;
                ctx.fillStyle='rgba(78,205,196,.4)'; ctx.fillRect(x+bw,140-h2,bw,h2);
                // Label
                ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--text-muted').trim()||'#5a6580';
                ctx.font='bold 9px Inter,sans-serif'; ctx.textAlign='center'; ctx.fillText(barData[i].round,x+bw,154);
            }
            const leg=document.createElement('div'); leg.style.cssText='display:flex;gap:10px;justify-content:center;margin-top:4px;font-size:.62rem;';
            leg.innerHTML='<span style="color:#ff6b35;font-weight:600">Your upsets</span><span style="color:#4ecdc4;font-weight:600">Avg upsets</span>';
            card.appendChild(leg);
        }
    }

    // ---- Head to Head ----
    function renderH2H() {
        const container=document.getElementById('h2h-content');
        if(totalPicks<1){ container.innerHTML='<div class="empty-state"><div class="icon">&#9876;</div><h3>Make picks first</h3></div>'; return; }
        let matches=0,diffs=0; const comps=[];
        for(const rn of MarchMadnessData.REGION_NAMES){
            const ur=userBracket.regions[rn],bg=botBracket[rn].games; let bi=0;
            for(let r=0;r<4;r++) for(let m=0;m<ur[r].length;m++){ const up=ur[r][m],bb=bg[bi]; bi++; if(up){const mt=bb.winner.name===up.name;mt?matches++:diffs++;comps.push({round:r+1,userPick:up,botPick:bb.winner,match:mt});}}
        }
        for(const [ug,bg] of [[userBracket.finalFour.game1,botBracket.finalFour.game1],[userBracket.finalFour.game2,botBracket.finalFour.game2]]){if(ug.winner){const m=bg.winner.name===ug.winner.name;m?matches++:diffs++;comps.push({round:5,userPick:ug.winner,botPick:bg.winner,match:m});}}
        if(userBracket.championship.winner){const m=botBracket.championship.winner.name===userBracket.championship.winner.name;m?matches++:diffs++;comps.push({round:6,userPick:userBracket.championship.winner,botPick:botBracket.championship.winner,match:m});}
        const total=matches+diffs, pct=total>0?((matches/total)*100).toFixed(0):0;
        container.innerHTML=`<div class="h2h-header"><div class="pct">${pct}%</div><div class="label">Agreement &mdash; ${matches} match, ${diffs} differ (${total} picks)</div></div>
        <div class="h2h-container"><div class="h2h-column user"><h3>Your Picks</h3>${comps.map(c=>`<div class="h2h-row ${c.match?'match':'differ'}"><span class="round-badge">${MarchMadnessData.ROUND_SHORT[c.round-1]}</span><span class="h2h-pick-name">${c.userPick.name}</span><span class="h2h-pick-seed">(${c.userPick.seed})</span></div>`).join('')}</div>
        <div class="h2h-diff">${comps.map(c=>`<div class="h2h-vs">${c.match?'=':'&#8800;'}</div>`).join('')}</div>
        <div class="h2h-column bot"><h3>Bot Picks</h3>${comps.map(c=>`<div class="h2h-row ${c.match?'match':'differ'}"><span class="round-badge">${MarchMadnessData.ROUND_SHORT[c.round-1]}</span><span class="h2h-pick-name">${c.botPick.name}</span><span class="h2h-pick-seed">(${c.botPick.seed})</span></div>`).join('')}</div></div>`;
    }

    // ---- Monte Carlo ----
    let simDone=false;
    function runSim() {
        const c=document.getElementById('simulate-content');
        if(simDone&&mcResults){ renderSim(c); return; }
        c.innerHTML='<div class="empty-state"><div class="icon">&#127922;</div><h3>Running 5,000 Simulations...</h3><div class="loading-spinner" style="margin:16px auto"></div></div>';
        requestAnimationFrame(()=>setTimeout(()=>{mcResults=PredictionEngine.monteCarloSimulate(tournamentData,5000);simDone=true;renderSim(c);},50));
    }
    function renderSim(c) {
        const sorted=Object.values(mcResults).sort((a,b)=>b.championshipProb-a.championshipProb).slice(0,20);
        const mx=sorted[0]?.championshipProb||.01;
        const rh=['R64','R32','S16','E8','FF','Champ','Win'];
        c.innerHTML=`<div class="analysis-card full-width" style="margin-bottom:12px"><h3>Championship Probabilities (5,000 sims)</h3><p style="font-size:.73rem;color:var(--text-secondary);margin-bottom:10px">Each team's chance of winning it all.</p>${sorted.map(t=>`<div class="mc-bar"><span class="bar-label">(${t.team.seed}) ${t.team.name}</span><div style="flex:1;background:var(--bg-input);border-radius:4px;overflow:hidden"><div class="bar-fill" style="width:${(t.championshipProb/mx)*100}%"></div></div><span class="bar-pct">${(t.championshipProb*100).toFixed(1)}%</span></div>`).join('')}</div>
        <div class="analysis-card full-width"><h3>Round-by-Round (Top 20)</h3><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.72rem"><thead><tr style="border-bottom:1px solid var(--border)"><th style="text-align:left;padding:3px 5px;color:var(--text-muted);font-size:.62rem">TEAM</th>${rh.map(r=>`<th style="text-align:center;padding:3px;color:var(--text-muted);font-size:.62rem">${r}</th>`).join('')}</tr></thead><tbody>${sorted.map(t=>`<tr style="border-bottom:1px solid rgba(128,128,128,.04)"><td style="padding:3px 5px;font-weight:600;white-space:nowrap">(${t.team.seed}) ${t.team.name}</td>${t.roundReach.map(p=>`<td style="text-align:center;padding:3px;font-family:var(--mono);font-size:.65rem;color:${p>.5?'var(--safe)':p>.2?'var(--moderate)':p>.05?'var(--text-secondary)':'var(--text-muted)'}">${(p*100).toFixed(1)}%</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
    }

    // ---- Export as Image ----
    function setupExport() {
        document.getElementById('btn-export').addEventListener('click', exportImage);
    }
    function exportImage() {
        const cv=document.getElementById('export-canvas'), ctx=cv.getContext('2d');
        const W=1200, H=800; cv.width=W; cv.height=H;
        // Background
        ctx.fillStyle='#0a0e1a'; ctx.fillRect(0,0,W,H);
        // Title
        ctx.fillStyle='#ff6b35'; ctx.font='bold 28px Inter,sans-serif'; ctx.textAlign='center';
        const name=document.getElementById('bracket-name-input').value||'My Bracket';
        ctx.fillText(`March Madness ${new Date().getFullYear()} — ${name}`,W/2,40);
        // Draw 4 regions
        const regions=MarchMadnessData.REGION_NAMES;
        const regionW=280, regionH=340, startY=65;
        for(let ri=0;ri<4;ri++){
            const rx=(ri%2)*(regionW+30)+30, ry=startY+(ri>=2?regionH+30:0);
            ctx.fillStyle='#1a2236'; ctx.beginPath(); ctx.roundRect(rx,ry,regionW,regionH,8); ctx.fill();
            ctx.fillStyle='#4ecdc4'; ctx.font='bold 13px Inter,sans-serif'; ctx.textAlign='center';
            ctx.fillText(regions[ri]+' Region',rx+regionW/2,ry+18);
            // Draw matchups
            const rn=regions[ri], ordered=MarchMadnessData.getTeamsInBracketOrder(tournamentData.regions[rn]);
            const mp=[8,4,2,1]; let y=ry+28;
            for(let m=0;m<8;m++){
                const w=userBracket.regions[rn][0][m];
                const tA=ordered[m*2], tB=ordered[m*2+1];
                ctx.font='11px Inter,sans-serif'; ctx.textAlign='left';
                ctx.fillStyle=w?.name===tA.name?'#22c55e':'#8b99b8';
                ctx.fillText(`${tA.seed} ${tA.name}`,rx+8,y+10);
                ctx.fillStyle=w?.name===tB.name?'#22c55e':'#8b99b8';
                ctx.fillText(`${tB.seed} ${tB.name}`,rx+8,y+22);
                // R32 winner
                const r32w=userBracket.regions[rn][1][Math.floor(m/2)];
                if(m%2===0&&r32w){ctx.fillStyle='#ffd700';ctx.font='10px Inter,sans-serif';ctx.fillText(r32w.name,rx+140,y+16);}
                // S16
                if(m%4===0){const s16w=userBracket.regions[rn][2][Math.floor(m/4)];if(s16w){ctx.fillStyle='#ff6b35';ctx.font='10px Inter,sans-serif';ctx.fillText(s16w.name,rx+200,y+26);}}
                // E8
                if(m===0){const e8w=userBracket.regions[rn][3][0];if(e8w){ctx.fillStyle='#a855f7';ctx.font='bold 11px Inter,sans-serif';ctx.fillText('E8: '+e8w.name,rx+200,ry+regionH-10);}}
                y+=regionH/8-4;
            }
        }
        // Champion
        if(userBracket.championship.winner){
            ctx.fillStyle='#ffd700'; ctx.font='bold 22px Inter,sans-serif'; ctx.textAlign='center';
            ctx.fillText('Champion: '+userBracket.championship.winner.name,W/2,H-20);
        }
        // Download
        const link=document.createElement('a'); link.download=`march-madness-${new Date().getFullYear()}.png`; link.href=cv.toDataURL('image/png'); link.click();
        showToast('Bracket exported as PNG!');
    }

    // ---- Share via URL ----
    function setupShare() {
        document.getElementById('btn-share').addEventListener('click', shareBracket);
    }
    function shareBracket() {
        try {
            const data={r:{},f:{},c:null,n:document.getElementById('bracket-name-input').value};
            for(const rn of MarchMadnessData.REGION_NAMES) data.r[rn]=userBracket.regions[rn].map(rd=>rd.map(t=>t?t.seed:0));
            data.f={g1:userBracket.finalFour.game1.winner?.seed||0,g2:userBracket.finalFour.game2.winner?.seed||0};
            data.c=userBracket.championship.winner?.seed||0;
            const encoded=btoa(JSON.stringify(data));
            const url=window.location.origin+window.location.pathname+'#b='+encoded;
            navigator.clipboard.writeText(url).then(()=>showToast('Bracket link copied!')).catch(()=>{prompt('Copy this link:',url);});
        } catch(e){ showToast('Could not generate share link'); }
    }

    // ---- Multiple Brackets ----
    function setupMultipleBrackets() {
        document.getElementById('btn-save-bracket').addEventListener('click', saveAsNew);
        const sel=document.getElementById('bracket-selector');
        sel.addEventListener('change', (e)=>{ if(e.target.value) loadNamedBracket(e.target.value); });
        refreshBracketList();
    }
    function saveAsNew() {
        const name=document.getElementById('bracket-name-input').value||`Bracket ${Date.now()%10000}`;
        const data=JSON.stringify(userBracket);
        const list=JSON.parse(localStorage.getItem('mm-brackets')||'[]');
        list.push({name,data,date:Date.now()});
        if(list.length>10) list.shift();
        localStorage.setItem('mm-brackets',JSON.stringify(list));
        refreshBracketList();
        showToast(`Saved as "${name}"`);
    }
    function loadNamedBracket(idx) {
        const list=JSON.parse(localStorage.getItem('mm-brackets')||'[]');
        const item=list[idx];
        if(!item) return;
        pushUndo();
        userBracket=JSON.parse(item.data); restoreRefs();
        document.getElementById('bracket-name-input').value=item.name;
        refreshAll(); showToast(`Loaded "${item.name}"`);
        document.getElementById('bracket-selector').value='';
    }
    function refreshBracketList() {
        const sel=document.getElementById('bracket-selector');
        const list=JSON.parse(localStorage.getItem('mm-brackets')||'[]');
        sel.innerHTML='<option value="">Saved Brackets ('+ list.length+')</option>';
        list.forEach((b,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=b.name; sel.appendChild(o); });
    }

    // ---- Settings ----
    function setupSettings() {
        const panel=document.getElementById('settings-panel'),overlay=document.getElementById('settings-overlay');
        document.getElementById('btn-settings').addEventListener('click',()=>{panel.classList.add('open');overlay.classList.add('active');});
        const close=()=>{panel.classList.remove('open');overlay.classList.remove('active');};
        document.getElementById('btn-close-settings').addEventListener('click',close); overlay.addEventListener('click',close);
        const bind=(id,key)=>{document.getElementById(id).addEventListener('change',e=>{settings[key]=e.target.checked;applySettings();saveSettings();if(currentView==='analysis')renderAnalysis();});};
        bind('setting-dark','dark'); bind('setting-particles','particles'); bind('setting-probs','probs');
        bind('setting-sounds','sounds'); bind('setting-autosave','autosave'); bind('setting-seed-colors','seedColors');
        bind('setting-reduce-motion','reduceMotion');
        document.getElementById('setting-scoring').addEventListener('change',e=>{settings.scoring=e.target.value;saveSettings();if(currentView==='analysis')renderAnalysis();});
    }
    function applySettings() {
        document.documentElement.setAttribute('data-theme',settings.dark?'dark':'light');
        document.body.setAttribute('data-particles',settings.particles?'on':'off');
        document.body.setAttribute('data-show-probs',settings.probs?'on':'off');
        document.body.setAttribute('data-seed-colors',settings.seedColors?'on':'off');
        document.body.setAttribute('data-reduce-motion',settings.reduceMotion?'on':'off');
        document.getElementById('setting-dark').checked=settings.dark;
        document.getElementById('setting-particles').checked=settings.particles;
        document.getElementById('setting-probs').checked=settings.probs;
        document.getElementById('setting-sounds').checked=settings.sounds;
        document.getElementById('setting-autosave').checked=settings.autosave;
        document.getElementById('setting-seed-colors').checked=settings.seedColors;
        document.getElementById('setting-reduce-motion').checked=settings.reduceMotion;
        document.getElementById('setting-scoring').value=settings.scoring;
    }
    function saveSettings() { try{localStorage.setItem('mm-settings',JSON.stringify(settings));}catch(e){} }
    function loadSettings() { try{const s=JSON.parse(localStorage.getItem('mm-settings'));if(s)settings={...settings,...s};}catch(e){} }

    // ---- Seed Legend ----
    function setupSeedLegend() {
        document.getElementById('btn-seed-legend').addEventListener('click',()=>{document.getElementById('seed-legend-modal').classList.add('active');renderLegend();});
        document.getElementById('btn-close-legend').addEventListener('click',()=>document.getElementById('seed-legend-modal').classList.remove('active'));
        document.getElementById('seed-legend-modal').addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))document.getElementById('seed-legend-modal').classList.remove('active');});
    }
    function renderLegend() {
        const c=document.getElementById('seed-legend-rows'); c.innerHTML='';
        c.innerHTML='<div class="seed-row header"><span>Match</span><span>History</span><span>Record</span><span>Win%</span></div>';
        for(const key of ['1v16','2v15','3v14','4v13','5v12','6v11','7v10','8v9']){
            const h=MarchMadnessData.SEED_MATCHUP_HISTORY[key], hist=MarchMadnessData.ROUND1_HISTORICAL[key], pct=(hist*100).toFixed(1);
            c.innerHTML+=`<div class="seed-row"><span style="font-weight:700;color:var(--accent-blue)">${key}</span><div><div class="seed-bar" style="width:${pct}%;max-width:100%"></div><div style="font-size:.66rem;color:var(--text-muted);margin-top:2px">${h?.note||''}</div></div><span style="font-family:var(--mono);font-size:.7rem">${h?h.wins+'-'+h.losses:''}</span><span style="font-family:var(--mono);font-size:.7rem;font-weight:700;color:var(--safe)">${pct}%</span></div>`;
        }
    }

    // ---- Keyboard Shortcuts Modal ----
    function setupKeysModal() {
        document.getElementById('btn-keys').addEventListener('click',()=>{document.getElementById('keys-modal').classList.add('active');renderKeys();});
        document.getElementById('btn-close-keys').addEventListener('click',()=>document.getElementById('keys-modal').classList.remove('active'));
        document.getElementById('keys-modal').addEventListener('click',e=>{if(e.target.classList.contains('modal-overlay'))document.getElementById('keys-modal').classList.remove('active');});
    }
    function renderKeys() {
        const c=document.getElementById('keys-list');
        const keys=[['Ctrl+Z','Undo'],['Ctrl+Shift+Z / Ctrl+Y','Redo'],['1-5','Switch region'],['Escape','Close panel/modal'],['Tab','Navigate between teams'],['Enter / Space','Select team'],['Ctrl+P','Print bracket']];
        c.innerHTML=keys.map(([k,d])=>`<div class="key-row"><span>${d}</span><span class="key-combo">${k}</span></div>`).join('');
    }

    // ---- Onboarding ----
    function setupOnboarding() {
        const ob=document.getElementById('onboarding');
        if(!localStorage.getItem('mm-onboard-seen')) ob.classList.add('active');
        document.getElementById('btn-start').addEventListener('click',()=>{ob.classList.remove('active');localStorage.setItem('mm-onboard-seen','1');});
    }

    // ---- Ask the Bot ----
    function setupAskBot() {
        const input = document.getElementById('ask-bot-input');
        const btn = document.getElementById('ask-bot-send');
        const sugContainer = document.getElementById('ask-bot-suggestions');
        if (!input || !btn) return;

        // Suggested questions
        const suggestions = [
            'Who wins the championship?',
            'What upsets do you predict?',
            'Why Duke over Siena?',
            'Tell me about Florida',
            'Who wins the East?',
            'Biggest upset pick?',
            'Final Four teams?',
            'How far does Kentucky go?'
        ];
        for (const q of suggestions) {
            const chip = document.createElement('button');
            chip.className = 'ask-bot-chip';
            chip.textContent = q;
            chip.addEventListener('click', () => { input.value = q; askBot(q); });
            sugContainer.appendChild(chip);
        }

        btn.addEventListener('click', () => askBot(input.value));
        input.addEventListener('keydown', e => { if (e.key === 'Enter') askBot(input.value); });
    }

    function askBot(question) {
        const q = question.trim().toLowerCase();
        if (!q) return;
        const resp = document.getElementById('ask-bot-response');

        // Find all team names for matching
        const allTeams = [];
        for (const rn of MarchMadnessData.REGION_NAMES) {
            for (const t of tournamentData.regions[rn]) allTeams.push(t);
        }

        const answer = generateBotAnswer(q, allTeams);
        resp.innerHTML = `<div class="ask-bot-answer">${answer}</div>`;
    }

    function generateBotAnswer(q, allTeams) {
        const stats = MarchMadnessData.getSeasonStats();
        const R = MarchMadnessData.REGION_NAMES;

        // Match team names in query
        const matchedTeams = allTeams.filter(t => q.includes(t.name.toLowerCase()));

        // ---- Championship question ----
        if (q.includes('champion') || q.includes('win it all') || q.includes('national') || (q.includes('who') && q.includes('win') && !matchedTeams.length)) {
            const ch = botBracket.champion;
            const s = stats[ch.name];
            let ans = `<strong>${ch.name}</strong> is my pick to win the national championship as the <span class="stat-highlight">#${ch.seed} seed</span> from the ${findTeamRegion(ch.name)} region.`;
            ans += `<div class="section-label">Why ${ch.name}?</div>`;
            if (s && s.ppg) {
                ans += `<div class="matchup-detail">Season: ${s.wins || '?'}-${s.losses || '?'} | ${s.ppg?.toFixed(1) || '?'} PPG | ${s.papg?.toFixed(1) || '?'} PAPG`;
                if (s.fgPct) ans += ` | ${(s.fgPct * 100).toFixed(1)}% FG`;
                ans += `</div>`;
            }
            ans += `Championship game win probability: <span class="stat-highlight">${(botBracket.championship.probability * 100).toFixed(1)}%</span>. `;
            ans += botBracket.championship.explanation || '';
            return ans;
        }

        // ---- Final Four question ----
        if (q.includes('final four') || q.includes('final 4')) {
            const ff = [
                botBracket.finalFour.game1.winner,
                botBracket.finalFour.game2.winner,
                botBracket[R[0]].champion, botBracket[R[1]].champion,
                botBracket[R[2]].champion, botBracket[R[3]].champion
            ];
            const unique = [...new Set(ff.filter(t => t).map(t => `(${t.seed}) ${t.name}`))].slice(0, 4);
            let ans = `<strong>My Final Four:</strong><br>`;
            for (let i = 0; i < R.length; i++) {
                const ch = botBracket[R[i]].champion;
                const s = stats[ch.name];
                ans += `<div class="matchup-detail"><strong>${R[i]}:</strong> (${ch.seed}) ${ch.name}`;
                if (s && s.wins) ans += ` — ${s.wins}-${s.losses}`;
                ans += `</div>`;
            }
            ans += `<div class="section-label">Semifinal matchups</div>`;
            ans += `${botBracket.finalFour.game1.winner.name} vs ${botBracket.finalFour.game2.winner.name} for the title.`;
            return ans;
        }

        // ---- Upsets question ----
        if (q.includes('upset') || q.includes('cinderella') || q.includes('surprise')) {
            const upsets = [];
            for (const rn of R) {
                for (const g of botBracket[rn].games) {
                    if (g.isUpset) upsets.push(g);
                }
            }
            if (upsets.length === 0) return 'I don\'t predict any upsets in this tournament — chalk all the way. The higher seeds are significantly stronger across the board this year.';

            let ans = `<strong>I predict ${upsets.length} upset(s):</strong>`;
            const sorted = upsets.sort((a, b) => a.probability - b.probability);
            for (const u of sorted) {
                const loser = u.winner === u.teamA ? u.teamB : u.teamA;
                ans += `<div class="matchup-detail"><strong>(${u.winner.seed}) ${u.winner.name}</strong> over (${loser.seed}) ${loser.name} in ${MarchMadnessData.ROUND_NAMES[u.round - 1]} — <span class="stat-highlight">${(u.probability * 100).toFixed(1)}%</span>`;
                const sw = stats[u.winner.name];
                if (sw && sw.ppg) ans += ` | ${u.winner.name}: ${sw.ppg.toFixed(1)} PPG`;
                ans += `</div>`;
            }
            if (sorted.length > 0) {
                ans += `<div class="section-label">Biggest upset</div>${sorted[0].winner.name} over ${(sorted[0].winner === sorted[0].teamA ? sorted[0].teamB : sorted[0].teamA).name} at just ${(sorted[0].probability * 100).toFixed(1)}% probability.`;
            }
            return ans;
        }

        // ---- Region winner question ----
        for (const rn of R) {
            if (q.includes(rn.toLowerCase()) && (q.includes('win') || q.includes('champion') || q.includes('region'))) {
                const ch = botBracket[rn].champion;
                const s = stats[ch.name];
                let ans = `<strong>(${ch.seed}) ${ch.name}</strong> wins the ${rn} region.`;
                if (s && s.ppg) {
                    ans += `<div class="matchup-detail">Season: ${s.wins || '?'}-${s.losses || '?'} | ${s.ppg.toFixed(1)} PPG | ${s.papg?.toFixed(1) || '?'} PAPG</div>`;
                }
                ans += `<div class="section-label">${rn} path</div>`;
                for (const g of botBracket[rn].games) {
                    if (g.winner.name === ch.name) {
                        const loser = g.winner === g.teamA ? g.teamB : g.teamA;
                        ans += `<div class="matchup-detail">${MarchMadnessData.ROUND_SHORT[g.round - 1]}: over (${loser.seed}) ${loser.name} — ${(g.probability * 100).toFixed(0)}%</div>`;
                    }
                }
                return ans;
            }
        }

        // ---- Specific team question ----
        if (matchedTeams.length >= 1) {
            const team = matchedTeams[0];
            const rn = findTeamRegion(team.name);

            // "Why X over Y" or "X vs Y"
            if (matchedTeams.length >= 2 || q.includes(' over ') || q.includes(' vs ') || q.includes(' beat')) {
                const tA = matchedTeams[0];
                const tB = matchedTeams.length >= 2 ? matchedTeams[1] : null;

                // Find the bot's game with these teams
                if (tB) {
                    for (const r of R) {
                        for (const g of botBracket[r].games) {
                            if ((g.teamA.name === tA.name && g.teamB.name === tB.name) || (g.teamA.name === tB.name && g.teamB.name === tA.name)) {
                                const loser = g.winner === g.teamA ? g.teamB : g.teamA;
                                let ans = `<strong>(${g.winner.seed}) ${g.winner.name}</strong> over (${loser.seed}) ${loser.name} in ${MarchMadnessData.ROUND_NAMES[g.round - 1]}.`;
                                ans += `<div class="matchup-detail">Win probability: <span class="stat-highlight">${(g.probability * 100).toFixed(1)}%</span></div>`;
                                ans += `<div class="section-label">Reasoning</div>${g.explanation}`;
                                const sW = stats[g.winner.name], sL = stats[loser.name];
                                if (sW && sW.ppg && sL && sL.ppg) {
                                    ans += `<div class="section-label">Season comparison</div>`;
                                    ans += `<div class="matchup-detail">${g.winner.name}: ${sW.wins || '?'}-${sW.losses || '?'}, ${sW.ppg.toFixed(1)} PPG, ${sW.papg?.toFixed(1) || '?'} PAPG${sW.fgPct ? ', ' + (sW.fgPct * 100).toFixed(1) + '% FG' : ''}</div>`;
                                    ans += `<div class="matchup-detail">${loser.name}: ${sL.wins || '?'}-${sL.losses || '?'}, ${sL.ppg.toFixed(1)} PPG, ${sL.papg?.toFixed(1) || '?'} PAPG${sL.fgPct ? ', ' + (sL.fgPct * 100).toFixed(1) + '% FG' : ''}</div>`;
                                }
                                return ans;
                            }
                        }
                    }
                }
            }

            // "Tell me about X" / "How far does X go"
            let ans = `<strong>(${team.seed}) ${team.name}</strong> — ${team.conference}, ${rn} Region`;
            const s = stats[team.name];
            if (s && s.ppg) {
                ans += `<div class="matchup-detail">Season: ${s.wins || '?'}-${s.losses || '?'} | ${s.ppg.toFixed(1)} PPG | ${s.papg?.toFixed(1) || '?'} PAPG`;
                if (s.fgPct) ans += ` | ${(s.fgPct * 100).toFixed(1)}% FG`;
                if (s.rpg) ans += ` | ${s.rpg.toFixed(1)} RPG`;
                if (s.apg) ans += ` | ${s.apg.toFixed(1)} APG`;
                ans += `</div>`;
            }

            // How far does the bot have them going?
            let furthestRound = 0;
            if (rn) {
                for (const g of botBracket[rn].games) {
                    if (g.winner.name === team.name) furthestRound = g.round;
                }
            }
            // Check FF
            if (botBracket.finalFour.game1.winner?.name === team.name || botBracket.finalFour.game2.winner?.name === team.name) furthestRound = 5;
            if (botBracket.championship.winner?.name === team.name) furthestRound = 6;

            const roundLabels = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship Game', 'National Champion'];
            if (furthestRound > 0) {
                const exitRound = furthestRound < 6 ? furthestRound : 6;
                ans += `<div class="section-label">Bot's prediction</div>`;
                ans += `I have ${team.name} reaching the <strong>${roundLabels[furthestRound]}</strong>`;
                if (furthestRound === 6) ans += ` and winning it all`;
                ans += `.`;

                // Show their path
                if (rn) {
                    ans += `<div class="section-label">Path</div>`;
                    for (const g of botBracket[rn].games) {
                        if (g.winner.name === team.name) {
                            const loser = g.winner === g.teamA ? g.teamB : g.teamA;
                            ans += `<div class="matchup-detail">${MarchMadnessData.ROUND_SHORT[g.round - 1]}: over (${loser.seed}) ${loser.name} — ${(g.probability * 100).toFixed(0)}%</div>`;
                        }
                    }
                }
            } else {
                ans += `<div class="section-label">Bot's prediction</div>I have ${team.name} losing in the first round.`;
                // Find who beats them
                if (rn) {
                    for (const g of botBracket[rn].games) {
                        if (g.round === 1 && (g.teamA.name === team.name || g.teamB.name === team.name) && g.winner.name !== team.name) {
                            ans += ` They lose to <strong>(${g.winner.seed}) ${g.winner.name}</strong> (${(g.probability * 100).toFixed(0)}% probability).`;
                        }
                    }
                }
            }

            // MC simulation data if available
            if (mcResults && mcResults[team.name]) {
                const mc = mcResults[team.name];
                ans += `<div class="section-label">Monte Carlo (5,000 sims)</div>`;
                ans += `<div class="matchup-detail">Championship probability: <span class="stat-highlight">${(mc.championshipProb * 100).toFixed(1)}%</span> | Final Four: ${(mc.roundReach[5] * 100).toFixed(1)}% | Elite 8: ${(mc.roundReach[4] * 100).toFixed(1)}%</div>`;
            }

            return ans;
        }

        // ---- General questions ----
        if (q.includes('how') && q.includes('work')) {
            return 'My predictions use a <strong>log5 probability model</strong> calibrated on 40 years of NCAA tournament data. I fetch real season stats from ESPN (PPG, PAPG, FG%, rebounds, assists, turnovers, win-loss record) for all 64 teams. My composite rating weighs: net rating (30%), win % (25%), offensive efficiency (15%), defensive efficiency (15%), ball security (8%), and rebounding (7%). I blend this with historical seed-based probabilities for the final prediction.';
        }

        if (q.includes('best') && q.includes('team')) {
            const ch = botBracket.champion;
            return `The strongest team in my model is <strong>${ch.name}</strong> (#${ch.seed} seed). They have the highest composite rating when combining season stats, conference strength, and historical seed performance.`;
        }

        if (q.includes('dark horse') || q.includes('sleeper')) {
            // Find highest-seeded team that goes furthest
            let best = null;
            for (const rn of R) {
                const ch = botBracket[rn].champion;
                if (ch.seed >= 4 && (!best || ch.seed > best.seed)) best = ch;
            }
            if (best) {
                return `My dark horse pick is <strong>(${best.seed}) ${best.name}</strong> from the ${findTeamRegion(best.name)} region. They win their region despite being a ${best.seed}-seed, which happens about ${(MarchMadnessData.SEED_ROUND_REACH[best.seed][4] * 100).toFixed(0)}% of the time historically.`;
            }
            return 'No major dark horses this year — the higher seeds are strong across all regions.';
        }

        // Fallback
        return `I'm not sure what you're asking. Try asking about:<br>
        <div class="matchup-detail">- A specific team: "Tell me about Duke"</div>
        <div class="matchup-detail">- A matchup: "Why Duke over Siena?"</div>
        <div class="matchup-detail">- Predictions: "Who wins the championship?"</div>
        <div class="matchup-detail">- Upsets: "What upsets do you predict?"</div>
        <div class="matchup-detail">- Region: "Who wins the East?"</div>
        <div class="matchup-detail">- Dark horses: "Who's your sleeper pick?"</div>`;
    }

    function findTeamRegion(name) {
        for (const rn of MarchMadnessData.REGION_NAMES) {
            if (tournamentData.regions[rn].find(t => t.name === name)) return rn;
        }
        return '';
    }

    // ---- Keyboard ----
    function setupKeyboard() {
        document.addEventListener('keydown',e=>{
            if((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey){e.preventDefault();undo();}
            if((e.ctrlKey||e.metaKey)&&(e.key==='z'&&e.shiftKey||e.key==='y')){e.preventDefault();redo();}
            if(e.key==='Escape'){document.getElementById('settings-panel').classList.remove('open');document.getElementById('settings-overlay').classList.remove('active');document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));document.getElementById('onboarding').classList.remove('active');}
            if(e.key>='1'&&e.key<='5'&&!e.ctrlKey&&!e.metaKey&&!e.target.closest('input,select,textarea')){const tabs=document.querySelectorAll('.region-tab');if(tabs[parseInt(e.key)-1])tabs[parseInt(e.key)-1].click();}
        });
    }

    // ---- Mobile Swipe ----
    function setupSwipe() {
        const bc=document.getElementById('bracket-container');
        bc.addEventListener('touchstart',e=>{touchStartX=e.touches[0].clientX;},{passive:true});
        bc.addEventListener('touchend',e=>{
            const dx=e.changedTouches[0].clientX-touchStartX;
            if(Math.abs(dx)>60){
                const maxR=4; // 0-3 regions + FF
                if(dx<0&&activeRegion<maxR){activeRegion++;} else if(dx>0&&activeRegion>0){activeRegion--;}
                const tabs=document.querySelectorAll('.region-tab');
                if(tabs[activeRegion]) tabs[activeRegion].click();
            }
        },{passive:true});
    }

    // ---- Save/Load ----
    function saveBracket() {
        try {
            const d={year:new Date().getFullYear(),regions:{}};
            for(const r of MarchMadnessData.REGION_NAMES) d.regions[r]=userBracket.regions[r].map(rd=>rd.map(t=>t?t.name:null));
            d.finalFour={game1:{winner:userBracket.finalFour.game1.winner?.name||null},game2:{winner:userBracket.finalFour.game2.winner?.name||null}};
            d.championship={winner:userBracket.championship.winner?.name||null};
            localStorage.setItem('march-madness-bracket',JSON.stringify(d));
        } catch(e){}
    }
    function loadBracket() {
        // Check URL hash for shared bracket
        if(window.location.hash.startsWith('#b=')){
            try{
                const encoded=window.location.hash.slice(3);
                const data=JSON.parse(atob(encoded));
                if(data.n) document.getElementById('bracket-name-input').value=data.n;
                // Load seed-based bracket from shared data
                for(const rn of MarchMadnessData.REGION_NAMES){
                    if(!data.r[rn]) continue;
                    const teams=tournamentData.regions[rn];
                    for(let r=0;r<data.r[rn].length;r++) for(let m=0;m<data.r[rn][r].length;m++){
                        const seed=data.r[rn][r][m];
                        if(seed){const t=teams.find(x=>x.seed===seed);if(t) userBracket.regions[rn][r][m]=t;}
                    }
                }
                updateFF();
                if(data.f?.g1){const t=findTeamBySeed(data.f.g1,userBracket.finalFour.game1);if(t)userBracket.finalFour.game1.winner=t;userBracket.championship.teamA=t;}
                if(data.f?.g2){const t=findTeamBySeed(data.f.g2,userBracket.finalFour.game2);if(t)userBracket.finalFour.game2.winner=t;userBracket.championship.teamB=t;}
                if(data.c) userBracket.championship.winner=findTeam(null,data.c);
                window.history.replaceState(null,'',window.location.pathname);
                showToast('Shared bracket loaded!');
                return;
            } catch(e){}
        }
        try {
            const saved=JSON.parse(localStorage.getItem('march-madness-bracket'));
            if(!saved||saved.year!==new Date().getFullYear()) return;
            for(const rn of MarchMadnessData.REGION_NAMES){
                if(!saved.regions[rn]) continue;
                const teams=tournamentData.regions[rn];
                for(let r=0;r<saved.regions[rn].length;r++) for(let m=0;m<saved.regions[rn][r].length;m++){
                    if(saved.regions[rn][r][m]){const t=teams.find(x=>x.name===saved.regions[rn][r][m]);if(t)userBracket.regions[rn][r][m]=t;}
                }
            }
            updateFF();
            if(saved.finalFour?.game1?.winner){const t=findTeam(saved.finalFour.game1.winner);const ff=userBracket.finalFour;if(t&&(ff.game1.teamA?.name===t.name||ff.game1.teamB?.name===t.name)){ff.game1.winner=t;userBracket.championship.teamA=t;}}
            if(saved.finalFour?.game2?.winner){const t=findTeam(saved.finalFour.game2.winner);const ff=userBracket.finalFour;if(t&&(ff.game2.teamA?.name===t.name||ff.game2.teamB?.name===t.name)){ff.game2.winner=t;userBracket.championship.teamB=t;}}
            if(saved.championship?.winner){const t=findTeam(saved.championship.winner);if(t)userBracket.championship.winner=t;}
        } catch(e){}
    }
    function findTeam(name,seed) {
        for(const rn of MarchMadnessData.REGION_NAMES){
            const t=name?tournamentData.regions[rn].find(x=>x.name===name):tournamentData.regions[rn].find(x=>x.seed===seed);
            if(t) return t;
        }
        return null;
    }
    function findTeamBySeed(seed,game) {
        if(game.teamA?.seed===seed) return game.teamA;
        if(game.teamB?.seed===seed) return game.teamB;
        return null;
    }

    // ---- Background ----
    let bgId=null;
    function initBackground() {
        const cv=document.getElementById('bg-canvas'),ctx=cv.getContext('2d'); let w,h;
        const ps=[];
        const resize=()=>{w=cv.width=window.innerWidth;h=cv.height=window.innerHeight;};
        resize(); window.addEventListener('resize',resize);
        for(let i=0;i<30;i++) ps.push({x:Math.random()*(w||1e3),y:Math.random()*(h||800),r:1+Math.random()*2,dx:(Math.random()-.5)*.2,dy:(Math.random()-.5)*.2,color:['#ff6b35','#4ecdc4','#ffd700'][Math.floor(Math.random()*3)]});
        function draw() {
            if(!settings.particles){bgId=requestAnimationFrame(draw);return;}
            ctx.clearRect(0,0,w,h);
            for(const p of ps){p.x+=p.dx;p.y+=p.dy;if(p.x<0)p.x=w;if(p.x>w)p.x=0;if(p.y<0)p.y=h;if(p.y>h)p.y=0;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=p.color;ctx.fill();}
            ctx.lineWidth=.3;
            for(let i=0;i<ps.length;i++) for(let j=i+1;j<ps.length;j++){const dx=ps[i].x-ps[j].x,dy=ps[i].y-ps[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<130){ctx.beginPath();ctx.moveTo(ps[i].x,ps[i].y);ctx.lineTo(ps[j].x,ps[j].y);ctx.strokeStyle=`rgba(78,205,196,${(1-d/130)*.12})`;ctx.stroke();}}
            bgId=requestAnimationFrame(draw);
        }
        draw();
        document.addEventListener('visibilitychange',()=>{if(document.hidden&&bgId){cancelAnimationFrame(bgId);bgId=null;}else if(!document.hidden&&!bgId)draw();});
    }

    document.addEventListener('DOMContentLoaded',init);
    return { switchView, showToast, markResult };
})();
