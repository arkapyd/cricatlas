if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('service worker failed', err));
}

// update with your keys, keeping the commas intact
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

let playersCatalog = []; 
let usedPlayers = new Set();
let currentLetter = '';
let score = 0;
let currentMode = 'easy';
let currentCategory = 'general';
let moveCounter = 0;

const welcomeView = document.getElementById('welcome-view');
const gameView = document.getElementById('game-view');
const diffTabs = document.querySelectorAll('.diff-btn');
const catTabs = document.querySelectorAll('.cat-btn');
const modeHelpText = document.getElementById('mode-help-text');
const startBtn = document.getElementById('start-btn');
const statusBox = document.getElementById('game-status');
const playerInput = document.getElementById('player-input');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const chainList = document.getElementById('chain-list');
const scoreEl = document.getElementById('score');
const modeDisplay = document.getElementById('mode-display');

const helpTexts = {
    easy: "<span>easy:</span> standard name chain. initials are accepted and expanded by the engine.",
    medium: "<span>medium:</span> strict first names. you must provide the fully correct first name. initials rejected.",
    hard: "<span>hard:</span> extreme strictness. requires fully expanded birth names or exact full initials.",
    general: "<span>general:</span> any verified cricketer is valid.",
    intl: "<span>intl only:</span> player must have international, test, odi, or t20i experience.",
    domestic: "<span>domestic only:</span> player must only have domestic experience.",
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

diffTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        diffTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentMode = e.target.getAttribute('data-mode');
        updateHelpText();
    });
});

catTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
        catTabs.forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        currentCategory = e.target.getAttribute('data-category');
        updateHelpText();
    });
});

startBtn.addEventListener('click', () => {
    welcomeView.style.display = 'none';
    gameView.style.display = 'block';
    modeDisplay.textContent = `mode: ${currentMode} / ${currentCategory}`;
    
    db.ref('players').once('value')
        .then(snapshot => {
            const data = snapshot.val();
            if (!data) {
                setSystemMessage("database is empty. check firebase console.", true);
                return;
            }

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

function startGame() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    setSystemMessage("engine initialized. cpu will start.", false);
    setTimeout(computerTurn, 600);
}

function getFirstLetter(name) { return name.charAt(0); }
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

function scanDemographics(extract) {
    if (!extract) return { isIntl: false, isWomen: false, isMen: false };
    const lower = extract.toLowerCase();
    const isIntl = lower.includes('international') || lower.includes('test match') || lower.includes('odi') || lower.includes('t20i');
    const isWomen = /\b(she|her)\b/i.test(extract) || lower.includes("women's");
    const isMen = /\b(he|his)\b/i.test(extract) || lower.includes("men's");
    return { isIntl, isWomen, isMen };
}

function getNameFormats(trueFullName, isUnresolvedAbbrev = false) {
    const parts = trueFullName.trim().split(/\s+/);
    if (parts.length < 2) {
        const lower = trueFullName.toLowerCase();
        return { full: lower, initials: lower, givenNames: [lower], isMulti: false };
    }

    let surnameIdx = parts.length - 1;
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
        if (isUnresolvedAbbrev && n.length <= 3 && !/[aeiouy]/.test(n)) {
            givenNames.push(...n.split(''));
        } else {
            givenNames.push(n);
        }
    });

    const fullFirsts = givenNames.join(' ');
    const initials = givenNames.map(n => n[0]).join(''); 
    return { full: `${fullFirsts} ${surname}`, initials: `${initials} ${surname}`, givenNames, isMulti: givenNames.length > 1 };
}

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

        const queryParts = queryName.trim().split(/\s+/);
        const surname = queryParts[queryParts.length - 1].toLowerCase();

        for (let pageData of pages) {
            if (pageData.title.includes("(disambiguation)")) continue;

            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const extract = pageData.extract || "";
            const normalizedTitle = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const normalizedSurname = surname.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

            if (extract.toLowerCase().includes("cricket") && normalizedTitle.includes(normalizedSurname)) {
                const firstSentence = extract.split(/[.!?]/)[0];
                const match = firstSentence.match(/^([^\(\,]+)(?:\(|\,)/);
                let trueName = match ? match[1].trim().toLowerCase() : title;
                if (trueName.split(' ').length > 5 || trueName.length > 40) trueName = title; 
                return { resolved: trueName, extract: extract, isUnresolved: false };
            }
        }
    } catch (e) { console.error("wiki fetch error:", e); }
    return { resolved: queryName.toLowerCase(), extract: null, isUnresolved: true };
}

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

    // up to 25 attempts to satisfy both difficulty and demographic category rules
    for (let i = 0; i < 25; i++) {
        if (validCandidates.length === 0) break;

        const randIdx = Math.floor(Math.random() * validCandidates.length);
        selected = validCandidates.splice(randIdx, 1)[0];
        
        const wikiData = await resolveFullName(selected.unique_name || selected.name);
        trueFullName = wikiData.resolved;
        extract = wikiData.extract;
        formats = getNameFormats(trueFullName, wikiData.isUnresolved);

        // evaluate difficulty limits
        const firstGiven = formats.givenNames[0] || "";
        const isLikelyInitial = wikiData.isUnresolved && firstGiven.length <= 2;
        if (currentMode === 'medium' && isLikelyInitial) continue; 
        if (currentMode === 'hard' && wikiData.isUnresolved && !formats.isMulti && firstGiven.length <= 2) continue; 

        // evaluate demographic category limits
        const demo = scanDemographics(extract);
        if (currentCategory === 'intl' && !demo.isIntl) continue;
        if (currentCategory === 'domestic' && demo.isIntl) continue;
        if (currentCategory === 'women' && !demo.isWomen) continue;
        if (currentCategory === 'men' && demo.isWomen) continue;

        foundValid = true;
        break;
    }

    if (!foundValid) {
        statusBox.textContent = "WIN";
        setSystemMessage("cpu exhausted valid options for these rules. you win!", false);
        return;
    }

    const globalIdx = playersCatalog.indexOf(selected);
    if (globalIdx > -1) playersCatalog.splice(globalIdx, 1);

    if ((currentMode === 'medium' || currentMode === 'hard') && !selected.full_name && selected.fbKey && extract) {
        db.ref('players/' + selected.fbKey).update({ full_name: trueFullName }).catch(e => console.error(e));
    }

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
    const isUnresolved = wikiData.isUnresolved;

    if (usedPlayers.has(trueFullName)) {
        setSystemMessage(`invalid: ${trueFullName.toUpperCase()} already used in this game.`);
        resetInput();
        return;
    }

    const demo = scanDemographics(extract);
    
    if (currentCategory === 'intl' && !demo.isIntl) {
        setSystemMessage(`invalid: 'intl only' mode active. player profile indicates domestic only.`);
        resetInput(); return;
    }
    if (currentCategory === 'domestic' && demo.isIntl) {
        setSystemMessage(`invalid: 'domestic only' mode active. player profile indicates international experience.`);
        resetInput(); return;
    }
    if (currentCategory === 'women' && !demo.isWomen) {
        setSystemMessage(`invalid: 'women only' mode active. player demographic mismatch.`);
        resetInput(); return;
    }
    if (currentCategory === 'men' && demo.isWomen) {
        setSystemMessage(`invalid: 'men only' mode active. player demographic mismatch.`);
        resetInput(); return;
    }

    const formats = getNameFormats(trueFullName, isUnresolved);
    const inputParts = inputName.split(/\s+/);

    if (currentMode === 'medium') {
        if (isUnresolved && inputParts[0].length <= 2) {
            setSystemMessage(`medium mode: fully correct first name required. couldn't verify '${inputParts[0]}'.`);
            resetInput(); return;
        }
        if (inputParts[0] !== formats.givenNames[0]) {
            setSystemMessage(`medium mode: fully correct first name required (e.g. '${formats.givenNames[0].toUpperCase()}').`);
            resetInput(); return;
        }
    } else if (currentMode === 'hard') {
        const inputCompressed = inputName.replace(/\s+/g, '');
        const initialsCompressed = formats.initials.replace(/\s+/g, '');
        const fullCompressed = formats.full.replace(/\s+/g, '');

        if (inputCompressed !== fullCompressed && inputCompressed !== initialsCompressed) {
            if (formats.isMulti) {
                setSystemMessage(`hard mode: require all initials (e.g. '${formats.initials.toUpperCase()}') or full names.`);
            } else {
                if (inputParts[0] !== formats.givenNames[0]) {
                    setSystemMessage(`hard mode: full first name required.`);
                }
            }
            resetInput(); return;
        }
    }

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
            } catch(e) { console.error("firebase write error:", e); }
        } else {
            setSystemMessage(`'${inputName}' is not in the database and could not be verified on wikipedia.`);
            resetInput(); return;
        }
    } else {
        playersCatalog.splice(playerIdx, 1);
    }

    executeValidMove(inputName, trueFullName, extract, true);
}

function resetInput() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    playerInput.focus();
}

function executeValidMove(displayName, trueFullName, extract, isPlayer) {
    usedPlayers.add(trueFullName);
    currentLetter = getLastLetterOfSurname(displayName);
    moveCounter++;
    
    const div = document.createElement('div');
    div.className = `feed-item ${isPlayer ? 'player' : 'cpu'}`;
    
    let summaryHtml = `<div class="player-summary">no summary available.</div>`;
    if (extract) {
        const summaryText = extract.split('\n')[0];
        const demo = scanDemographics(extract);
        const formatBadge = demo.isIntl ? `<span class="badge intl">international</span>` : `<span class="badge">domestic</span>`;
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
        resetInput();
        setSystemMessage("your turn.", false);
    }
}
