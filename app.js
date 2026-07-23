if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.log('service worker failed', err));
}

// audio setup
const clickSound = new Audio('audio/ui_click.mp3');
const correctSound = new Audio('audio/bat_hit.mp3');
const wrongSound = new Audio('audio/crowd_groan.mp3');

correctSound.volume = 0.7;
wrongSound.volume = 0.7;

// mobile browsers block audio until a user gesture. on the first interaction,
// briefly play+pause each clip to unlock the audio elements so later sound
// effects (moves, revives) actually fire.
let audioUnlocked = false;
function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    [clickSound, correctSound, wrongSound].forEach(a => {
        try { a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {}); } catch (e) {}
    });
}
['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evt =>
    document.addEventListener(evt, unlockAudio, { once: true, passive: true }));

function playSound(audioElement) {
    audioElement.currentTime = 0;
    audioElement.play().catch(err => console.log('audio playback blocked until user interaction', err));
}

function muteGameAudio() {
    clickSound.muted = true;
    correctSound.muted = true;
    wrongSound.muted = true;
}

function unmuteGameAudio() {
    clickSound.muted = false;
    correctSound.muted = false;
    wrongSound.muted = false;
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

// monetization state
let gamesCompleted = 0;
let rewardedAdsUsed = 0;
const MAX_REWARDS = 3;

// ad initialization fallback
window.adBreak = window.adBreak || function(o) { 
    console.log("ad api not found or blocked. skipping ad logic.");
    if (o.adViewed) o.adViewed();
    if (o.afterAd) o.afterAd();
};

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

// ad elements
const reviveContainer = document.getElementById('revive-container');
const revivesLeftEl = document.getElementById('revives-left');
const rewardAdBtn = document.getElementById('reward-ad-btn');
const declineReviveBtn = document.getElementById('decline-revive-btn');

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

const difficultyDesc = {
    easy: "standard name chain. initials are accepted.",
    medium: "strict first names required. initials blocked.",
    hard: "extreme strictness. exact full birth names required."
};

const categoryDesc = {
    general: "any verified cricketer is valid.",
    intl: "international experience required.",
    domestic: "domestic experience only.",
    men: "restricted to male cricketers.",
    women: "restricted to female cricketers."
};

function updateHelpText() {
    let helpBox = document.getElementById('mode-help-text');
    
    if (!helpBox) {
        const allDivs = document.querySelectorAll('div');
        for (const d of allDivs) {
            if (d.textContent.includes('easy (general):')) {
                helpBox = d;
                helpBox.id = 'mode-help-text';
                break;
            }
        }
    }

    if (!helpBox) {
        console.error("error: could not locate the help text box in the html.");
        return;
    }

    const safeMode = (currentMode || 'easy').toLowerCase().trim();
    const safeCat = (currentCategory || 'general').toLowerCase().replace(' only', '').trim();

    const dText = difficultyDesc[safeMode] || difficultyDesc['easy'];
    const cText = categoryDesc[safeCat] || categoryDesc['general'];
    
    helpBox.style.opacity = '0';
    
    setTimeout(() => {
        helpBox.innerHTML = `<span style="color: var(--accent); font-weight: bold;">${safeMode} (${safeCat}):</span> ${dText} ${cText}`;
        helpBox.style.opacity = '1';
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
            applyModeLocks(totalUserCP);
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

loginBtn.addEventListener('click', () => {
    playSound(clickSound);
    auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
});

logoutBtn.addEventListener('click', () => {
    playSound(clickSound);
    auth.signOut();
});

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installAppBtn) installAppBtn.classList.remove('hide-element');
});

if (installAppBtn) {
    installAppBtn.addEventListener('click', async () => {
        playSound(clickSound);
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

btnOnline.addEventListener('click', () => {
    playSound(clickSound);
    isMultiplayer = true;
    welcomeView.style.display = 'none';
    lobbyView.style.display = 'flex';
});

function returnToMainMenu() {
    const wasInGame = gameView.style.display === 'flex' || gameView.style.display === 'block';
    
    const executeReturn = () => {
        isMultiplayer = false;
        lobbyView.style.display = 'none';
        gameView.style.display = 'none';
        welcomeView.style.display = 'block';
        mainMenu.style.display = 'block';
        stopTimer();
        if (gameRef) gameRef.off();
        if (privateCodeDisplay) privateCodeDisplay.classList.add('hide-element');
        findMatchBtn.disabled = false;
        findMatchBtn.textContent = 'FIND MATCH';
        lobbyStatus.textContent = 'ready to enter the arena';
    };

    if (wasInGame) {
        gamesCompleted++;
        if (gamesCompleted % 3 === 0) {
            window.adBreak({
                type: 'next',
                name: 'interstitial_ad',
                beforeAd: () => { 
                    muteGameAudio();
                    stopTimer(); 
                },
                afterAd: () => { 
                    unmuteGameAudio();
                    executeReturn(); 
                }
            });
            return;
        }
    }
    
    executeReturn();
}

btnBackMain.addEventListener('click', () => { playSound(clickSound); returnToMainMenu(); });
btnBackLobby.addEventListener('click', () => { playSound(clickSound); returnToMainMenu(); });
btnReturnMain.addEventListener('click', () => { playSound(clickSound); returnToMainMenu(); });

diffTabs.forEach(tab => tab.addEventListener('click', (e) => {
    playSound(clickSound);
    diffTabs.forEach(t => t.classList.remove('active')); 
    e.currentTarget.classList.add('active');
    
    let val = e.currentTarget.getAttribute('data-mode');
    if (!val) val = e.currentTarget.textContent;
    currentMode = val.toLowerCase().trim(); 
    
    updateHelpText();
}));

catTabs.forEach(tab => tab.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const cat = (btn.getAttribute('data-category') || btn.textContent).toLowerCase().replace(' only', '').trim();

    if (btn.classList.contains('locked') || !isModeUnlocked(cat, totalUserCP)) {
        playSound(wrongSound);
        showModeLockHint(cat);
        return;
    }

    playSound(clickSound);
    catTabs.forEach(t => t.classList.remove('active')); 
    btn.classList.add('active');
    currentCategory = cat; 
    updateHelpText();
}));

// --- career-path modal (tap the career card to see the full ladder) ---
const careerCard = document.querySelector('.career');
const careerModal = document.getElementById('career-modal');
const careerModalClose = document.getElementById('career-modal-close');

function openCareerModal() {
    playSound(clickSound);
    renderCareerLadder(totalUserCP);
    if (careerModal) careerModal.classList.remove('hide-element');
}
function closeCareerModal() {
    playSound(clickSound);
    if (careerModal) careerModal.classList.add('hide-element');
}
if (careerCard) careerCard.addEventListener('click', openCareerModal);
if (careerModalClose) careerModalClose.addEventListener('click', closeCareerModal);
if (careerModal) careerModal.addEventListener('click', (e) => { if (e.target === careerModal) closeCareerModal(); });

if (leaveGameBtn) {
    leaveGameBtn.addEventListener('click', () => {
        playSound(clickSound);
        leaveConfirmModal.classList.remove('hide-element');
    });
}

if (leaveNoBtn) {
    leaveNoBtn.addEventListener('click', () => {
        playSound(clickSound);
        leaveConfirmModal.classList.add('hide-element');
    });
}

if (leaveYesBtn) {
    leaveYesBtn.addEventListener('click', async () => {
        playSound(clickSound);
        leaveConfirmModal.classList.add('hide-element');
        if (isMultiplayer) {
            // security update: push forfeit intent to server queue
            db.ref(`games/${currentGameId}/moves_queue`).push({
                action: 'forfeit',
                uid: currentUser.uid,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            lives = 0;
            updateLivesDisplay();
            setSystemMessage(`you forfeited the game.`, true);
            triggerGameOver(false, null);
        }
    });
}

async function awardCP(extract, demo) {
    if (!currentUser) return 0;
    
    let baseCp = 1;
    if (!demo.isIntl) {
        baseCp = demo.isWomen ? 4 : 3;
    }

    const activeStart = estimateEra(extract) || 2024;

    let multiplier = 1;
    if (activeStart < 1980) multiplier = 1.5;
    else if (activeStart < 2000) multiplier = 1.3;
    else if (activeStart <= 2010) multiplier = 1.1;

    const earnedCP = parseFloat((baseCp * multiplier).toFixed(1));
    
    // security update: client no longer directly transacts cp. 
    // cloud functions handle authoritative cp distribution on the backend.
    
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

// continue the turn timer from wherever it left off (used after a no-fault
// clarification, so the player isn't handed a fresh 60s for the app's ambiguity)
function resumeTimer() {
    clearInterval(turnTimer);
    if (typeof timeLeft !== 'number' || timeLeft <= 0) { startTimer(); return; }
    timerDisplay.textContent = timeLeft;
    timerDisplay.classList.toggle('timer-danger', timeLeft <= 10);
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

function triggerGameOver(isMultiplayerDefeat = false, oppUid = null) {
    stopTimer();
    playInputGroup.classList.add('hide-element');
    gameOverPanel.classList.remove('hide-element');
    localStorage.removeItem('atlas_offline_save');

    if (!isMultiplayerDefeat && lives > 0) {
        if (reviveContainer) reviveContainer.classList.add('hide-element');
        finalizeGameOver(isMultiplayerDefeat, oppUid);
    } else if (rewardedAdsUsed < MAX_REWARDS && reviveContainer) {
        reviveContainer.classList.remove('hide-element');
        if (revivesLeftEl) revivesLeftEl.textContent = MAX_REWARDS - rewardedAdsUsed;
        reviveContainer.dataset.oppUid = oppUid || '';
        reviveContainer.dataset.isOnline = isMultiplayerDefeat;
    } else {
        if (reviveContainer) reviveContainer.classList.add('hide-element');
        finalizeGameOver(isMultiplayerDefeat, oppUid);
    }
}

async function finalizeGameOver(isOnline, oppUid) {
    if (reviveContainer) reviveContainer.classList.add('hide-element');
    if (isOnline && oppUid) {
        // security update: final state sync handled by server; ui fallback
        statusBox.textContent = "OVER";
        statusBox.style.color = "var(--loss)";
    } else if (!isOnline) {
        statusBox.textContent = "OVER";
        statusBox.style.color = "var(--loss)";
    }
}

if (rewardAdBtn) {
    rewardAdBtn.addEventListener('click', () => {
        playSound(clickSound);
        window.adBreak({
            type: 'reward',
            name: 'extra_life',
            beforeAd: () => { 
                muteGameAudio();
                stopTimer(); 
            },
            afterAd: () => {
                unmuteGameAudio();
            },
            beforeReward: (showAdFn) => { showAdFn(); },
            adDismissed: () => { 
                unmuteGameAudio();
                setSystemMessage("ad skipped. no revive.", true); 
            },
            adViewed: async () => {
                unmuteGameAudio();
                rewardedAdsUsed++;
                lives = 1;
                updateLivesDisplay();
                gameOverPanel.classList.add('hide-element');
                reviveContainer.classList.add('hide-element');
                playInputGroup.classList.remove('hide-element');
                
                const isOnline = reviveContainer.dataset.isOnline === 'true';
                
                if (isOnline) {
                    // security update: request revive via server queue
                    db.ref(`games/${currentGameId}/moves_queue`).push({
                        action: 'revive',
                        uid: currentUser.uid,
                        timestamp: firebase.database.ServerValue.TIMESTAMP
                    });
                    setSystemMessage("revive request sent to server...", false);
                    startTimer();
                } else {
                    playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
                    turnIndicator.textContent = "YOUR TURN";
                    turnIndicator.style.color = "var(--win)";
                    setSystemMessage("revived via ad! your turn.", false);
                    startTimer();
                }
            }
        });
    });
}

if (declineReviveBtn) {
    declineReviveBtn.addEventListener('click', () => {
        playSound(clickSound);
        const isOnline = reviveContainer.dataset.isOnline === 'true';
        const oppUid = reviveContainer.dataset.oppUid;
        finalizeGameOver(isOnline, oppUid);
    });
}

async function handleTimeout() {
    playSound(wrongSound);
    if (isMultiplayer) {
        // security update: push timeout event to server queue for validation
        db.ref(`games/${currentGameId}/moves_queue`).push({
            action: 'timeout',
            uid: currentUser.uid,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    } else {
        lives--;
        updateLivesDisplay();
        if (lives <= 0) {
            setSystemMessage(`time's up! out of lives.`, true);
            triggerGameOver(false, null);
        } else {
            setSystemMessage(`time's up! lost a life and your turn. cpu will play.`, true);
            playerInput.disabled = true; submitBtn.disabled = true;
            saveOfflineState();
            setTimeout(computerTurn, 1500);
        }
    }
}

const tabBtns = document.querySelectorAll('.tab-btn:not(.diff-btn):not(.cat-btn)');
const tabPanes = document.querySelectorAll('.tab-pane');

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        playSound(clickSound);
        tabBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => {
            p.classList.remove('active-pane');
            p.classList.add('hide-element');
        });
        
        btn.classList.add('active');
        
        const targetId = btn.getAttribute('data-target');
        if (targetId) {
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.remove('hide-element');
                targetPane.classList.add('active-pane');
            }
        }
    });
});

const careerTiers = [
    { name: "gully cricketer", threshold: 0 },
    { name: "school cricketer", threshold: 150 },
    { name: "school captain", threshold: 300 },
    { name: "local club cricketer", threshold: 450 },
    { name: "local club captain", threshold: 600 },
    { name: "city cricketer", threshold: 750 },
    { name: "city captain", threshold: 900 },
    { name: "district cricketer", threshold: 1200 },
    { name: "district captain", threshold: 1500 },
    { name: "state franchise cricketer", threshold: 1800 },
    { name: "state franchise captain", threshold: 2100 },
    { name: "state team cricketer", threshold: 2550 },
    { name: "state team captain", threshold: 3000 },
    { name: "zonal team cricketer", threshold: 3450 },
    { name: "zonal team captain", threshold: 3900 },
    { name: "national franchise cricketer", threshold: 4500 },
    { name: "national franchise captain", threshold: 5100 },
    { name: "international franchise cricketer", threshold: 5700 },
    { name: "international franchise captain", threshold: 6300 },
    { name: "national team player", threshold: 7500 },
    { name: "national team captain", threshold: 8700 }
];

// --- special modes gated behind career progression ---
// general is always available; these unlock at the listed career tier / CP.
const MODE_UNLOCKS = {
    women:    { threshold: 300,  tier: "school captain" },
    men:      { threshold: 600,  tier: "local club captain" },
    domestic: { threshold: 1500, tier: "district captain" },
    intl:     { threshold: 2100, tier: "state franchise captain" }
};
const MODE_LABELS = { women: "Women only", men: "Men only", domestic: "Domestic only", intl: "International only" };

function isModeUnlocked(cat, cp) {
    const req = MODE_UNLOCKS[cat];
    if (!req) return true; // general + anything ungated
    return (cp || 0) >= req.threshold;
}

function showModeLockHint(cat) {
    const req = MODE_UNLOCKS[cat];
    const help = document.getElementById('mode-help-text');
    if (!req || !help) return;
    help.style.opacity = '0';
    setTimeout(() => {
        help.innerHTML = `<span>\uD83D\uDD12 locked:</span> ${MODE_LABELS[cat]} unlocks at ${req.tier} (${req.threshold} CP).`;
        help.style.opacity = '1';
    }, 120);
}

function applyModeLocks(cp) {
    document.querySelectorAll('.cat-btn').forEach(btn => {
        const cat = (btn.getAttribute('data-category') || btn.textContent).toLowerCase().replace(' only', '').trim();
        btn.classList.toggle('locked', !isModeUnlocked(cat, cp));
    });
    // if the currently-selected category just became (or is) locked, fall back to general
    if (!isModeUnlocked(currentCategory, cp)) {
        currentCategory = 'general';
        document.querySelectorAll('.cat-btn').forEach(b =>
            b.classList.toggle('active', (b.getAttribute('data-category') || '').toLowerCase() === 'general'));
        if (typeof updateHelpText === 'function') updateHelpText();
    }
}

function renderCareerLadder(cp) {
    const ladder = document.getElementById('career-ladder');
    if (!ladder) return;

    let curIdx = 0;
    for (let i = 0; i < careerTiers.length; i++) {
        if (cp >= careerTiers[i].threshold) curIdx = i; else break;
    }

    const unlockByThreshold = {};
    Object.entries(MODE_UNLOCKS).forEach(([mode, r]) => { unlockByThreshold[r.threshold] = mode; });

    ladder.innerHTML = careerTiers.map((tier, i) => {
        const reached = cp >= tier.threshold;
        const isCurrent = i === curIdx;
        const mode = unlockByThreshold[tier.threshold];
        const badge = mode
            ? `<span class="ladder-unlock ${reached ? 'got' : ''}">${reached ? '\uD83D\uDD13' : '\uD83D\uDD12'} ${MODE_LABELS[mode]}</span>`
            : '';
        return `<div class="ladder-row ${reached ? 'reached' : 'locked'} ${isCurrent ? 'current' : ''}">
            <div class="ladder-main">
                <span class="ladder-name">${tier.name}</span>
                <span class="ladder-cp">${tier.threshold} CP</span>
            </div>${badge}
        </div>`;
    }).join('');

    const curEl = ladder.querySelector('.ladder-row.current');
    if (curEl) setTimeout(() => { try { curEl.scrollIntoView({ block: 'center' }); } catch (e) {} }, 60);
}

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

    // does the next level unlock a special mode?
    const unlockNote = document.getElementById('next-unlock-note');
    if (unlockNote) {
        const nextUnlock = nextTier
            ? Object.entries(MODE_UNLOCKS).find(([, r]) => r.threshold === nextTier.threshold)
            : null;
        if (nextUnlock) {
            unlockNote.textContent = `\uD83D\uDD13 Next level unlocks ${MODE_LABELS[nextUnlock[0]]}`;
            unlockNote.classList.remove('hide-element');
        } else {
            unlockNote.classList.add('hide-element');
        }
    }
}

function updateLivesDisplay() {
    yourLivesEl.textContent = '♥'.repeat(Math.max(0, lives)) + '♡'.repeat(Math.max(0, 3 - lives));
}

btnOffline.addEventListener('click', () => {
    playSound(clickSound);
    isMultiplayer = false;
    rewardedAdsUsed = 0;
    
    const modeMap = { 'med': 'medium', 'medium': 'medium', 'hard': 'hard', 'easy': 'easy' };
    const catMap = { 'gen': 'general', 'general': 'general', 'intl': 'international', 'international': 'international', 'dom': 'domestic', 'domestic': 'domestic', 'men': 'men', 'wmn': 'women', 'women': 'women' };

    // a locked mode can never be played — fall back to general
    if (!isModeUnlocked(currentCategory, totalUserCP)) currentCategory = 'general';

    currentMode = modeMap[(currentMode || '').toLowerCase().trim()] || 'easy';
    currentCategory = catMap[(currentCategory || '').toLowerCase().trim()] || 'general';

    welcomeView.style.display = 'none';
    gameView.style.display = 'flex';
    playInputGroup.classList.remove('hide-element');
    gameOverPanel.classList.add('hide-element');
    if (typeof reviveContainer !== 'undefined' && reviveContainer) reviveContainer.classList.add('hide-element');
    opponentNameEl.textContent = 'CPU';
    opponentLivesEl.classList.add('hide-element');
    
    const loaded = typeof loadOfflineState === 'function' ? loadOfflineState() : false;
    
    if (!loaded) {
        lives = 3; score = 0; currentLetter = ''; 
        if (typeof usedPlayers !== 'undefined') usedPlayers.clear(); 
        if (typeof chainList !== 'undefined') chainList.innerHTML = '';
        if (typeof scoreEl !== 'undefined') scoreEl.textContent = score; 
        if (typeof updateLivesDisplay === 'function') updateLivesDisplay();
    }
    
    if (typeof playerInput !== 'undefined') playerInput.value = '';
    
    // meta enrichment is optional and online-only; never let it block the start
    const metaPromise = navigator.onLine
        ? Promise.race([
            db.ref('player_meta').once('value').then(s => (s && s.val()) || {}),
            new Promise(res => setTimeout(() => res({}), 8000))
          ]).catch(() => ({}))
        : Promise.resolve({});

    loadPlayersData().then(async (data) => {
        if (!data) {
            if (typeof setSystemMessage === 'function') setSystemMessage("player database unavailable.", true);
            if (typeof turnIndicator !== 'undefined') { turnIndicator.textContent = "LOAD FAILED"; turnIndicator.style.color = "var(--loss)"; }
            if (typeof statusBox !== 'undefined') statusBox.textContent = "!";
            return;
        }

        const metaMap = await metaPromise;

        let sourceData = data.players ? data.players : data;
        let rawArray = Array.isArray(sourceData) ? sourceData : Object.values(sourceData);

        playersCatalog = rawArray.map(p => ({
            name: (p.name || '').toLowerCase().trim(),
            unique_name: (p.unique_name || p.name || '').toLowerCase().trim(),
            full_name: (p.full_name || '').toLowerCase().trim(),
            identifier: p.identifier || null,
            meta: (p.identifier && metaMap[p.identifier]) ? metaMap[p.identifier] : null
        })).filter(p => p.name);

        if (!loaded) {
            if (typeof playerInput !== 'undefined') playerInput.disabled = true; 
            if (typeof submitBtn !== 'undefined') submitBtn.disabled = true;
            if (typeof turnIndicator !== 'undefined') {
                turnIndicator.textContent = `MODE: ${currentMode}`;
                turnIndicator.style.color = "var(--text)";
            }
            if (typeof setSystemMessage === 'function') setSystemMessage("engine initialized. cpu will start.", false);
            
            setTimeout(() => {
                if (typeof computerTurn === 'function') computerTurn();
            }, 800);
        } else {
            if (typeof playerInput !== 'undefined') { playerInput.disabled = false; playerInput.focus(); }
            if (typeof submitBtn !== 'undefined') submitBtn.disabled = false; 
            if (typeof turnIndicator !== 'undefined') {
                turnIndicator.textContent = "YOUR TURN";
                turnIndicator.style.color = "var(--win)";
            }
            if (typeof setSystemMessage === 'function') setSystemMessage("match restored. your turn.", false);
            if (typeof startTimer === 'function') startTimer();
        }
    }).catch(err => {
        console.error('[engine] catalog load failed (firebase + local json):', err);
        if (typeof setSystemMessage === 'function') setSystemMessage("couldn't load the player database. connect once so it can cache for offline, then retry.", true);
        if (typeof turnIndicator !== 'undefined') { turnIndicator.textContent = "LOAD FAILED"; turnIndicator.style.color = "var(--loss)"; }
        if (typeof statusBox !== 'undefined') statusBox.textContent = "!";
    });
});

// loads the ~18k player catalog. tries firebase when online (bounded by a
// timeout), and falls back to the service-worker-cached cricket_atlas.json so
// "play offline" works with no connection at all.
async function loadPlayersData() {
    if (navigator.onLine) {
        try {
            const snap = await Promise.race([
                db.ref('players').once('value'),
                new Promise((_, rej) => setTimeout(() => rej(new Error('firebase players timed out')), 8000))
            ]);
            const val = snap && snap.val();
            if (val) return val;
            console.warn('[engine] firebase players empty; falling back to local json');
        } catch (e) {
            console.warn('[engine] firebase players unavailable; falling back to local json:', e);
        }
    }
    const resp = await fetch('./cricket_atlas.json');
    if (!resp.ok) throw new Error('local catalog fetch failed: ' + resp.status);
    return await resp.json();
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function estimateEra(extract) {
    if (!extract) return null;
    const yearRegex = /\b(18\d{2}|19\d{2}|20\d{2})\b/g;
    const years = [];
    let m;
    while ((m = yearRegex.exec(extract)) !== null) years.push(parseInt(m[1]));
    if (years.length === 0) return null;

    const bornMatch = extract.match(/born\s+(\d{1,2}\s+[a-z]+\s+)?(18\d{2}|19\d{2}|20\d{2})/i);
    const birthYear = bornMatch ? parseInt(bornMatch[2]) : null;
    const careerYears = years.filter(y => y !== birthYear && y > (birthYear || 0));

    if (careerYears.length > 0) return Math.min(...careerYears);
    if (birthYear) return birthYear + 20;
    return Math.min(...years);
}

function demoMatchesCategory(demo, cat) {
    switch (cat) {
        case 'international': return demo.isIntl === true;
        case 'domestic':      return demo.isIntl !== true;
        case 'women':         return demo.isWomen === true;
        case 'men':           return demo.isWomen !== true;
        default:              return true; 
    }
}

function metaMatchesCategory(meta, cat) {
    if (!meta) return null;
    switch (cat) {
        case 'international': return meta.intl === true;
        case 'domestic':      return meta.intl !== true;
        case 'women':         return meta.women === true;
        case 'men':           return meta.women !== true;
        default:              return true;
    }
}

function cachePlayerMeta(identifier, demo, era) {
    if (!identifier || !currentUser) return;
    try {
        // security update: push to a server-side queue instead of direct client write
        db.ref('meta_queue').push({
            identifier: identifier,
            intl: demo.isIntl === true,
            women: demo.isWomen === true,
            era: (era != null) ? era : null,
            uid: currentUser.uid,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
    } catch (e) {
        console.warn('[engine] player_meta cache failed:', e);
    }
}

function isFullBirthName(input, resolved) {
    if (!resolved) return true; 
    const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const rParts = norm(resolved).trim().split(/\s+/);
    if (rParts.length < 2) return true; 
    const inputTokens = norm(input).trim().split(/\s+/).filter(Boolean).map(t => t.replace(/\./g, ''));
    const resolvedGiven = rParts.slice(0, -1); 
    for (const g of resolvedGiven) {
        if (g.length <= 1) continue; 
        if (!inputTokens.some(t => t === g)) return false;
    }
    return true;
}

// cricket-flavoured "the engine is pondering" lines, cycled while the cpu
// resolves candidates (which can take a while — live wikipedia/cricinfo lookups).
const THINKING_LINES = [
    "consulting Wisden…",
    "checking the scorecard…",
    "studying the pitch report…",
    "reviewing the replay…",
    "calling for the third umpire…",
    "marking out a run-up…",
    "setting the field…",
    "taking guard at the crease…",
    "polishing the ball…",
    "signalling to the pavilion…",
    "adjusting the sightscreen…",
    "checking Hawk-Eye…",
    "walking back to its mark…",
    "waiting on the boundary throw…",
    "having a word with the captain…"
];

let thinkingTimer = null;

function startThinking() {
    stopThinking();
    stopVerifying();
    const lines = shuffle(THINKING_LINES);
    let i = 0;
    turnIndicator.textContent = "CPU AT THE CREASE";
    turnIndicator.style.color = "var(--accent)";
    messageEl.style.color = "var(--accent)";
    messageEl.textContent = `// ${lines[0]}`;
    thinkingTimer = setInterval(() => {
        i = (i + 1) % lines.length;
        messageEl.style.color = "var(--accent)";
        messageEl.textContent = `// ${lines[i]}`;
    }, 1500);
}

function stopThinking() {
    if (thinkingTimer) { clearInterval(thinkingTimer); thinkingTimer = null; }
}

// a separate set of lines for while a PLAYER'S move is being verified, so the
// "verifying '<name>'" state keeps moving instead of resetting to "system ready".
const VERIFY_LINES = [
    "checking the record books…",
    "counting the caps…",
    "cross-checking the averages…",
    "consulting the scorers…",
    "flipping through the almanack…",
    "checking the honours board…",
    "asking the boundary rider…",
    "reviewing the tape…",
    "scanning the team sheets…",
    "confirming with the pavilion…"
];

let verifyTimer = null;

function startVerifying(name) {
    stopVerifying();
    const lines = shuffle(VERIFY_LINES);
    let i = 0;
    messageEl.style.color = "var(--accent)";
    messageEl.textContent = `// verifying '${name}' — ${lines[0]}`;
    verifyTimer = setInterval(() => {
        i = (i + 1) % lines.length;
        messageEl.style.color = "var(--accent)";
        messageEl.textContent = `// verifying '${name}' — ${lines[i]}`;
    }, 1500);
}

function stopVerifying() {
    if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = null; }
}

// the cpu now plays against its own shot clock. if it can't produce a valid
// move inside the budget for the current difficulty, it forfeits and you win.
const CPU_TIME_BUDGET = { easy: 50, medium: 100, hard: Infinity };
let cpuCountdownTimer = null;
// the very first cpu move after a cold boot is slow (warming up network +
// wikipedia lookups), so its shot clock is not enforced. every move after is.
let cpuClockArmed = false;

function startCpuCountdown(seconds) {
    stopCpuCountdown();
    let remaining = seconds;
    timerDisplay.textContent = remaining;
    timerDisplay.classList.remove('timer-danger');
    cpuCountdownTimer = setInterval(() => {
        remaining--;
        timerDisplay.textContent = Math.max(0, remaining);
        if (remaining <= 5) timerDisplay.classList.add('timer-danger');
        if (remaining <= 0) stopCpuCountdown();
    }, 1000);
}

function stopCpuCountdown() {
    if (cpuCountdownTimer) { clearInterval(cpuCountdownTimer); cpuCountdownTimer = null; }
    timerDisplay.classList.remove('timer-danger');
}

// resolves with { __timeout: true } if the wrapped promise doesn't settle in
// time — so a single stalled network lookup can't run past the cpu's clock.
function withDeadline(promise, ms) {
    return Promise.race([
        promise,
        new Promise(resolve => setTimeout(() => resolve({ __timeout: true }), Math.max(0, ms)))
    ]);
}

async function computerTurn() {
    stopTimer();
    startThinking();
    playerInput.disabled = true; submitBtn.disabled = true;

    // cpu shot clock — not enforced on the very first move (cold-start latency)
    // or when the budget is infinite (hard mode). enforced otherwise.
    const budgetSecs = CPU_TIME_BUDGET[currentMode] || 50;
    const enforceClock = cpuClockArmed && Number.isFinite(budgetSecs);
    cpuClockArmed = true;
    const deadline = enforceClock ? Date.now() + budgetSecs * 1000 : Infinity;
    if (enforceClock) startCpuCountdown(budgetSecs);
    let timedOut = false;

    let pool = playersCatalog.filter(p =>
        !usedPlayers.has(p.full_name) && !usedPlayers.has(p.unique_name) &&
        (currentLetter === '' || p.name.charAt(0) === currentLetter || p.unique_name.charAt(0) === currentLetter)
    );

    if (currentCategory !== 'general') {
        const known   = pool.filter(p => metaMatchesCategory(p.meta, currentCategory) === true);
        const unknown = pool.filter(p => p.meta == null);
        pool = shuffle(known).concat(shuffle(unknown));
    } else {
        pool = shuffle(pool);
    }

    let selected, trueFullName, extract, finalPlayName;
    let foundValid = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 30; 

    // cap each individual lookup so one slow/hung request can't swallow the
    // whole shot clock (the old code handed the first attempt the entire budget).
    const PER_ATTEMPT_MS = 6000;
    // verify candidates a batch at a time in PARALLEL rather than one-by-one, so
    // the cpu's turn isn't (attempts x latency) long on a slow connection.
    const BATCH_SIZE = 6;

    while (pool.length > 0 && !foundValid && attempts < MAX_ATTEMPTS) {
        if (enforceClock && Date.now() >= deadline) { timedOut = true; break; }

        let perAttempt = PER_ATTEMPT_MS;
        if (enforceClock) perAttempt = Math.min(perAttempt, deadline - Date.now());

        const batch = pool.splice(0, BATCH_SIZE);
        attempts += batch.length;

        // fast=true skips the slow espncricinfo proxy fallback for the cpu
        const results = await Promise.all(batch.map(async cand => {
            const wd = await withDeadline(resolveFullName(cand.unique_name || cand.name, true), perAttempt);
            return { cand, wd };
        }));

        for (const { cand, wd } of results) {
            if (!wd || wd.__timeout || !wd.resolved) continue;
            const ex = wd.extract;

            // only play names we can actually confirm as cricketers. this skips
            // unverified resolutions that used to surface as placeholder text
            // ("...recognized in the competitive sports registry") or name pages.
            if (!ex || !/cricket|batsman|bowler|wicket-keeper|all-rounder/.test(ex.toLowerCase())) continue;

            const demo = scanDemographics(ex);
            cachePlayerMeta(cand.identifier, demo, estimateEra(ex));
            cand.meta = { intl: demo.isIntl === true, women: demo.isWomen === true };
            if (currentCategory !== 'general' && !demoMatchesCategory(demo, currentCategory)) continue;

            const formats = getNameFormats(wd.resolved, wd.isUnresolved);
            const tempPlayName = (currentMode === 'medium' || currentMode === 'hard') ? formats.full : cand.name;
            if (currentLetter !== '' && tempPlayName.charAt(0) !== currentLetter) continue;

            selected = cand;
            trueFullName = wd.resolved;
            extract = ex;
            finalPlayName = tempPlayName;
            foundValid = true;
            break;
        }
    }

    stopThinking();
    stopCpuCountdown();

    if (!foundValid) {
        turnIndicator.textContent = "VICTORY";
        turnIndicator.style.color = "var(--win)";
        const reason = timedOut
            ? `cpu ran out of time (${budgetSecs}s). you win!`
            : (currentCategory !== 'general'
                ? `cpu couldn't find a valid ${currentCategory} name. you win!`
                : "cpu exhausted options. you win!");
        setSystemMessage(reason, false);
        triggerGameOver(false, null);
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

findMatchBtn.addEventListener('click', () => {
    playSound(clickSound);
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

if (btnCreatePrivate) {
    btnCreatePrivate.addEventListener('click', () => {
        playSound(clickSound);
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
        playSound(clickSound);
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

function initOnlineEngine(gameId, initialData) {
    lobbyView.style.display = 'none'; 
    gameView.style.display = 'flex'; 
    chainList.innerHTML = '';
    playInputGroup.classList.remove('hide-element');
    gameOverPanel.classList.add('hide-element');
    if (reviveContainer) reviveContainer.classList.add('hide-element');
    playerInput.value = '';
    rewardedAdsUsed = 0;
    
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

    if (game.status === 'revive_pending') {
        stopTimer();
        if (game.turn === currentUser.uid) {
            const oppUid = amIP1 ? game.p2.uid : game.p1.uid;
            triggerGameOver(true, oppUid);
            setSystemMessage("you died. watch ad to revive?", true);
        } else {
            setSystemMessage("waiting for opponent to revive...", false);
            playerInput.disabled = true; submitBtn.disabled = true;
        }
        return;
    }

    if (game.status === 'finished') {
        stopTimer();
        isMyTurn = false;
        if (game.winner === currentUser.uid) {
            turnIndicator.textContent = "VICTORY"; turnIndicator.style.color = "var(--win)";
            statusBox.textContent = "WIN"; setSystemMessage("opponent eliminated. you win!", false);
            finalizeGameOver(true, currentUser.uid);
        } else {
            turnIndicator.textContent = "DEFEAT"; turnIndicator.style.color = "var(--loss)";
            statusBox.textContent = "LOSE"; setSystemMessage("you were eliminated.", true);
            const oppUid = amIP1 ? game.p2.uid : game.p1.uid;
            finalizeGameOver(true, oppUid);
        }
        return;
    }

    // security update: handle state recovery safely when server processes moves
    const newlyMyTurn = (game.turn === currentUser.uid);
    if(newlyMyTurn !== isMyTurn || (isMyTurn && playerInput.disabled)) {
        isMyTurn = newlyMyTurn;
        if (isMyTurn) {
            turnIndicator.textContent = "YOUR TURN"; turnIndicator.style.color = "var(--win)";
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            setSystemMessage(game.lastMessage || "awaiting input...", false);
            startTimer();
        } else {
            turnIndicator.textContent = "OPPONENT'S TURN"; turnIndicator.style.color = "var(--loss)";
            playerInput.disabled = true; submitBtn.disabled = true;
            setSystemMessage(game.lastMessage || "waiting for opponent...", false);
            stopTimer();
        }
    }
    
    statusBox.textContent = game.currentLetter ? game.currentLetter.toUpperCase() : "ANY";
    currentLetter = game.currentLetter || '';
}

bindFastTap(submitBtn, handleMoveWrapper);
playerInput.addEventListener('keypress', (e) => { 
    if (e.key === 'Enter') {
        playSound(clickSound);
        handleMoveWrapper(); 
    }
});

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
    startVerifying(inputName);

    let gameData = null;
    let isRanked = true;
    if (isMultiplayer) {
        const snap = await gameRef.once('value'); gameData = snap.val();
        isRanked = gameData.isRanked !== false;
        
        // security update: push move to queue instead of processing and verifying locally
        db.ref(`games/${currentGameId}/moves_queue`).push({
            action: 'move',
            inputName: inputName,
            uid: currentUser.uid,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        return; 
    }

    let targetSearchQuery = inputName;
    let matchedIdentifier = null;
    const inputParts = inputName.split(/\s+/);
    const isInitialInput = inputParts.length >= 2 && inputParts[0].replace(/\./g, '').length === 1;
    
    if (currentMode === 'easy') {
        const matchedCatalogPlayers = playersCatalog.filter(p => {
            const pName = p.unique_name || p.name;
            if (pName === inputName || p.full_name === inputName) return true;
            
           const catParts = pName.split(/\s+/);
            if (catParts.length >= 2 && inputParts.length >= 2) {
                const inputGiven = inputParts.slice(0, -1).join(' ').replace(/\./g, '');
                const inputSurname = inputParts[inputParts.length - 1];
                const catGiven = catParts.slice(0, -1).join(' ');
                const catSurname = catParts[catParts.length - 1];
                
                if (catSurname === inputSurname && catGiven.startsWith(inputGiven)) {
                    if (isMultiplayer && gameData?.usedPlayers?.[pName]) return false;
                    if (!isMultiplayer && usedPlayers.has(pName)) return false;
                    return true;
                }
            }
            return false;
        });

        if (matchedCatalogPlayers.length > 1) {
            const exactMatch = matchedCatalogPlayers.find(p => (p.unique_name || p.name) === inputName || p.full_name === inputName);
            if (exactMatch) {
                targetSearchQuery = exactMatch.unique_name || exactMatch.name;
                matchedIdentifier = exactMatch.identifier || null;
            } else {
                const surname = inputName.split(/\s+/).pop();
                askToClarify(`several players match '${inputName}'. spell out the first name (e.g. a full given name + ${surname}) and play on.`);
                return;
            }
        } else if (matchedCatalogPlayers.length === 1) {
            targetSearchQuery = matchedCatalogPlayers[0].unique_name || matchedCatalogPlayers[0].name;
            matchedIdentifier = matchedCatalogPlayers[0].identifier || null;
        }
    } else {
        if (currentMode !== 'easy' && (inputParts.length < 2 || inputParts[0].length === 1)) {
            askToClarify(`${currentMode} mode needs the full first name — spell out the given name and try again (no life lost).`);
            return;
        }
    }

    const wikiData = await resolveFullName(targetSearchQuery);
    const trueFullName = wikiData.resolved;
    const extract = wikiData.extract;

    if (!isMultiplayer && usedPlayers.has(trueFullName)) { punishLogic(`${trueFullName.toUpperCase()} already used.`); return; }
    if (isMultiplayer && gameData && gameData.usedPlayers && gameData.usedPlayers[trueFullName]) { punishLogic(`${trueFullName.toUpperCase()} already used.`); return; }
    if (!extract || !extract.toLowerCase().includes("cricket")) {
        if (!isMultiplayer && currentMode === 'easy' && isInitialInput) {
            askToClarify(`couldn't pin down '${inputName}' from just the initial — type the full first name (e.g. the given name spelled out + ${inputParts[inputParts.length - 1]}).`);
            return;
        }
        punishLogic(`could not verify '${inputName}' as a cricketer.`);
        return;
    }

    const demo = scanDemographics(extract);

    if (!isMultiplayer) {
        if (currentCategory !== 'general' && !demoMatchesCategory(demo, currentCategory)) {
            punishLogic(`'${inputName}' doesn't qualify for the ${currentCategory} category.`);
            return;
        }
        if (currentMode === 'hard' && !isFullBirthName(inputName, trueFullName)) {
            punishLogic(`hard mode: type the complete name — all given names spelled out.`);
            return;
        }
    }

    if (!matchedIdentifier) {
        const found = playersCatalog.find(p =>
            (p.unique_name || p.name) === targetSearchQuery || p.name === inputName);
        matchedIdentifier = found ? found.identifier : null;
    }
    cachePlayerMeta(matchedIdentifier, demo, estimateEra(extract));

    stopVerifying();
    playSound(correctSound);
    
    const earnedCP = isRanked ? await awardCP(extract, demo) : 0;

    if (!isMultiplayer) {
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
    playSound(wrongSound);
    if (!isMultiplayer) {
        lives--;
        updateLivesDisplay();
        if (lives <= 0) {
            statusBox.textContent = "OVER"; statusBox.style.color = "var(--loss)";
            setSystemMessage(`// ${reason} out of lives.`, true);
            triggerGameOver(false, null);
        } else {
            setSystemMessage(`strike! ${reason}`, true);
            playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
            saveOfflineState();
            startTimer(); 
        }
    }
}

// non-penalizing re-prompt: used in easy mode when the input is merely
// under-specified (e.g. "a sharma" matches several players). no life is lost
// and the turn is not forfeited — the player just clarifies and plays on.
function askToClarify(reason) {
    playSound(clickSound);
    setSystemMessage(reason, false);
    playerInput.disabled = false; submitBtn.disabled = false; playerInput.focus();
    resumeTimer();
}

function renderFeedItem(displayName, extract, isMe, cpEarned) {
    const div = document.createElement('div');
    div.className = `feed-item ${isMe ? 'player' : (isMultiplayer ? 'opponent' : 'cpu')}`;
    
    const demo = scanDemographics(extract);
    const summaryText = extract ? extract.split('\n')[0] : `${displayName.toUpperCase()} is a professional cricketer recognized in the competitive sports registry.`;
    const badgeLabel = demo.isIntl ? '<span class="badge intl">intl</span>'
        : (demo.isDomestic ? '<span class="badge">domestic</span>'
        : '<span class="badge">cricketer</span>');
    const summaryHtml = `<div class="player-badges">${badgeLabel}</div><div class="player-summary">${summaryText}</div>`;
    
    let cpText = isMe && cpEarned > 0 ? `<div class="feed-earned-cp">+${cpEarned} CP</div>` : `<div></div>`;

    div.innerHTML = `<div class="feed-header"><div class="feed-meta"><span>${isMe ? 'you' : (isMultiplayer ? 'opponent' : 'cpu')}</span>${cpText}</div><div class="feed-name">${displayName.toUpperCase()}</div></div><div class="feed-details">${summaryHtml}</div>`;
    chainList.prepend(div);
    while (chainList.children.length > 2) chainList.removeChild(chainList.lastChild);
}

function setSystemMessage(msg, isError = true) {
    stopVerifying();
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
    if (!extract) return { isIntl: false, isWomen: false, isMen: false, isDomestic: false };
    const l = extract.toLowerCase();

    // International signals. Phrase-based and word-bounded to avoid the old
    // false positives: "represented Assam" / "Ranji squad" (domestic) and
    // "Odisha" (which literally contains "odi").
    const isIntl =
        l.includes('international') ||
        l.includes('test match') ||
        l.includes('test cricketer') ||
        l.includes('test debut') ||
        l.includes('one day international') ||
        l.includes('twenty20 international') ||
        l.includes('national cricket team') ||
        l.includes('national team') ||
        l.includes('world cup') ||
        l.includes('champions trophy') ||
        l.includes('asia cup') ||
        l.includes('icc ') ||
        /\bodis?\b/.test(l) ||
        /\bt20is?\b/.test(l) ||
        /\btests?\b/.test(l);

    // Positive domestic evidence — only meaningful when NOT international, since
    // international players play these competitions too. Lets the badge say
    // "domestic" from real evidence instead of merely "no intl keyword found".
    const domesticPhrases = ['first-class', 'list a', 'ranji', 'vijay hazare',
        'syed mushtaq ali', 'duleep', 'deodhar', 'county championship',
        'sheffield shield', 'plunket shield', 'domestic cricket', 'big bash', 'super smash'];
    const isDomestic = !isIntl && domesticPhrases.some(p => l.includes(p));

    const isWomen = /\b(she|her)\b/i.test(l) || l.includes("women's") || l.includes("women\u2019s");
    const isMen = /\b(he|his)\b/i.test(l) || l.includes("men's");

    return { isIntl, isWomen, isMen, isDomestic };
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

const topExitBtn = document.getElementById('exit-game-btn');

if (topExitBtn) {
    topExitBtn.addEventListener('click', () => {
        playSound(clickSound);
        if (isMultiplayer && gameRef && currentUser) {
            // security update: push exit/forfeit intent to server queue
            db.ref(`games/${currentGameId}/moves_queue`).push({
                action: 'forfeit',
                uid: currentUser.uid,
                timestamp: firebase.database.ServerValue.TIMESTAMP
            });
        } else {
            localStorage.removeItem('atlas_offline_save');
        }
        
        returnToMainMenu();
    });
}

async function resolveFullName(queryName, fast = false) {
    const fetchWiki = async (q) => (await fetch(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrsearch=${q}&gsrlimit=10&prop=extracts&exintro=1&explaintext=1`)).json();
    
    const queryNameLower = queryName.trim().toLowerCase();
    const queryParts = queryNameLower.split(/\s+/);
    const querySurname = queryParts[queryParts.length - 1];
    const queryGiven = queryParts.slice(0, -1).join(' ').replace(/\./g, '');

    try {
        let searchString1 = `intitle:"${queryName}" cricketer`;
        let searchString2 = `${queryName} cricketer`;
        
        if (currentMode === 'easy' && queryParts.length >= 2 && queryGiven.length <= 2) {
            searchString1 = `intitle:"${querySurname}" cricketer`;
            searchString2 = `${querySurname} cricketer`;
        }

        let data = await fetchWiki(encodeURIComponent(searchString1));
        let pages = data.query && data.query.pages ? Object.values(data.query.pages) : [];
        if (pages.length === 0) { 
            data = await fetchWiki(encodeURIComponent(searchString2)); 
            pages = data.query && data.query.pages ? Object.values(data.query.pages) : []; 
        }

        // Object.values orders by pageid, not search relevance — restore the
        // generator's ranking so the most prominent cricketer (e.g. Ajinkya
        // Rahane for "a rahane") is considered first instead of an arbitrary one.
        pages.sort((a, b) => (a.index || 0) - (b.index || 0));
        
        // strips accents AND punctuation (apostrophes/hyphens/dots) so
        // "d'arcy" matches "darcy", "o'brien" matches "obrien", etc.
        const normName = s => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019.\-]/g, "").toLowerCase();
        // collapses a whole name to bare alphanumerics (drops spaces, hyphens,
        // particles) so "Naveen-ul-Haq" == "naveen ul haq", "Jean-Paul" == "jean paul".
        const normFull = s => (s || '').normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const queryFull = normFull(queryName);

        for (let pageData of pages) {
            const titleLower = pageData.title.toLowerCase();
            if (titleLower.includes("(disambiguation)") || titleLower.includes("(name)") || titleLower.includes("(surname)")) continue;

            const extract = pageData.extract || "";
            const extractLower = extract.toLowerCase();

            // Skip disambiguation and name/surname articles — even when their
            // "Notable people" list mentions cricket (e.g. "Tsotsobe is a South
            // African Xhosa surname. Notable people with the surname include:").
            if (extractLower.includes("may refer to") ||
                extractLower.includes("is a disambiguation page") ||
                /\bis a[n]? [\w\s'-]*?(given name|surname|family name|unisex name)\b/.test(extractLower) ||
                extractLower.includes("people with the surname") ||
                extractLower.includes("people with this name") ||
                extractLower.includes("people with the name")) continue;

            const hasCricketKeywords = extractLower.includes("cricket") || extractLower.includes("batsman") || extractLower.includes("bowler") || extractLower.includes("wicket-keeper") || extractLower.includes("all-rounder");
            if (!hasCricketKeywords) continue;

            const title = pageData.title.replace(/\s*\(.*\)/, '').trim().toLowerCase();
            const titleParts = title.split(/\s+/);
            const titleSurname = titleParts[titleParts.length - 1];
            const titleGiven = titleParts.slice(0, -1).join(' ');

            const normTitleSurname = normName(titleSurname);
            const normQuerySurname = normName(querySurname);
            const normTitleGiven = normName(titleGiven);
            const normQueryGiven = normName(queryGiven);
            const titleFull = normFull(title);

            // (a) full-name match ignoring spaces/hyphens (handles particle names
            //     like Naveen-ul-Haq, and full names like "Naveen-ul-Haq Murid").
            const fullMatch = titleFull === queryFull || (queryFull.length >= 8 && titleFull.startsWith(queryFull));
            // (b) surname + given-initial match. requires a non-empty given name so
            //     bare single-token pages (surname articles) can't match on "".
            const surnameGivenMatch = normTitleSurname === normQuerySurname && normTitleGiven !== '' &&
                (normTitleGiven.startsWith(normQueryGiven) || normQueryGiven.startsWith(normTitleGiven));

            if (fullMatch || surnameGivenMatch) {
                const match = extract.split(/[.!?]/)[0].match(/^([^\(\,]+)(?:\(|\,)/);
                return { resolved: match ? match[1].trim().toLowerCase() : title, extract: extract, isUnresolved: false };
            }
        }

        // the espncricinfo proxy (via allorigins) is slow and can hang; skip it
        // in fast mode so the cpu's per-attempt budget isn't wasted on it.
        if (!fast) try {
            const ciSearchUrl = `https://search.espncricinfo.com/ci/content/site/search.html?search=${encodeURIComponent(queryName)}&type=player`;
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(ciSearchUrl)}`;
            
            // bound the flaky public proxy: abort after 5s so it fails fast
            // instead of hanging the human verification path.
            const ciController = new AbortController();
            const ciTimer = setTimeout(() => ciController.abort(), 5000);
            let ciResponse;
            try {
                ciResponse = await fetch(proxyUrl, { signal: ciController.signal });
            } finally {
                clearTimeout(ciTimer);
            }
            if (ciResponse.ok) {
                const ciData = await ciResponse.json();
                const htmlText = ciData.contents.toLowerCase();
                
                if (htmlText.includes("player-style") || htmlText.includes("class=\"player-name\"")) {
                    console.log(`[engine] ${queryName} verified via espncricinfo fallback.`);
                    const syntheticExtract = `${queryName} is a verified cricketer verified via the espncricinfo database fallback.`;
                    return { resolved: queryNameLower, extract: syntheticExtract, isUnresolved: false };
                }
            }
        } catch (ciErr) {
            console.warn("[engine] cricinfo fallback ping failed:", ciErr);
        }

    } catch (e) { 
        console.error("[engine] wiki fetch error:", e); 
    }
    
    return { resolved: queryNameLower, extract: null, isUnresolved: true };
}

// initial mode-lock state — runs after all const definitions are initialized,
// so it can't hit the temporal-dead-zone. Firebase CP re-applies on load.
try { applyModeLocks(totalUserCP); } catch (e) { console.warn('[engine] initial lock apply failed:', e); }
