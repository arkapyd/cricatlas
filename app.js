// 1. pwa service worker setup
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('service worker registered'))
        .catch(err => console.log('service worker failed', err));
}

// 2. firebase configuration (replace with your actual config)
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
const modeHelpText = document.getElementById('mode-help-text');

// 5. event listeners
const helpTexts = {
    'easy': '<span>easy:</span> standard name chain rules. initials (e.g. "a sharma") are accepted and dynamically expanded by the engine.',
    'medium': '<span>medium:</span> strict first names. you must provide the fully correct first name. initials will be rejected.',
    'hard': '<span>hard:</span> extreme strictness. you must provide either the fully expanded birth name (e.g. "rohit gurunath sharma") or exact initials (e.g. "r g sharma").'
};

tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        tabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.getAttribute('data-mode');
        
        // update the help text dynamically
        if (modeHelpText) {
            modeHelpText.style.opacity = '0';
            setTimeout(() => {
                modeHelpText.innerHTML = helpTexts[currentMode];
                modeHelpText.style.opacity = '1';
            }, 150);
        }
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
    }, 4500);
}

// parses a full name into pieces to enforce mode rules, dynamically handling multi-part surnames
function getNameFormats(trueFullName, isUnresolvedAbbrev = false) {
    const parts = trueFullName.trim().split(/\s+/);
    if (parts.length < 2) {
        const lower = trueFullName.toLowerCase();
        return { full: lower, initials: lower, givenNames: [lower], isMulti: false };
    }

    let surnameIdx = parts.length - 1;
    // detect common multi-part cricket surnames (de villiers, van der dussen, etc)
    if (parts.length >= 3 && ['de', 'van', 'le', 'du', 'von', 'mac', 'mc', 'da', 'di'].includes(parts[parts.length - 2].toLowerCase())) {
        surnameIdx = parts.length - 2;
    }
    if (parts.length >= 4 && parts[parts.length - 3].toLowerCase() === 'van' && ['der', 'den'].includes(parts[parts.length - 2].toLowerCase())) {
        surnameIdx = parts.length - 3;
    }
    
    const surname = parts.slice(surnameIdx).join(' ').toLowerCase();
    const rawGiven = parts.slice(0, surnameIdx).map(n => n.toLowerCase());

    let givenNames = [];
    rawGiven.forEach(n => {
        // if wikipedia failed to expand an initial block (like "HD" or "EM"), split it manually
        if (isUnresolvedAbbrev && n.length <= 3 && !/[aeiouy]/.test(n)) {
            givenNames.push(...n.split(''));
        } else {
            givenNames.push(n);
        }
    });

    const fullFirsts = givenNames.join(' ');
    const initials = givenNames.map(n => n[0]).join(''); 

    return {
        full: `${fullFirsts} ${surname}`,
        initials: `${initials} ${surname}`,
        givenNames: givenNames,
        isMulti: givenNames.length > 1
    };
}

// aggressively resolves birth names via wikipedia, falling back to fuzzy search if strict fails
async function resolveFullName(queryName) {
    const strictQuery = encodeURIComponent(`intitle:"${queryName}" cricketer`);
    const fuzzyQuery = encodeURIComponent(`${queryName} cricketer`);
    
    const fetchWiki = async (q) => {
        const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${q}&gsrlimit=1&prop=extracts&exintro=1&explaintext=1`);
        return res.json();
    };

    try {
        let data = await fetchWiki(strictQuery);
        let pageData = data.query && data.query.pages ? Object.values(data.query.pages)[0] : null;

        // if the strict search hits a disambiguation page or fails, pivot to fuzzy search
        if (!pageData || pageData.title.includes("(disambiguation)") || !pageData.extract) {
            data = await fetchWiki(fuzzyQuery);
            pageData = data.query && data.query.pages ? Object.values(data.query.pages)[0] : null;
        }

        if (pageData && !pageData.title.includes("(disambiguation)")) {
            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const extract = pageData.extract || "";

            if (extract.toLowerCase().includes("cricket")) {
                // extract the true birth name from the opening bracket of the biography
                const firstSentence = extract.split(/[.!?]/)[0];
                const match = firstSentence.match(/^([a-zA-Z\s\-']+)[(,\,]/);
                let trueName = match ? match[1].trim().toLowerCase() : title;
                
                // safety fallback if the regex grabbed too much text
                if (trueName.split(' ').length > 5 || trueName.length > 40) trueName = title; 
                return { resolved: trueName, extract: extract, isUnresolved: false };
            }
        }
    } catch (e) {
        console.error("wiki fetch error:", e);
    }
    
    // wikipedia completely failed to resolve the name
    return { resolved: queryName.toLowerCase(), extract: null, isUnresolved: true };
}

// 7. turn handlers
async function computerTurn() {
    setSystemMessage("cpu is calculating...", false);
    playerInput.disabled = true;
    submitBtn.disabled = true;

    let validCandidates = playersCatalog.filter(p => 
        !usedPlayers.has(p.full_name) && 
        !usedPlayers.has(p.unique_name) &&
        (currentLetter === '' || getFirstLetter(p.name) === currentLetter || getFirstLetter(p.unique_name) === currentLetter)
    );

    let selected, trueFullName, extract, formats;
    let foundValid = false;

    // attempt to find a compliant player up to 6 times to satisfy medium/hard mode rules
    for (let i = 0; i < 6; i++) {
        if (validCandidates.length === 0) break;

        const randIdx = Math.floor(Math.random() * validCandidates.length);
        selected = validCandidates.splice(randIdx, 1)[0];
        
        const wikiData = await resolveFullName(selected.unique_name || selected.name);
        trueFullName = wikiData.resolved;
        extract = wikiData.extract;
        formats = getNameFormats(trueFullName, wikiData.isUnresolved);

        const firstGiven = formats.givenNames[0] || "";
        const isLikelyInitial = wikiData.isUnresolved && firstGiven.length <= 2;

        if (currentMode === 'medium' && isLikelyInitial) {
            // CPU must provide a full first name. if wiki failed to expand an initial, discard candidate.
            continue; 
        }
        
        if (currentMode === 'hard' && wikiData.isUnresolved && !formats.isMulti && firstGiven.length <= 2) {
            // Hard mode requires full names or full initials. safely discard unresolved single initials.
            continue; 
        }

        foundValid = true;
        break;
    }

    if (!foundValid) {
        statusBox.textContent = "WIN";
        setSystemMessage("cpu exhausted valid database options. you win!", false);
        return;
    }

    // remove from global catalog
    const globalIdx = playersCatalog.indexOf(selected);
    if (globalIdx > -1) playersCatalog.splice(globalIdx, 1);

    // dynamically patch missing full names in firebase to speed up future lookups
    if ((currentMode === 'medium' || currentMode === 'hard') && !selected.full_name && selected.fbKey && extract) {
        db.ref('players/' + selected.fbKey).update({ full_name: trueFullName }).catch(e => console.error(e));
    }

    let playName = selected.name;

    // format the output depending on the mode
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
    const isUnresolved = wikiData.isUnresolved;

    if (usedPlayers.has(trueFullName)) {
        setSystemMessage(`invalid: ${trueFullName.toUpperCase()} already used in this game.`);
        playerInput.disabled = false;
        submitBtn.disabled = false;
        playerInput.focus();
        return;
    }

    const formats = getNameFormats(trueFullName, isUnresolved);
    const inputParts = inputName.split(/\s+/);

    // strictly enforce user formatting based on the selected mode
    if (currentMode === 'medium') {
        if (isUnresolved && inputParts[0].length <= 2) {
            setSystemMessage(`medium mode: fully correct first name required. we couldn't verify '${inputParts[0]}' as a full name.`);
            playerInput.disabled = false;
            submitBtn.disabled = false;
            return;
        }
        if (inputParts[0] !== formats.givenNames[0]) {
            setSystemMessage(`medium mode: fully correct first name required (e.g. '${formats.givenNames[0].toUpperCase()}').`);
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
                setSystemMessage(`hard mode: require all initials (e.g. '${formats.initials.toUpperCase()}') or full names (e.g. '${formats.full.toUpperCase()}').`);
            } else {
                if (inputParts[0] !== formats.givenNames[0]) {
                    setSystemMessage(`hard mode: full first name required (e.g. '${formats.full.toUpperCase()}').`);
                }
            }
            playerInput.disabled = false;
            submitBtn.disabled = false;
            return;
        }
    }

    // check if the exact identity exists anywhere in the catalog. if not, push to firebase.
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
        // remove the used iteration from the stack
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
    
    // instantly render the cached wikipedia extract so no double-fetching occurs
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
            <div class="feed-name">${displayName.toUpperCase()}</div>
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
