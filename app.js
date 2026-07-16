// pwa setup
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(() => console.log('service worker registered'))
        .catch(err => console.log('service worker failed', err));
}

// game state
let playersDb = [];
let usedPlayers = new Set();
let currentLetter = '';
let score = 0;

// ui elements
const statusBox = document.getElementById('game-status');
const playerInput = document.getElementById('player-input');
const submitBtn = document.getElementById('submit-btn');
const messageEl = document.getElementById('message');
const chainList = document.getElementById('chain-list');
const scoreEl = document.getElementById('score');

// load database
// expects cricket_atlas.json to be an array of strings: ["sachin tendulkar", "virat kohli", ...]
fetch('cricket_atlas.json')
    .then(response => response.json())
    .then(data => {
        playersDb = data.map(name => name.toLowerCase().trim());
        startGame();
    })
    .catch(err => {
        statusBox.textContent = "error loading players data.";
        console.error(err);
    });

function startGame() {
    playerInput.disabled = false;
    submitBtn.disabled = false;
    
    // computer makes the first move
    computerTurn();
}

function getFirstLetter(name) {
    return name.charAt(0);
}

function getLastLetterOfSurname(name) {
    const parts = name.split(' ');
    const surname = parts[parts.length - 1];
    return surname.charAt(surname.length - 1);
}

function addMessage(msg, isError = true) {
    messageEl.style.color = isError ? '#d32f2f' : '#2e7d32';
    messageEl.textContent = msg;
    setTimeout(() => messageEl.textContent = '', 3000);
}

function addToChain(name, isPlayer) {
    usedPlayers.add(name);
    currentLetter = getLastLetterOfSurname(name);
    
    const li = document.createElement('li');
    li.innerHTML = `<span class="player-type">${isPlayer ? 'you' : 'cpu'}</span> ${name}`;
    chainList.prepend(li); // add to top of list
    
    statusBox.innerHTML = `name a player starting with <span>'${currentLetter.toUpperCase()}'</span>`;
}

function computerTurn() {
    const validPlayers = playersDb.filter(p => 
        !usedPlayers.has(p) && 
        (currentLetter === '' || getFirstLetter(p) === currentLetter)
    );

    if (validPlayers.length === 0) {
        statusBox.textContent = "cpu ran out of players! you win!";
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
        addMessage(`name must start with '${currentLetter.toUpperCase()}'`);
        return;
    }

    if (!playersDb.includes(inputName)) {
        addMessage("player not found in database.");
        return;
    }

    if (usedPlayers.has(inputName)) {
        addMessage("player already used in this chain.");
        return;
    }

    // player move is valid
    addToChain(inputName, true);
    score++;
    scoreEl.textContent = score;

    // trigger cpu turn after a small delay for realism
    setTimeout(computerTurn, 800);
}

submitBtn.addEventListener('click', handlePlayerTurn);
playerInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handlePlayerTurn();
});
