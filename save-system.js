// save-system.js
const SAVE_KEY = "cricket_atlas_save";

export function saveGame(careerData) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(careerData));
}

export function loadGame() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) {
    return {
      level: 1,
      xp: 0,
      coins: 100,
      unlockedBadges: [],
      highScore: 0
    };
  }
  return JSON.parse(saved);
}
