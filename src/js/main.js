import { CricketAtlas } from './core-game.js';

const container = document.getElementById('game-container');
container.innerHTML = `
  <div style="padding: 20px; color: white; font-family: sans-serif; text-align: center;">
    <h1>cricket atlas</h1>
    <h2 id="score-display">score: 0</h2>
    <h3 id="letter-display">start with any player!</h3>
    <input type="text" id="guess-input" placeholder="enter player name..." style="padding: 10px; font-size: 16px; width: 80%; max-width: 300px; border-radius: 5px; border: none; outline: none; color: black;">
    <br><br>
    <button id="submit-btn" style="padding: 10px 20px; font-size: 16px; background-color: #10b981; color: white; border: none; border-radius: 5px; cursor: pointer;">play turn</button>
    <p id="message-display" style="margin-top: 20px; font-size: 18px;"></p>
  </div>
`;

let game;
const scoreDisplay = document.getElementById('score-display');
const letterDisplay = document.getElementById('letter-display');
const inputField = document.getElementById('guess-input');
const submitBtn = document.getElementById('submit-btn');
const messageDisplay = document.getElementById('message-display');

async function initGame() {
  try {
    messageDisplay.innerText = "loading 19k players...";
    const response = await fetch('./cricket_atlas.json');
    const data = await response.json();
    game = new CricketAtlas(data);
    messageDisplay.innerText = "ready! enter your first player.";
  } catch (err) {
    messageDisplay.innerText = "error loading data! did you upload cricket_atlas.json?";
  }
}

function handleGuess() {
  if (!game) return;
  const guess = inputField.value;
  
  const result = game.validateGuess(guess);
  if (!result.valid) {
    messageDisplay.innerText = "❌ " + result.reason;
    return;
  }

  game.playTurn(result.player);
  inputField.value = "";
  updateUI();
  messageDisplay.innerText = `✅ correct! ai is thinking...`;
  
  setTimeout(() => {
    let candidates = game.db.filter(p => 
      p.name.toLowerCase().startsWith(game.currentLetter) && 
      !game.usedPlayers.has(p.identifier)
    );
    if (candidates.length === 0) {
       messageDisplay.innerText = "🏆 ai ran out of names! you win!";
       return;
    }
    const aiChoice = candidates[Math.floor(Math.random() * candidates.length)];
    game.playTurn(aiChoice);
    updateUI();
    messageDisplay.innerText = `🤖 ai played: ${aiChoice.name}`;
  }, 1000);
}

function updateUI() {
  scoreDisplay.innerText = `score: ${game.score}`;
  letterDisplay.innerText = `next player must start with: "${game.currentLetter.toUpperCase()}"`;
}

submitBtn.addEventListener('click', handleGuess);
inputField.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleGuess();
});

initGame();
