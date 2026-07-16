// 1. pwa service worker setup
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('service worker registered'))
        .catch(err => console.log('service worker failed', err));
}

// 2. firebase configuration (replace with your actual config)
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

// initialize firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 3. game state
let playersDb = [];
let usedPlayers = new Set();
let currentLetter = '';
let score = 0;
let currentMode = 'easy';
let moveCounter = 0;

// 4. ui elements
const welcomeView = document.getElementById('welcome-view');
const gameView = document.getElementById('game-view');
const tabs = document.querySelectorAll('.tab-btn');
const startBtn = document.getElementById('start-btn');
const statusBox = document.getElementById('game-status');
const playerInput = document.getElementById('player-input');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const chainList = document.getElementById('chain-list');
const scoreEl = document.getElementById('score');
const modeDisplay = document.getElementById('mode-display');

// 5. event listeners
// handle mode selection tabs
tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.getAttribute('data-mode');
    });
});

// handle start button & load firebase data
startBtn.addEventListener('click', () => {
    welcomeView.style.display = 'none';
    gameView.style.display = 'block';
    modeDisplay.textContent = `mode: ${currentMode}`;
    
    db.ref('players').once('value')
        .then(snapshot => {
            const data = snapshot.val();
            
            if (!data) {
                setSystemMessage("database is empty. check firebase console.", true);
                return;
            }

            // bulletproof parsing: handles arrays, objects, and accidental double-nesting
            let rawArray = [];
            if (data.players) {
                rawArray = Array.isArray(data.players) ? data.players : Object.values(data.players);
            } else {
                rawArray = Array.isArray(data) ? data : Object.values(data);
            }

            // safely map, dropping any corrupted rows that don't have a 'name' property
            playersDb = rawArray
                .filter(player => player && player.name) 
                .map(player => player.name.toLowerCase().trim());
                
            startGame();
        })
        .catch(err => {
            setSystemMessage("system error: failed to connect to firebase.", true);
            console.error(err);
        });
});

submitBtn.addEventListener('click', handlePlayerTurn);
playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handlePlayerTurn();
});

// 6. core game functions
function startGame() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    setSystemMessage("engine initialized. cpu will start.", false);
    
    setTimeout(computerTurn, 600);
}

function getFirstLetter(name) {
    return name.charAt(0);
}

function getLastLetterOfSurname(name) {
    const parts = name.split(' ');
    const surname = parts[parts.length - 1];
    return surname.charAt(surname.length - 1);
}

function setSystemMessage(msg, isError = true) {
    messageEl.style.color = isError ? "var(--loss)" : "var(--win)";
    messageEl.textContent = `// ${msg}`;
    setTimeout(() => {
        messageEl.style.color = "var(--text-dim)";
        messageEl.textContent = "awaiting input...";
    }, 3000);
}

function computerTurn() {
    const validPlayers = playersDb.filter(p => 
        !usedPlayers.has(p) && 
        (currentLetter === '' || getFirstLetter(p) === currentLetter)
    );

    if (validPlayers.length === 0) {
        statusBox.textContent = "WIN";
        setSystemMessage("cpu exhausted database. you win!", false);
        playerInput.disabled = true;
        submitBtn.disabled = true;
        return;
    }

    const randomPlayer = validPlayers[Math.floor(Math.random() * validPlayers.length)];
    addToChain(randomPlayer, false);
}

function handlePlayerTurn() {
    const inputName = playerInput.value.toLowerCase().trim();
    playerInput.value = '';

    if (!inputName) return;

    if (currentLetter !== '' && getFirstLetter(inputName) !== currentLetter) {
        setSystemMessage(`invalid: name must start with '${currentLetter.toUpperCase()}'`);
        return;
    }

    if (usedPlayers.has(inputName)) {
        setSystemMessage("invalid: player already used in this chain");
        return;
    }

    if (!playersDb.includes(inputName)) {
        verifyAndAddPlayer(inputName);
        return;
    }

    executeValidMove(inputName);
}

function executeValidMove(inputName) {
    addToChain(inputName, true);
    score++;
    scoreEl.textContent = score;
    setTimeout(computerTurn, 800);
}

// 7. dynamic dom injection & wikipedia fetching
function addToChain(name, isPlayer) {
    usedPlayers.add(name);
    currentLetter = getLastLetterOfSurname(name);
    moveCounter++;
    
    const div = document.createElement('div');
    div.className = `feed-item ${isPlayer ? 'player' : 'cpu'}`;
    
    div.innerHTML = `
        <div class="feed-header">
            <div class="feed-meta">${isPlayer ? 'you' : 'cpu'}</div>
            <div class="feed-name">${name}</div>
        </div>
        <div id="details-${moveCounter}" class="feed-details">
            <div class="player-summary" style="font-style: italic;">fetching data...</div>
        </div>
    `;
    chainList.prepend(div);
    
    statusBox.textContent = currentLetter.toUpperCase();
    fetchPlayerDetails(name, `details-${moveCounter}`);
}

function fetchPlayerDetails(playerName, elementId) {
    const detailsContainer = document.getElementById(elementId);
    if (!detailsContainer) return;

    // STRONGER CRITERIA: 
    // 1. intitle:"name" forces the page title to match the player.
    // 2. "cricketer" ensures we prioritize cricket-related pages.
    const query = encodeURIComponent(`intitle:"${playerName}" cricketer`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${query}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.query || !data.query.pages) {
                detailsContainer.innerHTML = `<div class="player-summary">no wikipedia data found.</div>`;
                return;
            }

            const pageId = Object.keys(data.query.pages)[0];
            const pageData = data.query.pages[pageId];
            const title = pageData.title;
            const extract = pageData.extract;

            // NEW: Reject disambiguation pages (these are just lists of people with the same name)
            if (title.toLowerCase().includes("(disambiguation)") || !extract || extract.trim() === "") {
                detailsContainer.innerHTML = `<div class="player-summary">no specific cricketer profile found.</div>`;
                return;
            }

            // Clean up the text
            const summaryText = extract.split('\n')[0]; 
            const summaryLower = summaryText.toLowerCase();

            // Simple check for badges
            const isIntl = summaryLower.includes('international') || summaryLower.includes('test match') || summaryLower.includes('odi');
            const formatBadge = isIntl ? `<span class="badge intl">international</span>` : `<span class="badge">domestic</span>`;

            detailsContainer.innerHTML = `
                <div class="player-badges">
                    ${formatBadge}
                </div>
                <div class="player-summary">${summaryText}</div>
            `;
        })
        .catch(err => {
            console.error('wikipedia fetch error:', err);
            detailsContainer.innerHTML = `<div class="player-summary">failed to load data.</div>`;
        });
}

function verifyAndAddPlayer(inputName) {
    setSystemMessage(`verifying '${inputName}' on wikipedia...`, false);
    
    const query = encodeURIComponent(`${inputName} cricket`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${query}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.query || !data.query.pages) {
                setSystemMessage("player not found in database or on wikipedia.");
                return;
            }

            const pageId = Object.keys(data.query.pages)[0];
            const extract = data.query.pages[pageId].extract.toLowerCase();

            if (extract.includes("cricketer") || extract.includes("cricket")) {
                
                const newPlayerObj = {
                    identifier: Math.random().toString(16).slice(2, 10),
                    name: inputName,
                    unique_name: inputName,
                    all_name_variations: ""
                };

                db.ref('players').push(newPlayerObj)
                    .then(() => {
                        playersDb.push(inputName);
                        setSystemMessage(`verified! '${inputName}' added to global database.`, false);
                        executeValidMove(inputName);
                    })
                    .catch(err => {
                        console.error("firebase write error:", err);
                        setSystemMessage("verified, but failed to sync to global database.");
                    });
                
            } else {
                setSystemMessage(`found '${inputName}' on wiki, but they don't appear to be a cricketer.`);
            }
        })
        .catch(err => {
            console.error("wiki fetch error:", err);
            setSystemMessage("failed to connect to wikipedia for verification.");
        });
}
