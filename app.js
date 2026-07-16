if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('service worker failed', err));
}

// update with your actual firebase keys
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com", 
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// shared game state
let isMultiplayer = false;
let currentLetter = '';
let usedPlayers = new Set();
let lives = 3;
let moveCounter = 0;

// offline state
let playersCatalog = []; 
let currentMode = 'easy';
let currentCategory = 'general';

// online state
let currentUser = null;
let currentGameId = null;
let gameRef = null;
let isMyTurn = false;

// ui elements
const welcomeView = document.getElementById('welcome-view');
const mainMenu = document.getElementById('main-menu');
const offlineSetup = document.getElementById('offline-setup');
const authView = document.getElementById('auth-view');
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');

const btnOffline = document.getElementById('btn-offline');
const btnOnline = document.getElementById('btn-online');
const btnBackMain = document.getElementById('back-to-main-btn');
const btnBackAuth = document.getElementById('back-from-auth-btn');
const btnBackLobby = document.getElementById('back-from-lobby-btn');

const diffTabs = document.querySelectorAll('.diff-btn');
const catTabs = document.querySelectorAll('.cat-btn');
const modeHelpText = document.getElementById('mode-help-text');
const startOfflineBtn = document.getElementById('start-offline-btn');

const loginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const findMatchBtn = document.getElementById('find-match-btn');
const lobbyStatus = document.getElementById('lobby-status');
const playerNameDisplay = document.getElementById('player-name-display');

const opponentNameEl = document.getElementById('opponent-name');
const opponentLivesEl = document.getElementById('opponent-lives');
const yourLivesEl = document.getElementById('your-lives');
const turnIndicator = document.getElementById('turn-indicator');
const statusBox = document.getElementById('game-status');
const playerInput = document.getElementById('player-input');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const chainList = document.getElementById('chain-list');

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
    modeHelpText.style.opacity = '0';
    setTimeout(() => {
        modeHelpText.innerHTML = `${helpTexts[currentMode]}<br><br>${helpTexts[currentCategory]}`;
        modeHelpText.style.opacity = '1';
    }, 150);
}

// 1. MENU NAVIGATION
btnOffline.addEventListener('click', () => {
    mainMenu.style.display = 'none';
    offlineSetup.style.display = 'block';
});

btnOnline.addEventListener('click', () => {
    isMultiplayer = true;
    welcomeView.style.display = 'none';
    if (currentUser) {
        lobbyView.style.display = 'flex';
    } else {
        authView.style.display = 'flex';
    }
});

[btnBackMain, btnBackAuth, btnBackLobby].forEach(btn => {
    btn.addEventListener('click', () => {
        isMultiplayer = false;
        authView.style.display = 'none';
        lobbyView.style.display = 'none';
        offlineSetup.style.display = 'none';
        welcomeView.style.display = 'flex';
        mainMenu.style.display = 'block';
        if (gameRef) gameRef.off();
    });
});

diffTabs.forEach(tab => tab.addEventListener('click', (e) => {
    diffTabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentMode = e.target.getAttribute('data-mode');
    updateHelpText();
}));

catTabs.forEach(tab => tab.addEventListener('click', (e) => {
    catTabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentCategory = e.target.getAttribute('data-category');
    updateHelpText();
}));

// 2. OFFLINE LOGIC
startOfflineBtn.addEventListener('click', () => {
    isMultiplayer = false;
    welcomeView.style.display = 'none';
    gameView.style.display = 'flex';
    opponentNameEl.textContent = 'CPU';
    opponentLivesEl.classList.add('hide-element'); // hide cpu lives
    resetLocalGameState();
    
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

        startLocalEngine();
    });
});

function resetLocalGameState() {
    lives = 3;
    currentLetter = '';
    usedPlayers.clear();
    chainList.innerHTML = '';
    updateLivesDisplay();
}

function updateLivesDisplay() {
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
}

function startLocalEngine() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    turnIndicator.textContent = `MODE: ${currentMode} / ${currentCategory}`;
    turnIndicator.style.color = "var(--accent)";
    setSystemMessage("engine initialized. cpu will start.", false);
    setTimeout(computerTurn, 800);
}

async function computerTurn() {
    setSystemMessage("cpu is calculating...", false);
    playerInput.disabled = true;
    submitBtn.disabled = true;

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

        let tempPlayName = currentMode === 'medium' ? formats.full : 
                           (currentMode === 'hard' ? (Math.random() > 0.5 ? formats.initials : formats.full) : selected.name);
        
        if (currentLetter !== '' && tempPlayName.charAt(0) !== currentLetter) continue;

        finalPlayName = tempPlayName;
        foundValid = true;
        break;
    }

    if (!foundValid) {
        statusBox.textContent = "YOU WIN";
        setSystemMessage("cpu exhausted options. you win!", false);
        return;
    }

    executeLocalMove(finalPlayName, trueFullName, extract, false);
}

function executeLocalMove(displayName, trueFullName, extract, isPlayer) {
    usedPlayers.add(trueFullName);
    currentLetter = getLastLetterOfSurname(displayName);
    statusBox.textContent = currentLetter.toUpperCase();
    
    renderFeedItem(displayName, extract, isPlayer);

    if (isPlayer) {
        setTimeout(computerTurn, 1000);
    } else {
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
        setSystemMessage("your turn.", false);
    }
}

// 3. ONLINE / FIREBASE LOGIC
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        playerNameDisplay.textContent = user.displayName.split(' ')[0];
        if (isMultiplayer && authView.style.display !== 'none') {
            authView.style.display = 'none';
            lobbyView.style.display = 'flex';
        }
    } else {
        currentUser = null;
        if (isMultiplayer) {
            lobbyView.style.display = 'none';
            gameView.style.display = 'none';
            authView.style.display = 'flex';
        }
    }
});

loginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => alert("login failed: " + err.message));
});
logoutBtn.addEventListener('click', () => auth.signOut());

findMatchBtn.addEventListener('click', () => {
    findMatchBtn.disabled = true;
    findMatchBtn.textContent = 'SEARCHING...';
    findMatchBtn.style.animation = 'pulseAnim 2s infinite';
    lobbyStatus.textContent = 'looking for an open arena...';

    const queueRef = db.ref('queue');
    queueRef.orderByChild('status').equalTo('waiting').limitToFirst(1).once('value', snapshot => {
        if (snapshot.exists()) {
            joinGame(Object.keys(snapshot.val())[0]);
        } else {
            createGame();
        }
    });
});

function createGame() {
    lobbyStatus.textContent = 'arena created. waiting for opponent...';
    const newGameRef = db.ref('queue').push();
    currentGameId = newGameRef.key;
    newGameRef.set({
        status: 'waiting',
        p1: { uid: currentUser.uid, name: currentUser.displayName, lives: 3 },
        createdAt: firebase.database.ServerValue.TIMESTAMP
    });

    newGameRef.on('value', snap => {
        const game = snap.val();
        if (game && game.status === 'playing') {
            newGameRef.off();
            initOnlineEngine(currentGameId, game);
        }
    });
}

function joinGame(matchId) {
    lobbyStatus.textContent = 'arena found! connecting...';
    currentGameId = matchId;
    const gRef = db.ref(`queue/${matchId}`);
    
    gRef.transaction(game => {
        if (game && game.status === 'waiting') {
            game.status = 'playing';
            game.p2 = { uid: currentUser.uid, name: currentUser.displayName, lives: 3 };
            game.turn = game.p1.uid;
            game.currentLetter = '';
            game.usedPlayers = { placeholder: true };
            return game;
        }
        return; 
    }, (error, committed, snapshot) => {
        if (committed) initOnlineEngine(currentGameId, snapshot.val());
        else {
            findMatchBtn.disabled = false;
            findMatchBtn.click();
        }
    });
}

function initOnlineEngine(gameId, initialData) {
    lobbyView.style.display = 'none';
    gameView.style.display = 'flex';
    chainList.innerHTML = '';
    
    const isP1 = initialData.p1.uid === currentUser.uid;
    const opponent = isP1 ? initialData.p2 : initialData.p1;
    opponentNameEl.textContent = opponent.name.split(' ')[0];
    opponentLivesEl.classList.remove('hide-element');

    gameRef = db.ref(`queue/${gameId}`);
    gameRef.on('value', snap => {
        const game = snap.val();
        if (!game) return;
        renderOnlineState(game, isP1);
    });

    gameRef.child('moves').on('child_added', snap => {
        const move = snap.val();
        renderFeedItem(move.displayName, move.extract, move.uid === currentUser.uid);
    });
}

function renderOnlineState(game, amIP1) {
    const myLives = amIP1 ? game.p1.lives : game.p2.lives;
    const oppLives = amIP1 ? game.p2.lives : game.p1.lives;
    
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, myLives)) + '♡'.repeat(Math.max(0, 3 - myLives));
    opponentLivesEl.textContent = '♥'.repeat(Math.max(0, oppLives)) + '♡'.repeat(Math.max(0, 3 - oppLives));

    if (game.status === 'finished') {
        playerInput.disabled = true;
        submitBtn.disabled = true;
        isMyTurn = false;
        if (game.winner === currentUser.uid) {
            turnIndicator.textContent = "VICTORY";
            statusBox.textContent = "WIN";
            setSystemMessage("opponent eliminated. you win!", false);
        } else {
            turnIndicator.textContent = "DEFEAT";
            statusBox.textContent = "LOSE";
            setSystemMessage("you were eliminated.", true);
        }
        return;
    }

    isMyTurn = (game.turn === currentUser.uid);
    statusBox.textContent = game.currentLetter ? game.currentLetter.toUpperCase() : "ANY";
    currentLetter = game.currentLetter || '';

    if (isMyTurn) {
        turnIndicator.textContent = "YOUR TURN";
        turnIndicator.style.color = "var(--win)";
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
        setSystemMessage("awaiting input...", false);
    } else {
        turnIndicator.textContent = "OPPONENT'S TURN";
        turnIndicator.style.color = "var(--loss)";
        playerInput.disabled = true;
        submitBtn.disabled = true;
        setSystemMessage("waiting for opponent to move...", false);
    }
}

// 4. SHARED INPUT HANDLER
submitBtn.addEventListener('click', handleMoveWrapper);
playerInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleMoveWrapper(); });

async function handleMoveWrapper() {
    if (isMultiplayer && !isMyTurn) return;
    
    const inputName = playerInput.value.toLowerCase().trim();
    playerInput.value = '';
    if (!inputName) return;

    if (currentLetter !== '' && inputName.charAt(0) !== currentLetter) {
        punishLogic(`must start with '${currentLetter.toUpperCase()}'.`);
        return;
    }

    playerInput.disabled = true;
    submitBtn.disabled = true;
    setSystemMessage(`verifying '${inputName}'...`, false);

    let gameData = null;
    if (isMultiplayer) {
        const snap = await gameRef.once('value');
        gameData = snap.val();
        if (gameData.usedPlayers && gameData.usedPlayers[inputName]) { // fast check before wiki
            punishLogic(`${inputName.toUpperCase()} was used.`); return;
        }
    }

    const wikiData = await resolveFullName(inputName);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    if (!isMultiplayer && usedPlayers.has(trueFullName)) {
        punishLogic(`${trueFullName.toUpperCase()} already used.`); return;
    }
    if (isMultiplayer && gameData && gameData.usedPlayers && gameData.usedPlayers[trueFullName]) {
        punishLogic(`${trueFullName.toUpperCase()} already used.`); return;
    }

    if (!extract || !extract.toLowerCase().includes("cricket")) {
        punishLogic(`could not verify '${inputName}' as a cricketer.`); return;
    }

    // offline strict limits check
    if (!isMultiplayer) {
        const demo = scanDemographics(extract);
        if (currentCategory === 'intl' && !demo.isIntl) { punishLogic(`requires intl experience.`); return; }
        if (currentCategory === 'domestic' && demo.isIntl) { punishLogic(`domestic only.`); return; }
        if (currentCategory === 'women' && !demo.isWomen) { punishLogic(`demographic mismatch.`); return; }
        if (currentCategory === 'men' && demo.isWomen) { punishLogic(`demographic mismatch.`); return; }

        const formats = getNameFormats(trueFullName, wikiData.isUnresolved);
        const inputParts = inputName.split(/\s+/);

        if (currentMode === 'medium') {
            if (wikiData.isUnresolved && inputParts[0].length <= 2) { punishLogic(`full first name required.`); return; }
            if (inputParts[0] !== formats.givenNames[0]) { punishLogic(`fully correct first name required.`); return; }
        } else if (currentMode === 'hard') {
            const iC = inputName.replace(/\s+/g, ''), inC = formats.initials.replace(/\s+/g, ''), fC = formats.full.replace(/\s+/g, '');
            if (iC !== fC && iC !== inC) { punishLogic(`exact initials or full birth name required.`); return; }
        }
    }

    // execute move
    if (isMultiplayer) {
        const oppUid = (gameData.p1.uid === currentUser.uid) ? gameData.p2.uid : gameData.p1.uid;
        await gameRef.update({
            currentLetter: getLastLetterOfSurname(inputName),
            turn: oppUid,
            [`usedPlayers/${trueFullName}`]: true
        });
        gameRef.child('moves').push().set({ displayName: inputName, extract, uid: currentUser.uid });
    } else {
        executeLocalMove(inputName, trueFullName, extract, true);
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
        }
    } else {
        lives--;
        updateLivesDisplay();
        if (lives <= 0) {
            statusBox.textContent = "GAME OVER";
            setSystemMessage(`// ${reason} out of lives.`, true);
            playerInput.disabled = true; submitBtn.disabled = true;
        } else {
            setSystemMessage(`strike! ${reason}`, true);
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
        }
    }
}

// 5. SHARED HELPERS
function renderFeedItem(displayName, extract, isMe) {
    const div = document.createElement('div');
    div.className = `feed-item ${isMe ? 'player' : 'opponent'}`;
    
    let summaryHtml = `<div class="player-summary">no summary available.</div>`;
    if (extract) {
        const summaryText = extract.split('\n')[0];
        const isIntl = summaryText.toLowerCase().includes('international') || summaryText.toLowerCase().includes('test match');
        summaryHtml = `
            <div class="player-badges">${isIntl ? '<span class="badge intl">intl</span>' : '<span class="badge">domestic</span>'}</div>
            <div class="player-summary">${summaryText}</div>
        `;
    }

    div.innerHTML = `
        <div class="feed-header">
            <div class="feed-meta">${isMe ? 'you' : (isMultiplayer ? 'opponent' : 'cpu')}</div>
            <div class="feed-name">${displayName.toUpperCase()}</div>
        </div>
        <div class="feed-details">${summaryHtml}</div>
    `;
    chainList.prepend(div);
    while (chainList.children.length > 2) chainList.removeChild(chainList.lastChild);
}

function setSystemMessage(msg, isError = true) {
    messageEl.style.color = isError ? "var(--loss)" : "var(--win)";
    messageEl.textContent = `// ${msg}`;
    setTimeout(() => {
        if (!isMultiplayer && lives <= 0) return;
        messageEl.style.color = "var(--text-dim)";
        messageEl.textContent = isMyTurn || !isMultiplayer ? "awaiting input..." : "waiting for opponent...";
    }, 4000);
}

function getFirstLetter(name) { return name.charAt(0); }
function getLastLetterOfSurname(name) {
    const parts = name.trim().split(' ');
    const surname = parts[parts.length - 1];
    return surname.charAt(surname.length - 1);
}

function scanDemographics(extract) {
    if (!extract) return { isIntl: false, isWomen: false, isMen: false };
    const lower = extract.toLowerCase();
    return {
        isIntl: lower.includes('international') || lower.includes('test match') || lower.includes('odi') || lower.includes('t20i'),
        isWomen: /\b(she|her)\b/i.test(extract) || lower.includes("women's"),
        isMen: /\b(he|his)\b/i.test(extract) || lower.includes("men's")
    };
}

function getNameFormats(trueFullName, isUnresolvedAbbrev = false) {
    const parts = trueFullName.trim().split(/\s+/);
    if (parts.length < 2) { const lower = trueFullName.toLowerCase(); return { full: lower, initials: lower, givenNames: [lower], isMulti: false }; }

    let surnameIdx = parts.length - 1;
    if (parts.length >= 3 && ['de', 'van', 'le', 'du', 'von', 'mac', 'mc', 'da', 'di'].includes(parts[parts.length - 2].toLowerCase())) surnameIdx = parts.length - 2;
    if (parts.length >= 4 && parts[parts.length - 3].toLowerCase() === 'van' && ['der', 'den'].includes(parts[parts.length - 2].toLowerCase())) surnameIdx = parts.length - 3;
    
    const surname = parts.slice(surnameIdx).join(' ').toLowerCase();
    const rawGiven = parts.slice(0, surnameIdx).map(n => n.toLowerCase());

    let givenNames = [];
    rawGiven.forEach(n => {
        if (isUnresolvedAbbrev && n.length <= 3 && !/[aeiouy]/.test(n)) givenNames.push(...n.split(''));
        else givenNames.push(n);
    });

    return { full: `${givenNames.join(' ')} ${surname}`, initials: `${givenNames.map(n => n[0]).join('')} ${surname}`, givenNames, isMulti: givenNames.length > 1 };
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

        const surname = queryName.trim().split(/\s+/).pop().toLowerCase();

        for (let pageData of pages) {
            if (pageData.title.includes("(disambiguation)")) continue;
            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const extract = pageData.extract || "";
            const normTitle = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const normSurname = surname.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (extract.toLowerCase().includes("cricket") && normTitle.includes(normSurname)) {
                const match = extract.split(/[.!?]/)[0].match(/^([^\(\,]+)(?:\(|\,)/);
                let trueName = match ? match[1].trim().toLowerCase() : title;
                return { resolved: trueName, extract: extract, isUnresolved: false };
            }
        }
    } catch (e) { console.error("wiki error:", e); }
    return { resolved: queryName.toLowerCase(), extract: null, isUnresolved: true };
}
