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

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 3. game state & catalog
// stores array of objects: { fbKey, name, unique_name, full_name }
let playersCatalog = []; 
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
tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.getAttribute('data-mode');
    });
});

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

            // safely parse flat arrays or push-key objects and preserve the firebase key for updating
            let rawArray = [];
            let sourceData = data.players ? data.players : data;
            
            if (Array.isArray(sourceData)) {
                sourceData.forEach((p, idx) => { if (p) rawArray.push({...p, fbKey: idx.toString()}); });
            } else {
                Object.keys(sourceData).forEach(key => {
                    if (sourceData[key]) rawArray.push({...sourceData[key], fbKey: key});
                });
            }

            rawArray.forEach(player => {
                if (player && player.name) {
                    playersCatalog.push({
                        fbKey: player.fbKey,
                        name: player.name.toLowerCase().trim(),
                        unique_name: (player.unique_name || player.name).toLowerCase().trim(),
                        full_name: (player.full_name || '').toLowerCase().trim()
                    });
                }
            });
                
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

// 6. core game & validation functions
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
    const parts = name.trim().split(' ');
    const surname = parts[parts.length - 1];
    return surname.charAt(surname.length - 1);
}

function setSystemMessage(msg, isError = true) {
    messageEl.style.color = isError ? "var(--loss)" : "var(--win)";
    messageEl.textContent = `// ${msg}`;
    setTimeout(() => {
        messageEl.style.color = "var(--text-dim)";
        messageEl.textContent = "awaiting input...";
    }, 3500);
}

// parses a full name into pieces to enforce mode rules
function getNameFormats(trueFullName) {
    const parts = trueFullName.trim().split(/\s+/);
    if (parts.length < 2) {
        const lower = trueFullName.toLowerCase();
        return { full: lower, initials: lower, givenNames: [lower], isMulti: false };
    }

    // safely detach surnames with prefixes
    let surnameIdx = parts.length - 1;
    if (parts.length > 2 && ['de', 'van', 'le', 'du'].includes(parts[parts.length - 2].toLowerCase())) {
        surnameIdx = parts.length - 2;
    }
    
    const surname = parts.slice(surnameIdx).join(' ').toLowerCase();
    const givenNames = parts.slice(0, surnameIdx).map(n => n.toLowerCase());

    const fullFirsts = givenNames.join(' ');
    const initials = givenNames.map(n => n[0]).join('');

    return {
        full: `${fullFirsts} ${surname}`,
        initials: `${initials} ${surname}`,
        givenNames: givenNames,
        isMulti: givenNames.length > 1
    };
}

// pulls the true birth name and the summary block directly from wikipedia
async function resolveFullName(queryName) {
    const strictQuery = encodeURIComponent(`intitle:"${queryName}" cricketer`);
    const fuzzyQuery = encodeURIComponent(`${queryName} cricketer`);
    
    try {
        let res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${strictQuery}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`);
        let data = await res.json();
        
        if (!data.query || !data.query.pages) {
            res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${fuzzyQuery}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`);
            data = await res.json();
        }

        if (data.query && data.query.pages) {
            const pageId = Object.keys(data.query.pages)[0];
            const pageData = data.query.pages[pageId];
            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const extract = pageData.extract || "";

            if (!title.includes("(disambiguation)") && extract.toLowerCase().includes("cricket")) {
                const firstSentence = extract.split(/[.!?]/)[0];
                const match = firstSentence.match(/^([a-zA-Z\s\-]+)[(,\,]/);
                let trueName = match ? match[1].trim().toLowerCase() : title;
                
                // safety fallback if the regex grabbed too much text
                if (trueName.split(' ').length > 5 || trueName.length > 40) trueName = title; 
                return { resolved: trueName, extract: extract };
            }
        }
    } catch (e) {
        console.error("wiki fetch error:", e);
    }
    return { resolved: queryName.toLowerCase(), extract: null };
}

// 7. turn handlers
async function computerTurn() {
    setSystemMessage("cpu is calculating...", false);
    playerInput.disabled = true;
    submitBtn.disabled = true;

    // locate all database entries matching the target letter that haven't been burned yet
    const validCandidates = playersCatalog.filter(p => 
        !usedPlayers.has(p.full_name) && 
        !usedPlayers.has(p.unique_name) &&
        (currentLetter === '' || getFirstLetter(p.name) === currentLetter || getFirstLetter(p.unique_name) === currentLetter)
    );

    if (validCandidates.length === 0) {
        statusBox.textContent = "WIN";
        setSystemMessage("cpu exhausted database. you win!", false);
        return;
    }

    const randIdx = Math.floor(Math.random() * validCandidates.length);
    const selected = validCandidates.splice(randIdx, 1)[0];
    
    const globalIdx = playersCatalog.indexOf(selected);
    if (globalIdx > -1) playersCatalog.splice(globalIdx, 1);

    const wikiData = await resolveFullName(selected.unique_name || selected.name);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    // dynamically patch missing full names in firebase for future loads
    if ((currentMode === 'medium' || currentMode === 'hard') && !selected.full_name && selected.fbKey) {
        db.ref('players/' + selected.fbKey).update({ full_name: trueFullName }).catch(e => console.error(e));
    }

    const formats = getNameFormats(trueFullName);
    let playName = selected.name;

    if (currentMode === 'medium') {
        playName = formats.full;
    } else if (currentMode === 'hard') {
        playName = Math.random() > 0.5 ? formats.initials : formats.full;
    }

    executeValidMove(playName, trueFullName, extract, false);
}

async function handlePlayerTurn() {
    const inputName = playerInput.value.toLowerCase().trim();
    playerInput.value = '';

    if (!inputName) return;

    if (currentLetter !== '' && getFirstLetter(inputName) !== currentLetter) {
        setSystemMessage(`invalid: name must start with '${currentLetter.toUpperCase()}'`);
        return;
    }

    setSystemMessage(`analyzing '${inputName}'...`, false);
    playerInput.disabled = true;
    submitBtn.disabled = true;
    
    const wikiData = await resolveFullName(inputName);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    if (usedPlayers.has(trueFullName)) {
        setSystemMessage(`invalid: ${trueFullName.toUpperCase()} already used in this game.`);
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
        return;
    }

    const formats = getNameFormats(trueFullName);
    const inputParts = inputName.split(' ');

    // enforce strict formatting based on the selected mode
    if (currentMode === 'medium') {
        if (inputParts[0] !== formats.givenNames[0]) {
            setSystemMessage(`medium mode: fully correct first name required (no initials).`);
            playerInput.disabled = false;
            submitBtn.disabled = false;
            return;
        }
    } else if (currentMode === 'hard') {
        const inputCompressed = inputName.replace(/\s+/g, '');
        const initialsCompressed = formats.initials.replace(/\s+/g, '');
        const fullCompressed = formats.full.replace(/\s+/g, '');

        if (inputCompressed !== fullCompressed && inputCompressed !== initialsCompressed) {
            if (formats.isMulti) {
                setSystemMessage(`hard mode: require all initials (e.g. '${formats.initials}') or full names (e.g. '${formats.full}').`);
            } else {
                if (inputParts[0] !== formats.givenNames[0]) {
                    setSystemMessage(`hard mode: full first name required (e.g. '${formats.full}').`);
                }
            }
            playerInput.disabled = false;
            submitBtn.disabled = false;
            return;
        }
    }

    // check if the exact identity exists anywhere in the catalog. if not, create it.
    let playerIdx = playersCatalog.findIndex(p => p.full_name === trueFullName || p.unique_name === trueFullName || p.name === trueFullName);
    
    if (playerIdx === -1) {
        if (extract && extract.toLowerCase().includes("cricket")) {
            const newPlayerObj = {
                identifier: Math.random().toString(16).slice(2, 10),
                name: inputName,
                unique_name: trueFullName,
                full_name: trueFullName,
                all_name_variations: ""
            };
            try {
                const ref = await db.ref('players').push(newPlayerObj);
                newPlayerObj.fbKey = ref.key;
                setSystemMessage(`verified! '${inputName}' added to global database.`, false);
            } catch(e) {
                console.error("firebase write error:", e);
            }
        } else {
            setSystemMessage(`found '${trueFullName}' on wiki, but they don't appear to be a cricketer.`);
            playerInput.disabled = false;
            submitBtn.disabled = false;
            return;
        }
    } else {
        // remove the used iteration from the stack so the cpu won't pick it
        playersCatalog.splice(playerIdx, 1);
    }

    executeValidMove(inputName, trueFullName, extract, true);
}

// 8. rendering
function executeValidMove(displayName, trueFullName, extract, isPlayer) {
    usedPlayers.add(trueFullName);
    currentLetter = getLastLetterOfSurname(displayName);
    moveCounter++;
    
    const div = document.createElement('div');
    div.className = `feed-item ${isPlayer ? 'player' : 'cpu'}`;
    
    let summaryHtml = `<div class="player-summary">no summary available.</div>`;
    if (extract) {
        const summaryText = extract.split('\n')[0];
        const summaryLower = summaryText.toLowerCase();
        const isIntl = summaryLower.includes('international') || summaryLower.includes('test match') || summaryLower.includes('odi');
        const formatBadge = isIntl ? `<span class="badge intl">international</span>` : `<span class="badge">domestic</span>`;
        summaryHtml = `
            <div class="player-badges">${formatBadge}</div>
            <div class="player-summary">${summaryText}</div>
        `;
    }

    div.innerHTML = `
        <div class="feed-header">
            <div class="feed-meta">${isPlayer ? 'you' : 'cpu'}</div>
            <div class="feed-name">${displayName}</div>
        </div>
        <div id="details-${moveCounter}" class="feed-details">
            ${summaryHtml}
        </div>
    `;
    chainList.prepend(div);
    statusBox.textContent = currentLetter.toUpperCase();
    
    if (isPlayer) {
        score++;
        scoreEl.textContent = score;
        setTimeout(computerTurn, 1000);
    } else {
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
        setSystemMessage("your turn.", false);
    }
}
