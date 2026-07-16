// core-game.js
class CricketAtlas {
  constructor(playerDatabase) {
    this.db = playerDatabase; // array of player objects from your merged json
    this.usedPlayers = new Set();
    this.currentLetter = "";
    this.score = 0;
    this.difficulty = "medium"; // easy, medium, hard
    this.powerups = { drs: 1, freeHit: 1 };
  }

  // extract the last valid letter of a display name (ignoring spaces/dots/hyphens)
  getLastLetter(name) {
    const clean = name.toLowerCase().replace(/[^a-z]/g, "");
    return clean[clean.length - 1];
  }

  // check if a player's guess is valid
  validateGuess(guessName) {
    const cleanGuess = guessName.trim().toLowerCase();
    
    // 1. find player in database
    const player = this.db.find(p => p.name.toLowerCase() === cleanGuess);
    if (!player) return { valid: false, reason: "not in database" };

    // 2. check if already used
    if (this.usedPlayers.has(player.identifier)) {
      return { valid: false, reason: "player already used" };
    }

    // 3. check starting letter (if not the first turn)
    if (this.currentLetter && player.name.toLowerCase().startsWith(this.currentLetter) === false) {
      return { valid: false, reason: `must start with "${this.currentLetter.toUpperCase()}"` };
    }

    return { valid: true, player };
  }

  // commit the player's turn and update game state
  playTurn(player) {
    this.usedPlayers.add(player.identifier);
    this.currentLetter = this.getLastLetter(player.name);
    this.score += 10; // base points
    return this.currentLetter;
  }

  // simulated AI opponent turn
  playAITurn() {
    // filter database for unused players starting with the current letter
    let candidates = this.db.filter(p => 
      p.name.toLowerCase().startsWith(this.currentLetter) && 
      !this.usedPlayers.has(p.identifier)
    );

    if (candidates.length === 0) {
      return { lost: true, reason: "ai ran out of players! you win!" };
    }

    // filter candidates based on difficulty to make the AI feel human
    // easy AI only knows famous players (has cricinfo key), hard AI knows obscure domestic ones
    if (this.difficulty === "easy") {
      candidates = candidates.filter(p => p.key_cricinfo);
    }

    // pick a random candidate
    const aiChoice = candidates[Math.floor(Math.random() * candidates.length)];
    this.usedPlayers.add(aiChoice.identifier);
    this.currentLetter = this.getLastLetter(aiChoice.name);

    return { lost: false, player: aiChoice, nextLetter: this.currentLetter };
  }
}
