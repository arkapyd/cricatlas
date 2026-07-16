// pwa setup
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('service worker registered'))
        .catch(err => console.log('service worker failed', err));
}

// game state
let playersDb = [];
let usedPlayers = new Set();
let currentLetter = '';
let score = 0;
let currentMode = 'easy';

// ui elements
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

// handle mode selection tabs
tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.getAttribute('data-mode');
    });
});

// handle start button
startBtn.addEventListener('click', () => {
    welcomeView.style.display = 'none';
    gameView.style.display = 'block';
    modeDisplay.textContent = `mode: ${currentMode}`;
    
    // load db only when starting
    fetch('./cricket_atlas.json')
        .then(response => response.json())
        .then(data => {
            // map through the array of objects to pull the name string
            playersDb = data.map(player => player.name.toLowerCase().trim());
            startGame();
        })
        .catch(err => {
            messageEl.textContent = "system error: failed to load database.";
            messageEl.style.color = "var(--loss)";
            console.error(err);
        });
});

function startGame() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    messageEl.textContent = "engine initialized. cpu will start.";
    messageEl.style.color = "var(--text-dim)";
    
    // computer makes the first move
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

// generate a unique ID for each row so the async fetch knows where to inject the data
let moveCounter = 0;

function addToChain(name, isPlayer) {
    usedPlayers.add(name);
    currentLetter = getLastLetterOfSurname(name);
    moveCounter++;
    
    const div = document.createElement('div');
    div.className = `feed-item ${isPlayer ? 'player' : 'cpu'}`;
    
    // structure includes the header (CPU/YOU + Name) and the empty details container
    div.innerHTML = `
        <div class="feed-header">
            <div class="feed-meta">${isPlayer ? 'YOU' : 'CPU'}</div>
            <div class="feed-name">${name}</div>
        </div>
        <div id="details-${moveCounter}" class="feed-details">
            <div class="player-summary" style="font-style: italic;">fetching data...</div>
        </div>
    `;
    chainList.prepend(div);
    
    statusBox.textContent = currentLetter.toUpperCase();

    // trigger the wikipedia fetch
    fetchPlayerDetails(name, `details-${moveCounter}`);
}

function fetchPlayerDetails(playerName, elementId) {
    const detailsContainer = document.getElementById(elementId);
    if (!detailsContainer) return;

    // use generator=search to find "Name cricketer" to avoid disambiguation pages,
    // and prop=extracts to get the clean text summary.
    const query = encodeURIComponent(`${playerName} cricket`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${query}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.query || !data.query.pages) {
                detailsContainer.innerHTML = `<div class="player-summary">no wikipedia data found.</div>`;
                return;
            }

            // the api returns a dynamic page ID key, so we extract the first (and only) value
            const pages = data.query.pages;
            const pageId = Object.keys(pages)[0];
            const extract = pages[pageId].extract;

            if (!extract) {
                detailsContainer.innerHTML = `<div class="player-summary">no summary available.</div>`;
                return;
            }

            // clean up the text: grab the first sentence or two
            const summaryText = extract.split('\n')[0]; 
            const summaryLower = summaryText.toLowerCase();

            // simple heuristic scan for the badges
            const isIntl = summaryLower.includes('international') || summaryLower.includes('test match') || summaryLower.includes('odi');
            const formatBadge = isIntl ? `<span class="badge intl">International</span>` : `<span class="badge">Domestic</span>`;

            // inject the badges and the text
            detailsContainer.innerHTML = `
                <div class="player-badges">
                    ${formatBadge}
                </div>
                <div class="player-summary">${summaryText}</div>
            `;
        })
        .catch(err => {
            console.error('Wikipedia fetch error:', err);
            detailsContainer.innerHTML = `<div class="player-summary">failed to load data.</div>`;
        });
}

function computerTurn() {
    // right now logic is shared across all 3 modes as requested
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

    if (!playersDb.includes(inputName)) {
        setSystemMessage("invalid: player not found in database");
        return;
    }

    if (usedPlayers.has(inputName)) {
        setSystemMessage("invalid: player already used in this chain");
        return;
    }

    addToChain(inputName, true);
    score++;
    scoreEl.textContent = score;

    setTimeout(computerTurn, 800);
}

submitBtn.addEventListener('click', handlePlayerTurn);
playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handlePlayerTurn();
});
