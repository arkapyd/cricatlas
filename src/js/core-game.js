export class CricketAtlas {
  constructor(playerDatabase) {
    this.db = playerDatabase;
    this.usedPlayers = new Set();
    this.currentLetter = "";
    this.score = 0;
  }

  getLastLetter(name) {
    const clean = name.toLowerCase().replace(/[^a-z]/g, "");
    return clean[clean.length - 1];
  }

  validateGuess(guessName) {
    const cleanGuess = guessName.trim().toLowerCase();
    const player = this.db.find(p => p.name.toLowerCase() === cleanGuess);
    
    if (!player) return { valid: false, reason: "not in database" };
    if (this.usedPlayers.has(player.identifier)) return { valid: false, reason: "already used" };
    if (this.currentLetter && !player.name.toLowerCase().startsWith(this.currentLetter)) {
      return { valid: false, reason: `must start with ${this.currentLetter.toUpperCase()}` };
    }
    return { valid: true, player };
  }

  playTurn(player) {
    this.usedPlayers.add(player.identifier);
    this.currentLetter = this.getLastLetter(player.name);
    this.score += 10;
    return this.currentLetter;
  }
}
