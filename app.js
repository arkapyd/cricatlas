if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('service worker failed', err));
}

// update with your actual firebase keys
const firebaseConfig = {
  apiKey: "AIzaSyDW0Byc-pyqmjrfzVy9ZRrjjuQ6Oa4SDmk",
  authDomain: "cricatlas.firebaseapp.com",
  databaseURL: "https://cricatlas-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "cricatlas",
  storageBucket: "cricatlas.firebasestorage.app",
  messagingSenderId: "858714427166",
  appId: "1:858714427166:web:deac448d834d22bafa430f",
  measurementId: "G-ZS4RDHBNMT"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// shared state
let isMultiplayer = false;
let currentLetter = '';
let usedPlayers = new Set();
let lives = 3;
let score = 0;
let turnTimer = null;
let timeLeft = 60;

// offline state
let playersCatalog = []; 
let currentMode = 'easy';
let currentCategory = 'general';

// online / auth state
let currentUser = null;
let currentGameId = null;
let gameRef = null;
let isMyTurn = false;
let totalUserCP = 0;

// pwa install prompt helper
let deferredPrompt;

// ui elements
const authView = document.getElementById('auth-view');
const welcomeView = document.getElementById('welcome-view');
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');

const mainMenu = document.getElementById('main-menu');
const offlineSetup = document.getElementById('offline-setup');

const btnOffline = document.getElementById('btn-offline');
const btnOnline = document.getElementById('btn-online');
const btnBackMain = document.getElementById('back-to-main-btn');
const btnBackLobby = document.getElementById('back-from-lobby-btn');
const btnReturnMain = document.getElementById('btn-return-main');
const installAppBtn = document.getElementById('install-app-btn');

// private room hooks
const btnCreatePrivate = document.getElementById('btn-create-private');
const btnJoinPrivate = document.getElementById('btn-join-private');
const privateCodeInput = document.getElementById('private-code-input');
const privateCodeDisplay = document.getElementById('private-code-display');

// leave game modal elements
const leaveGameBtn = document.getElementById('leave-game-btn');
const leaveConfirmModal = document.getElementById('leave-confirm-modal');
const leaveYesBtn = document.getElementById('leave-yes-btn');
const leaveNoBtn = document.getElementById('leave-no-btn');

const diffTabs = document.querySelectorAll('.diff-btn');
const catTabs = document.querySelectorAll('.cat-btn');
const modeHelpText = document.getElementById('mode-help-text');
const startOfflineBtn = document.getElementById('start-offline-btn');

const loginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const findMatchBtn = document.getElementById('find-match-btn');
const lobbyStatus = document.getElementById('lobby-status');
const playerNameDisplay = document.getElementById('player-name-display');
const lobbyPlayerName = document.getElementById('lobby-player-name');
const userCpDisplay = document.getElementById('user-cp-display');

const opponentNameEl = document.getElementById('opponent-name');
const opponentLivesEl = document.getElementById('opponent-lives');
const yourLivesEl = document.getElementById('your-lives');
const turnIndicator = document.getElementById('turn-indicator');
const statusBox = document.getElementById('game-status');
const timerDisplay = document.getElementById('timer-display');
const playInputGroup = document.getElementById('play-input-group');
const gameOverPanel = document.getElementById('game-over-panel');
const playerInput = document.getElementById('player-input');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const chainList = document.getElementById('chain-list');
const scoreEl = document.getElementById('score');

const helpTexts = {
    easy: "<span>easy:</span> standard name chain. initials are accepted.",
    medium: "<span>medium:</span> strict first names required.",
    hard: "<span>hard:</span> extreme strictness. exact initials or full birth names required.",
    general: "<span>general:</span> any verified cricketer is valid.",
    intl: "<span>intl only:</span> international experience required.",
    domestic: "<span>domestic only:</span> domestic experience only.",
    men: "<span>men only:</span> restricted to male cricketers.",
    women: "<span>women only:</span> restricted to female cricketers."
};

function updateHelpText() {
    if (!modeHelpText) return;
    modeHelpText.style.opacity = '0';
    setTimeout(() => {
        modeHelpText.innerHTML = `${helpTexts[currentMode]}<br><br>${helpTexts[currentCategory]}`;
        modeHelpText.style.opacity = '1';
    }, 150);
}

function bindFastTap(element, callback) {
    if (!element) return;
    let touchHandled = false;
    element.addEventListener('touchstart', (e) => {
        touchHandled = true;
        callback(e);
    }, { passive: true });
    element.addEventListener('click', (e) => {
        if (!touchHandled) callback(e);
        touchHandled = false;
    });
}

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        const firstName = user.displayName.split(' ')[0];
        playerNameDisplay.textContent = firstName;
        lobbyPlayerName.textContent = firstName;
        
        db.ref(`users/${user.uid}/cp`).on('value', snap => {
            totalUserCP = snap.val() || 0;
            userCpDisplay.textContent = `${parseFloat(totalUserCP).toFixed(1)} CP`;
            updateCareerDisplay(totalUserCP);
        });

        authView.style.display = 'none';
        welcomeView.style.display = 'block';
    } else {
        currentUser = null;
        welcomeView.style.display = 'none';
        lobbyView.style.display = 'none';
        gameView.style.display = 'none';
        authView.style.display = 'flex';
        if (gameRef) gameRef.off();
    }
});

loginBtn.addEventListener('click', () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
logoutBtn.addEventListener('click', () => auth.signOut());

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installAppBtn) installAppBtn.classList.remove('hide-element');
});

if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installAppBtn.classList.add('hide-element');
            }
            deferredPrompt = null;
        }
    });
}

btnOffline.addEventListener('click', () => {
    mainMenu.style.display = 'none';
    offlineSetup.style.display = 'block';
});

btnOnline.addEventListener('click', () => {
    isMultiplayer = true;
    welcomeView.style.display = 'none';
    lobbyView.style.display = 'flex';
});

function returnToMainMenu() {
    isMultiplayer = false;
    lobbyView.style.display = 'none';
    gameView.style.display = 'none';
    offlineSetup.style.display = 'none';
    welcomeView.style.display = 'block';
    mainMenu.style.display = 'block';
    stopTimer();
    if (gameRef) gameRef.off();
    if (privateCodeDisplay) privateCodeDisplay.classList.add('hide-element');
    findMatchBtn.disabled = false;
    findMatchBtn.textContent = 'FIND MATCH';
    lobbyStatus.textContent = 'ready to enter the arena';
}

btnBackMain.addEventListener('click', returnToMainMenu);
btnBackLobby.addEventListener('click', returnToMainMenu);
btnReturnMain.addEventListener('click', returnToMainMenu);

diffTabs.forEach(tab => tab.addEventListener('click', (e) => {
    diffTabs.forEach(t => t.classList.remove('active')); e.target.classList.add('active');
    currentMode = e.target.getAttribute('data-mode'); updateHelpText();
}));

catTabs.forEach(tab => tab.addEventListener('click', (e) => {
    catTabs.forEach(t => t.classList.remove('active')); e.target.classList.add('active');
    currentCategory = e.target.getAttribute('data-category'); updateHelpText();
}));

// leave game popup logic
if (leaveGameBtn) {
    leaveGameBtn.addEventListener('click', () => {
        leaveConfirmModal.classList.remove('hide-element');
    });
}

if (leaveNoBtn) {
    leaveNoBtn.addEventListener('click', () => {
        leaveConfirmModal.classList.add('hide-element');
    });
}

if (leaveYesBtn) {
    leaveYesBtn.addEventListener('click', async () => {
        leaveConfirmModal.classList.add('hide-element');
        if (isMultiplayer) {
            const snap = await gameRef.once('value');
            const game = snap.val();
            const isP1 = game.p1.uid === currentUser.uid;
            const oppUid = isP1 ? (game.p2 ? game.p2.uid : null) : game.p1.uid;
            if (oppUid) {
                await gameRef.update({ status: 'finished', winner: oppUid, [`${isP1 ? 'p1' : 'p2'}/lives`]: 0 });
            } else {
                await gameRef.update({ status: 'finished' });
            }
        } else {
            lives = 0;
            updateLivesDisplay();
            statusBox.textContent = "FORFEIT";
            statusBox.style.color = "var(--loss)";
            setSystemMessage(`you forfeited the game.`, true);
            triggerGameOver();
        }
    });
}

async function awardCP(extract, demo) {
    if (!currentUser) return 0;
    
    let baseCp = 1;
    if (!demo.isIntl) {
        baseCp = demo.isWomen ? 4 : 3;
    }

    let activeStart = 2024;
    const yearRegex = /\b(18\d{2}|19\d{2}|20\d{2})\b/g;
    const years = [];
    let match;
    while ((match = yearRegex.exec(extract)) !== null) {
        years.push(parseInt(match[1]));
    }

    if (years.length > 0) {
        const bornMatch = extract.match(/born\s+(\d{1,2}\s+[a-z]+\s+)?(18\d{2}|19\d{2}|20\d{2})/i);
        let birthYear = bornMatch ? parseInt(bornMatch[2]) : null;
        let careerYears = years.filter(y => y !== birthYear && y > (birthYear || 0));
        
        if (careerYears.length > 0) activeStart = Math.min(...careerYears);
        else if (birthYear) activeStart = birthYear + 20;
        else activeStart = Math.min(...years);
    }

    let multiplier = 1;
    if (activeStart < 1980) multiplier = 1.5;
    else if (activeStart < 2000) multiplier = 1.3;
    else if (activeStart <= 2010) multiplier = 1.1;

    const earnedCP = parseFloat((baseCp * multiplier).toFixed(1));
    
    const ref = db.ref(`users/${currentUser.uid}/cp`);
    await ref.transaction(currentVal => (currentVal || 0) + earnedCP);
    
    return earnedCP;
}

function saveOfflineState() {
    if (isMultiplayer || lives <= 0) {
        localStorage.removeItem('atlas_offline_save');
        return;
    }
    const state = {
        score,
        lives,
        currentLetter,
        usedPlayers: Array.from(usedPlayers),
        currentMode,
        currentCategory,
        chainHtml: chainList.innerHTML
    };
    localStorage.setItem('atlas_offline_save', JSON.stringify(state));
}

function loadOfflineState() {
    const saved = localStorage.getItem('atlas_offline_save');
    if (!saved) return false;
    
    try {
        const state = JSON.parse(saved);
        score = state.score;
        lives = state.lives;
        currentLetter = state.currentLetter;
        usedPlayers = new Set(state.usedPlayers);
        currentMode = state.currentMode;
        currentCategory = state.currentCategory;
        chainList.innerHTML = state.chainHtml;
        
        scoreEl.textContent = score;
        updateLivesDisplay();
        statusBox.textContent = currentLetter.toUpperCase();
        
        diffTabs.forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-mode') === currentMode);
        });
        catTabs.forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-category') === currentCategory);
        });
        updateHelpText();

        return true;
    } catch (e) {
        return false;
    }
}

function startTimer() {
    clearInterval(turnTimer);
    timeLeft = 60;
    timerDisplay.textContent = timeLeft;
    timerDisplay.classList.remove('timer-danger');

    turnTimer = setInterval(() => {
        timeLeft--;
        timerDisplay.textContent = timeLeft;
        if (timeLeft <= 10) timerDisplay.classList.add('timer-danger');
        
        if (timeLeft <= 0) {
            clearInterval(turnTimer);
            handleTimeout();
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(turnTimer);
    timerDisplay.textContent = '--';
    timerDisplay.classList.remove('timer-danger');
}

function triggerGameOver() {
    stopTimer();
    playInputGroup.classList.add('hide-element');
    gameOverPanel.classList.remove('hide-element');
    localStorage.removeItem('atlas_offline_save');
}

async function handleTimeout() {
    if (isMultiplayer) {
        const snap = await gameRef.once('value');
        const game = snap.val();
        if(game.status === 'finished') return;

        const isP1 = game.p1.uid === currentUser.uid;
        const currentLives = isP1 ? game.p1.lives : game.p2.lives;
        const oppUid = isP1 ? game.p2.uid : game.p1.uid;

        if (currentLives - 1 <= 0) {
            await gameRef.update({ status: 'finished', winner: oppUid, [`${isP1 ? 'p1' : 'p2'}/lives`]: 0 });
        } else {
            setSystemMessage(`time's up! you lost a life and your turn.`, true);
            await gameRef.update({ [`${isP1 ? 'p1' : 'p2'}/lives`]: currentLives - 1, turn: oppUid });
        }
    } else {
        lives--;
        updateLivesDisplay();
        if (lives <= 0) {
            statusBox.textContent = "OVER";
            statusBox.style.color = "var(--loss)";
            setSystemMessage(`time's up! out of lives. cpu wins.`, true);
            triggerGameOver();
        } else {
            setSystemMessage(`time's up! lost a life and your turn. cpu will play.`, true);
            playerInput.disabled = true; submitBtn.disabled = true;
            saveOfflineState();
            setTimeout(computerTurn, 1500);
        }
    }
}

// tab switching logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        // remove active states
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => {
            p.classList.remove('active-pane');
            p.classList.add('hide-element');
        });
        
        // add active state to clicked
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-target');
        const targetPane = document.getElementById(targetId);
        targetPane.classList.remove('hide-element');
        targetPane.classList.add('active-pane');
    });
});

// career progression logic
const careerTiers = [
    { name: "gully cricketer", threshold: 0 },
    { name: "school cricketer", threshold: 50 },
    { name: "school captain", threshold: 100 },
    { name: "local club cricketer", threshold: 150 },
    { name: "local club captain", threshold: 200 },
    { name: "city cricketer", threshold: 250 },
    { name: "city captain", threshold: 300 },
    { name: "district cricketer", threshold: 400 },
    { name: "district captain", threshold: 500 },
    { name: "state franchise cricketer", threshold: 600 },
    { name: "state franchise captain", threshold: 700 },
    { name: "state team cricketer", threshold: 850 },
    { name: "state team captain", threshold: 1000 },
    { name: "zonal team cricketer", threshold: 1150 },
    { name: "zonal team captain", threshold: 1300 },
    { name: "national franchise cricketer", threshold: 1500 },
    { name: "national franchise captain", threshold: 1700 },
    { name: "international franchise cricketer", threshold: 1900 },
    { name: "international franchise captain", threshold: 2100 },
    { name: "national team player", threshold: 2500 },
    { name: "national team captain", threshold: 2900 }
];

function updateCareerDisplay(totalCp) {
    let currentTierIndex = 0;
    
    for (let i = 0; i < careerTiers.length; i++) {
        if (totalCp >= careerTiers[i].threshold) {
            currentTierIndex = i;
        } else {
            break;
        }
    }
    
    const currentTier = careerTiers[currentTierIndex];
    const nextTier = careerTiers[currentTierIndex + 1];
    
    document.getElementById('career-rank-title').textContent = currentTier.name;
    document.getElementById('career-cp-value').textContent = parseFloat(totalCp).toFixed(1);
    
    const fillEl = document.getElementById('career-progress-fill');
    
    if (nextTier) {
        const cpNeeded = nextTier.threshold - totalCp;
        const tierRange = nextTier.threshold - currentTier.threshold;
        const cpEarnedInTier = totalCp - currentTier.threshold;
        const progressPercent = (cpEarnedInTier / tierRange) * 100;
        
        fillEl.style.width = `${progressPercent}%`;
        document.getElementById('next-rank-title').textContent = nextTier.name;
        document.getElementById('cp-remaining-text').textContent = `(${parseFloat(cpNeeded).toFixed(1)} cp needed)`;
    } else {
        fillEl.style.width = '100%';
        document.getElementById('next-rank-title').textContent = "max rank reached";
        document.getElementById('cp-remaining-text').textContent = "";
    }
}

function updateLivesDisplay() {
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
}

startOfflineBtn.addEventListener('click', () => {
    isMultiplayer = false;
    welcomeView.style.display = 'none';
    gameView.style.display = 'flex';
    playInputGroup.classList.remove('hide-element');
    gameOverPanel.classList.add('hide-element');
    opponentNameEl.textContent = 'CPU';
    opponentLivesEl.classList.add('hide-element');
    
    const loaded = loadOfflineState();
    
    if (!loaded) {
        lives = 3; score = 0; currentLetter = ''; usedPlayers.clear(); chainList.innerHTML = '';
        scoreEl.textContent = score; updateLivesDisplay();
    }
    
    playerInput.value = '';
    
    db.ref('players').once('value').then(snapshot => {
        const data = snapshot.val();
        if (!data) { setSystemMessage("db error.", true); return; }
        
        let sourceData = data.players ? data.players : data;
        let rawArray = Array.isArray(sourceData) ? sourceData : Object.values(sourceData);

        playersCatalog = rawArray.map(p => ({
            name: (p.name || '').toLowerCase().trim(),
            unique_name: (p.unique_name || p.name || '').toLowerCase().trim(),
            full_name: (p.full_name || '').toLowerCase().trim()
        })).filter(p => p.name);

        if (!loaded) {
            playerInput.disabled = true; submitBtn.disabled = true;
            turnIndicator.textContent = `MODE: ${currentMode}`;
            turnIndicator.style.color = "var(--text)";
            setSystemMessage("engine initialized. cpu will start.", false);
            setTimeout(computerTurn, 800);
        } else {
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            turnIndicator.textContent = "YOUR TURN";
            turnIndicator.style.color = "var(--win)";
            setSystemMessage("match restored. your turn.", false);
            startTimer();
        }
    });
});

async function computerTurn() {
    stopTimer();
    setSystemMessage("cpu is calculating...", false);
    playerInput.disabled = true; submitBtn.disabled = true;

    let validCandidates = playersCatalog.filter(p => 
        !usedPlayers.has(p.full_name) && !usedPlayers.has(p.unique_name) &&
        (currentLetter === '' || p.name.charAt(0) === currentLetter || p.unique_name.charAt(0) === currentLetter)
    );

    let selected, trueFullName, extract, finalPlayName;
    let foundValid = false;

    for (let i = 0; i < 25; i++) {
        if (validCandidates.length === 0) break;
        selected = validCandidates.splice(Math.floor(Math.random() * validCandidates.length), 1)[0];
        
        const wikiData = await resolveFullName(selected.unique_name || selected.name);
        trueFullName = wikiData.resolved;
        extract = wikiData.extract;
        const formats = getNameFormats(trueFullName, wikiData.isUnresolved);

        if (currentMode === 'medium' && wikiData.isUnresolved && (formats.givenNames[0]||"").length <= 2) continue; 
        if (currentMode === 'hard' && wikiData.isUnresolved && !formats.isMulti && (formats.givenNames[0]||"").length <= 2) continue; 

        const demo = scanDemographics(extract);
        if (currentCategory === 'intl' && !demo.isIntl) continue;
        if (currentCategory === 'domestic' && demo.isIntl) continue;
        if (currentCategory === 'women' && !demo.isWomen) continue;
        if (currentCategory === 'men' && demo.isWomen) continue;

        let tempPlayName = currentMode === 'medium' ? formats.full : (currentMode === 'hard' ? (Math.random() > 0.5 ? formats.initials : formats.full) : selected.name);
        if (currentLetter !== '' && tempPlayName.charAt(0) !== currentLetter) continue;

        finalPlayName = tempPlayName;
        foundValid = true;
        break;
    }

    if (!foundValid) {
        statusBox.textContent = "WIN";
        statusBox.style.color = "var(--win)";
        setSystemMessage("cpu exhausted options. you win!", false);
        triggerGameOver();
        return;
    }

    usedPlayers.add(trueFullName);
    currentLetter = getLastLetterOfSurname(finalPlayName);
    statusBox.textContent = currentLetter.toUpperCase();
    
    renderFeedItem(finalPlayName, extract, false, 0);
    saveOfflineState();
    
    playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
    turnIndicator.textContent = "YOUR TURN";
    turnIndicator.style.color = "var(--win)";
    setSystemMessage("your turn.", false);
    startTimer();
}

// atomic latency-proof ranked matchmaking
findMatchBtn.addEventListener('click', () => {
    findMatchBtn.disabled = true; 
    findMatchBtn.textContent = 'SEARCHING...';
    lobbyStatus.textContent = 'connecting to global ranked arena...';

    const lobbyRef = db.ref('ranked_lobby');
    lobbyRef.transaction(current => {
        if (!current || current.status === 'full') {
            const newGameKey = db.ref('games').push().key;
            return {
                gameId: newGameKey,
                status: 'waiting',
                p1: { uid: currentUser.uid, name: currentUser.displayName }
            };
        } else if (current.status === 'waiting') {
            if (current.p1.uid === currentUser.uid) return; 
            current.status = 'full';
            current.p2 = { uid: currentUser.uid, name: currentUser.displayName };
            return current;
        }
    }, (err, committed, snapshot) => {
        if (!committed || err) {
            findMatchBtn.disabled = false;
            findMatchBtn.textContent = 'FIND MATCH';
            lobbyStatus.textContent = 'matchmaking timeout. please try again.';
            return;
        }

        const res = snapshot.val();
        currentGameId = res.gameId;
        gameRef = db.ref(`games/${currentGameId}`);

        if (res.p1.uid === currentUser.uid) {
            gameRef.set({
                status: 'waiting',
                isRanked: true,
                p1: { uid: currentUser.uid, name: currentUser.displayName, lives: 3 },
                createdAt: firebase.database.ServerValue.TIMESTAMP
            });

            lobbyStatus.textContent = 'room created. waiting for opponent to bridge...';

            gameRef.on('value', function listener(s) {
                const g = s.val();
                if (g && g.status === 'playing') {
                    gameRef.off('value', listener);
                    db.ref('ranked_lobby').transaction(curr => { if (curr && curr.gameId === currentGameId) return null; });
                    initOnlineEngine(currentGameId, g);
                }
            });
        } else {
            gameRef.update({
                status: 'playing',
                p2: { uid: currentUser.uid, name: currentUser.displayName, lives: 3 },
                turn: res.p1.uid,
                currentLetter: '',
                moveCount: 0
            }).then(() => {
                db.ref('ranked_lobby').transaction(curr => { if (curr && curr.gameId === currentGameId) return null; });
                gameRef.once('value', s => { initOnlineEngine(currentGameId, s.val()); });
            });
        }
    });
});

// custom private room management
if (btnCreatePrivate) {
    btnCreatePrivate.addEventListener('click', () => {
        btnCreatePrivate.disabled = true;
        lobbyStatus.textContent = 'generating secure match code...';
        
        const generateCode = () => Math.floor(1000 + Math.random() * 9000).toString();
        
        const attemptCreate = () => {
            const code = generateCode();
            const roomRef = db.ref(`private_rooms/${code}`);
            
            roomRef.transaction(current => {
                if (current === null) {
                    return {
                        status: 'waiting',
                        isRanked: false,
                        p1: { uid: currentUser.uid, name: currentUser.displayName, lives: 3 },
                        createdAt: firebase.database.ServerValue.TIMESTAMP
                    };
                }
            }, (err, committed, snap) => {
                if (err || !committed) {
                    attemptCreate(); 
                    return;
                }
                
                currentGameId = code;
                gameRef = roomRef;
                
                if (privateCodeDisplay) {
                    privateCodeDisplay.classList.remove('hide-element');
                    privateCodeDisplay.innerHTML = `room code: <span>${code}</span>`;
                }
                lobbyStatus.textContent = 'send the room code to your friend...';
                
                gameRef.on('value', function privateListener(s) {
                    const g = s.val();
                    if (g && g.status === 'playing') {
                        gameRef.off('value', privateListener);
                        if (privateCodeDisplay) privateCodeDisplay.classList.add('hide-element');
                        btnCreatePrivate.disabled = false;
                        initOnlineEngine(code, g);
                    }
                });
            });
        };
        attemptCreate();
    });
}

if (btnJoinPrivate) {
    btnJoinPrivate.addEventListener('click', () => {
        const code = privateCodeInput.value.trim();
        if (!code || code.length !== 4) { lobbyStatus.textContent = 'enter a valid 4-digit code.'; return; }
        
        btnJoinPrivate.disabled = true;
        lobbyStatus.textContent = `searching for room ${code}...`;
        
        const roomRef = db.ref(`private_rooms/${code}`);
        roomRef.transaction(current => {
            if (current && current.status === 'waiting') {
                if (current.p1.uid === currentUser.uid) return; 
                current.status = 'playing';
                current.p2 = { uid: currentUser.uid, name: currentUser.displayName, lives: 3 };
                current.turn = current.p1.uid;
                current.currentLetter = '';
                current.moveCount = 0;
                return current;
            }
        }, (err, committed, snap) => {
            btnJoinPrivate.disabled = false;
            if (committed && snap.exists()) {
                currentGameId = code;
                gameRef = roomRef;
                if (privateCodeDisplay) privateCodeDisplay.classList.add('hide-element');
                initOnlineEngine(code, snap.val());
            } else {
                lobbyStatus.textContent = 'room unavailable, expired, or full.';
            }
        });
    });
}

// updated online engine layer to handle waiting states gracefully
function initOnlineEngine(gameId, initialData) {
    lobbyView.style.display = 'none'; 
    gameView.style.display = 'flex'; 
    chainList.innerHTML = '';
    playInputGroup.classList.remove('hide-element');
    gameOverPanel.classList.add('hide-element');
    playerInput.value = '';
    
    const isP1 = initialData.p1.uid === currentUser.uid;
    const opponent = isP1 ? initialData.p2 : initialData.p1;
    opponentNameEl.textContent = opponent ? opponent.name.split(' ')[0] : 'WAITING';
    opponentLivesEl.classList.remove('hide-element');

    gameRef.child('moves').off();
    gameRef.on('value', snap => {
        const game = snap.val(); if (!game) return;
        renderOnlineState(game, isP1);
    });

    gameRef.child('moves').on('child_added', snap => {
        const move = snap.val();
        renderFeedItem(move.displayName, move.extract, move.uid === currentUser.uid, move.cpEarned || 0);
    });
}

function renderOnlineState(game, amIP1) {
    const myLives = amIP1 ? game.p1.lives : (game.p2 ? game.p2.lives : 3);
    const oppLives = amIP1 ? (game.p2 ? game.p2.lives : 3) : game.p1.lives;
    
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, myLives)) + '♡'.repeat(Math.max(0, 3 - myLives));
    opponentLivesEl.textContent = '♥'.repeat(Math.max(0, oppLives)) + '♡'.repeat(Math.max(0, 3 - oppLives));
    scoreEl.textContent = game.moveCount || 0;

    if (game.p2) {
        const opponent = amIP1 ? game.p2 : game.p1;
        opponentNameEl.textContent = opponent.name.split(' ')[0];
    }

    if (game.status === 'waiting') {
        turnIndicator.textContent = "WAITING FOR FRIEND";
        turnIndicator.style.color = "var(--text-dim)";
        statusBox.textContent = "----";
        playerInput.disabled = true; submitBtn.disabled = true;
        stopTimer();
        return;
    }

    if (game.status === 'finished') {
        stopTimer();
        isMyTurn = false;
        triggerGameOver();
        if (game.winner === currentUser.uid) {
            turnIndicator.textContent = "VICTORY"; turnIndicator.style.color = "var(--win)";
            statusBox.textContent = "WIN"; setSystemMessage("opponent eliminated. you win!", false);
        } else {
            turnIndicator.textContent = "DEFEAT"; turnIndicator.style.color = "var(--loss)";
            statusBox.textContent = "LOSE"; setSystemMessage("you were eliminated.", true);
        }
        return;
    }

    const newlyMyTurn = (game.turn === currentUser.uid);
    if(newlyMyTurn !== isMyTurn) {
        isMyTurn = newlyMyTurn;
        if (isMyTurn) {
            turnIndicator.textContent = "YOUR TURN"; turnIndicator.style.color = "var(--win)";
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            setSystemMessage("awaiting input...", false);
            startTimer();
        } else {
            turnIndicator.textContent = "OPPONENT'S TURN"; turnIndicator.style.color = "var(--loss)";
            playerInput.disabled = true; submitBtn.disabled = true;
            setSystemMessage("waiting for opponent...", false);
            stopTimer();
        }
    }
    
    statusBox.textContent = game.currentLetter ? game.currentLetter.toUpperCase() : "ANY";
    currentLetter = game.currentLetter || '';
}

bindFastTap(submitBtn, handleMoveWrapper);
playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleMoveWrapper(); });

// update input execution loop to respect ranked metrics
async function handleMoveWrapper() {
    if (isMultiplayer && !isMyTurn) return;
    
    const inputName = playerInput.value.toLowerCase().trim();
    playerInput.value = '';
    if (!inputName) return;

    if (currentLetter !== '' && inputName.charAt(0) !== currentLetter) {
        punishLogic(`must start with '${currentLetter.toUpperCase()}'.`); return;
    }

    clearInterval(turnTimer);
    playerInput.disabled = true; submitBtn.disabled = true;
    setSystemMessage(`verifying '${inputName}'...`, false);

    let gameData = null;
    let isRanked = true;
    if (isMultiplayer) {
        const snap = await gameRef.once('value'); gameData = snap.val();
        isRanked = gameData.isRanked !== false;
        if (gameData.usedPlayers && gameData.usedPlayers[inputName]) { punishLogic(`${inputName.toUpperCase()} was used.`); return; }
    }

    const wikiData = await resolveFullName(inputName);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    if (!isMultiplayer && usedPlayers.has(trueFullName)) { punishLogic(`${trueFullName.toUpperCase()} already used.`); return; }
    if (isMultiplayer && gameData && gameData.usedPlayers && gameData.usedPlayers[trueFullName]) { punishLogic(`${trueFullName.toUpperCase()} already used.`); return; }
    if (!extract || !extract.toLowerCase().includes("cricket")) { punishLogic(`could not verify '${inputName}' as a cricketer.`); return; }

    const demo = scanDemographics(extract);

    // skip cp if it's an unranked custom room
    const earnedCP = isRanked ? await awardCP(extract, demo) : 0;

    if (isMultiplayer) {
        const oppUid = (gameData.p1.uid === currentUser.uid) ? gameData.p2.uid : gameData.p1.uid;
        await gameRef.update({ currentLetter: getLastLetterOfSurname(inputName), turn: oppUid, [`usedPlayers/${trueFullName}`]: true, moveCount: (gameData.moveCount || 0) + 1 });
        gameRef.child('moves').push().set({ displayName: inputName, extract, uid: currentUser.uid, cpEarned: earnedCP });
    } else {
        usedPlayers.add(trueFullName);
        currentLetter = getLastLetterOfSurname(inputName);
        statusBox.textContent = currentLetter.toUpperCase();
        score++; scoreEl.textContent = score;
        renderFeedItem(inputName, extract, true, earnedCP);
        saveOfflineState();
        setTimeout(computerTurn, 1000);
    }
}

async function punishLogic(reason) {
    if (isMultiplayer) {
        const snap = await gameRef.once('value');
        const game = snap.val();
        const isP1 = game.p1.uid === currentUser.uid;
        const currentLives = isP1 ? game.p1.lives : game.p2.lives;
        const oppUid = isP1 ? game.p2.uid : game.p1.uid;
        
        if (currentLives - 1 <= 0) {
            await gameRef.update({ status: 'finished', winner: oppUid, [`${isP1 ? 'p1' : 'p2'}/lives`]: 0 });
        } else {
            setSystemMessage(`strike! ${reason}`, true);
            await gameRef.update({ [`${isP1 ? 'p1' : 'p2'}/lives`]: currentLives - 1 });
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            startTimer(); 
        }
    } else {
        lives--;
        updateLivesDisplay();
        if (lives <= 0) {
            statusBox.textContent = "OVER"; statusBox.style.color = "var(--loss)";
            setSystemMessage(`// ${reason} out of lives.`, true);
            triggerGameOver();
        } else {
            setSystemMessage(`strike! ${reason}`, true);
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            saveOfflineState();
            startTimer(); 
        }
    }
}

function renderFeedItem(displayName, extract, isMe, cpEarned) {
    const div = document.createElement('div');
    div.className = `feed-item ${isMe ? 'player' : (isMultiplayer ? 'opponent' : 'cpu')}`;
    
    const demo = scanDemographics(extract);
    let summaryHtml = `<div class="player-summary">no summary available.</div>`;
    
    if (extract) {
        const summaryText = extract.split('\n')[0];
        summaryHtml = `<div class="player-badges">${demo.isIntl ? '<span class="badge intl">intl</span>' : '<span class="badge">domestic</span>'}</div><div class="player-summary">${summaryText}</div>`;
    }
    
    let cpText = isMe && cpEarned > 0 ? `<div class="feed-earned-cp">+${cpEarned} CP</div>` : `<div></div>`;

    div.innerHTML = `<div class="feed-header"><div class="feed-meta"><span>${isMe ? 'you' : (isMultiplayer ? 'opponent' : 'cpu')}</span>${cpText}</div><div class="feed-name">${displayName.toUpperCase()}</div></div><div class="feed-details">${summaryHtml}</div>`;
    chainList.prepend(div);
    while (chainList.children.length > 2) chainList.removeChild(chainList.lastChild);
}

function setSystemMessage(msg, isError = true) {
    messageEl.style.color = isError ? "var(--loss)" : "var(--accent)";
    messageEl.textContent = `// ${msg}`;
    setTimeout(() => {
        if (!isMultiplayer && lives <= 0) return;
        messageEl.style.color = "var(--text-dim)";
        messageEl.textContent = (isMyTurn || !isMultiplayer) && document.getElementById('player-input').disabled === false ? "awaiting input..." : "system ready...";
    }, 4000);
}

function getLastLetterOfSurname(name) {
    const parts = name.trim().split(' ');
    return parts[parts.length - 1].slice(-1);
}

function scanDemographics(extract) {
    if (!extract) return { isIntl: false, isWomen: false, isMen: false };
    const l = extract.toLowerCase();
    
    const isIntl = l.includes('international') || 
                   l.includes('test match') || 
                   l.includes('test cricketer') ||
                   l.includes('odi') || 
                   l.includes('t20i') || 
                   l.includes('national team') ||
                   l.includes('cricket team'); 
                   
    const isWomen = /\b(she|her)\b/i.test(l) || l.includes("women's");
    const isMen = /\b(he|his)\b/i.test(l) || l.includes("men's");
    
    return { isIntl, isWomen, isMen };
}

function getNameFormats(trueFullName, isUnresolvedAbbrev = false) {
    const parts = trueFullName.trim().split(/\s+/);
    if (parts.length < 2) return { full: trueFullName.toLowerCase(), initials: trueFullName.toLowerCase(), givenNames: [trueFullName.toLowerCase()], isMulti: false };

    let sIdx = parts.length - 1;
    if (parts.length >= 3 && ['de', 'van', 'le', 'du', 'von', 'mac', 'mc', 'da', 'di'].includes(parts[parts.length - 2].toLowerCase())) sIdx = parts.length - 2;
    if (parts.length >= 4 && parts[parts.length - 3].toLowerCase() === 'van' && ['der', 'den'].includes(parts[parts.length - 2].toLowerCase())) sIdx = parts.length - 3;
    
    const surname = parts.slice(sIdx).join(' ').toLowerCase();
    const rawGiven = parts.slice(0, sIdx).map(n => n.toLowerCase());
    const givenNames = [];
    
    rawGiven.forEach(n => { 
        if (isUnresolvedAbbrev && n.length <= 3 && !/[aeiouy]/.test(n)) {
            givenNames.push(...n.split('')); 
        } else {
            givenNames.push(n);
        }
    });
    
    const full = `${givenNames.join(' ')} ${surname}`;
    const initials = `${givenNames.map(n => n[0]).join('')} ${surname}`;
    
    return { full, initials, givenNames, isMulti: givenNames.length > 1 };
}

async function resolveFullName(queryName) {
    const fetchWiki = async (q) => (await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${q}&gsrlimit=5&prop=extracts&exintro=1&explaintext=1`)).json();
    try {
        let data = await fetchWiki(encodeURIComponent(`intitle:"${queryName}" cricketer`));
        let pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
        if (pages.length === 0) { 
            data = await fetchWiki(encodeURIComponent(`${queryName} cricketer`)); 
            pages = data.query && data.query.pages ? Object.values(data.query.pages) : []; 
        }
        
        const queryNameLower = queryName.trim().toLowerCase();
        const firstInitial = queryNameLower.replace(/[^a-z]/g, '').charAt(0);
        const surname = queryNameLower.split(/\s+/).pop();

        for (let pageData of pages) {
            if (pageData.title.toLowerCase().includes("(disambiguation)")) continue;
            
            const extract = pageData.extract || "";
            const extractLower = extract.toLowerCase();
            
            if (extractLower.includes("may refer to:") || extractLower.includes("is a disambiguation page")) continue;

            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const normTitle = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const normSurname = surname.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const titleFirstInitial = normTitle.replace(/[^a-z]/g, '').charAt(0);

            if (extractLower.includes("cricket") && normTitle.includes(normSurname) && titleFirstInitial === firstInitial) {
                const match = extract.split(/[.!?]/)[0].match(/^([^\(\,]+)(?:\(|\,)/);
                return { resolved: match ? match[1].trim().toLowerCase() : title, extract: extract, isUnresolved: false };
            }
        }
    } catch (e) { console.error("wiki error:", e); }
    return { resolved: queryName.toLowerCase(), extract: null, isUnresolved: true };
}
