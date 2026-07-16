// update with your keys
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

let currentUser = null;
let currentGameId = null;
let gameRef = null;
let isMyTurn = false;

// UI Elements
const authView = document.getElementById('auth-view');
const lobbyView = document.getElementById('lobby-view');
const gameView = document.getElementById('game-view');

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

// 1. AUTHENTICATION
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        playerNameDisplay.textContent = user.displayName.split(' ')[0];
        authView.style.display = 'none';
        gameView.style.display = 'none';
        lobbyView.style.display = 'flex';
    } else {
        currentUser = null;
        lobbyView.style.display = 'none';
        gameView.style.display = 'none';
        authView.style.display = 'flex';
    }
});

loginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err => alert("login failed: " + err.message));
});

logoutBtn.addEventListener('click', () => auth.signOut());

// 2. MATCHMAKING
findMatchBtn.addEventListener('click', async () => {
    findMatchBtn.disabled = true;
    findMatchBtn.textContent = 'SEARCHING...';
    findMatchBtn.classList.add('pulse');
    lobbyStatus.textContent = 'looking for an open arena...';

    const queueRef = db.ref('queue');
    
    // Check if anyone is waiting
    queueRef.orderByChild('status').equalTo('waiting').limitToFirst(1).once('value', snapshot => {
        if (snapshot.exists()) {
            // Join existing game
            const matchId = Object.keys(snapshot.val())[0];
            joinGame(matchId);
        } else {
            // Create new game
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

    // Listen for someone to join
    newGameRef.on('value', snap => {
        const game = snap.val();
        if (game && game.status === 'playing') {
            newGameRef.off();
            initGameEngine(currentGameId, game);
        }
    });
}

function joinGame(matchId) {
    lobbyStatus.textContent = 'arena found! connecting...';
    currentGameId = matchId;
    const gameRef = db.ref(`queue/${matchId}`);
    
    // Transaction to securely join
    gameRef.transaction(game => {
        if (game && game.status === 'waiting') {
            game.status = 'playing';
            game.p2 = { uid: currentUser.uid, name: currentUser.displayName, lives: 3 };
            game.turn = game.p1.uid; // P1 goes first
            game.currentLetter = '';
            game.usedPlayers = { placeholder: true };
            return game;
        }
        return; // Abort if game is no longer waiting
    }, (error, committed, snapshot) => {
        if (committed) {
            initGameEngine(currentGameId, snapshot.val());
        } else {
            // Missed it, try searching again
            findMatchBtn.disabled = false;
            findMatchBtn.click();
        }
    });
}

// 3. MULTIPLAYER GAME LOOP
function initGameEngine(gameId, initialData) {
    lobbyView.style.display = 'none';
    gameView.style.display = 'flex';
    chainList.innerHTML = '';
    
    const isP1 = initialData.p1.uid === currentUser.uid;
    const opponent = isP1 ? initialData.p2 : initialData.p1;
    opponentNameEl.textContent = opponent.name.split(' ')[0];

    gameRef = db.ref(`queue/${gameId}`);
    
    // Listen to all real-time changes in this game
    gameRef.on('value', snap => {
        const game = snap.val();
        if (!game) return;
        renderGameState(game, isP1);
    });
}

function renderGameState(game, amIP1) {
    // 1. Update Lives
    const myLives = amIP1 ? game.p1.lives : game.p2.lives;
    const oppLives = amIP1 ? game.p2.lives : game.p1.lives;
    
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, myLives)) + '♡'.repeat(Math.max(0, 3 - myLives));
    opponentLivesEl.textContent = '♥'.repeat(Math.max(0, oppLives)) + '♡'.repeat(Math.max(0, 3 - oppLives));

    // 2. Check Game Over
    if (game.status === 'finished') {
        playerInput.disabled = true;
        submitBtn.disabled = true;
        isMyTurn = false;
        
        if (game.winner === currentUser.uid) {
            turnIndicator.textContent = "VICTORY";
            turnIndicator.style.color = "var(--win)";
            statusBox.textContent = "WIN";
            setSystemMessage("opponent eliminated. you win!", false);
        } else {
            turnIndicator.textContent = "DEFEAT";
            turnIndicator.style.color = "var(--loss)";
            statusBox.textContent = "LOSE";
            setSystemMessage("you were eliminated.", true);
        }
        return;
    }

    // 3. Update Turn State
    isMyTurn = (game.turn === currentUser.uid);
    statusBox.textContent = game.currentLetter ? game.currentLetter.toUpperCase() : "ANY";

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

// 4. CLIENT-AUTHORITATIVE VALIDATION
submitBtn.addEventListener('click', handleMove);
playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleMove();
});

async function handleMove() {
    if (!isMyTurn) return;

    const inputName = playerInput.value.toLowerCase().trim();
    playerInput.value = '';
    if (!inputName) return;

    playerInput.disabled = true;
    submitBtn.disabled = true;
    setSystemMessage(`verifying '${inputName}'...`, false);

    // Fetch current state to validate safely
    const snap = await gameRef.once('value');
    const game = snap.val();
    
    if (game.currentLetter && inputName.charAt(0) !== game.currentLetter) {
        await punishPlayer(game, `name must start with '${game.currentLetter.toUpperCase()}'.`);
        return;
    }

    // Ping Wikipedia directly
    const wikiData = await resolveFullName(inputName);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    if (game.usedPlayers && game.usedPlayers[trueFullName]) {
        await punishPlayer(game, `${trueFullName.toUpperCase()} was already used.`);
        return;
    }

    if (!extract || !extract.toLowerCase().includes("cricket")) {
        await punishPlayer(game, `could not verify '${inputName}' as a cricketer.`);
        return;
    }

    // Valid Move - Push to Firebase
    const oppUid = (game.p1.uid === currentUser.uid) ? game.p2.uid : game.p1.uid;
    const nextLetter = getLastLetterOfSurname(inputName);
    
    const updates = {
        currentLetter: nextLetter,
        turn: oppUid,
        [`usedPlayers/${trueFullName}`]: true
    };
    
    await gameRef.update(updates);
    
    // Inject visually onto local screen and opponent screen via DB
    pushMoveVisually(gameRef, inputName, extract, currentUser.uid);
}

// Helper: Deducts life, triggers game over if 0
async function punishPlayer(game, reason) {
    const isP1 = game.p1.uid === currentUser.uid;
    const currentLives = isP1 ? game.p1.lives : game.p2.lives;
    const oppUid = isP1 ? game.p2.uid : game.p1.uid;
    
    if (currentLives - 1 <= 0) {
        // Game Over
        await gameRef.update({
            status: 'finished',
            winner: oppUid,
            [`${isP1 ? 'p1' : 'p2'}/lives`]: 0
        });
    } else {
        // Strike
        setSystemMessage(`strike! ${reason}`, true);
        await gameRef.update({
            [`${isP1 ? 'p1' : 'p2'}/lives`]: currentLives - 1
        });
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
    }
}

// Pushes visual move to DB so both clients render it
function pushMoveVisually(ref, displayName, extract, uid) {
    const newMoveRef = ref.child('moves').push();
    newMoveRef.set({ displayName, extract, uid });
}

// Listen for visual moves being added
gameRef && gameRef.child('moves').on('child_added', snap => {
    const move = snap.val();
    renderFeedItem(move.displayName, move.extract, move.uid === currentUser.uid);
});

function renderFeedItem(displayName, extract, isMe) {
    const div = document.createElement('div');
    div.className = `feed-item ${isMe ? 'player' : 'opponent'}`;
    
    const summaryText = extract.split('\n')[0];
    const isIntl = summaryText.toLowerCase().includes('international') || summaryText.toLowerCase().includes('test match');
    const badge = isIntl ? `<span class="badge intl">intl</span>` : `<span class="badge">domestic</span>`;

    div.innerHTML = `
        <div class="feed-header">
            <div class="feed-meta">${isMe ? 'you' : 'opponent'}</div>
            <div class="feed-name">${displayName.toUpperCase()}</div>
        </div>
        <div class="feed-details">
            <div class="player-badges">${badge}</div>
            <div class="player-summary">${summaryText}</div>
        </div>
    `;
    
    chainList.prepend(div);
    while (chainList.children.length > 2) {
        chainList.removeChild(chainList.lastChild);
    }
}

function getLastLetterOfSurname(name) {
    const parts = name.trim().split(' ');
    const surname = parts[parts.length - 1];
    return surname.charAt(surname.length - 1);
}

// Re-using the Wiki Engine
async function resolveFullName(queryName) {
    const strictQuery = encodeURIComponent(`intitle:"${queryName}" cricketer`);
    const fuzzyQuery = encodeURIComponent(`${queryName} cricketer`);
    
    const fetchWiki = async (q) => {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${q}&gsrlimit=5&prop=extracts&exintro=1&explaintext=1`);
        return res.json();
    };

    try {
        let data = await fetchWiki(strictQuery);
        let pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
        if (pages.length === 0) {
            data = await fetchWiki(fuzzyQuery);
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
                const firstSentence = extract.split(/[.!?]/)[0];
                const match = firstSentence.match(/^([^\(\,]+)(?:\(|\,)/);
                let trueName = match ? match[1].trim().toLowerCase() : title;
                return { resolved: trueName, extract: extract };
            }
        }
    } catch (e) { console.error("wiki fetch error:", e); }
    return { resolved: queryName.toLowerCase(), extract: null };
}
