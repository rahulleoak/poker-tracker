export const STORAGE_KEY = 'poker_tracker_games_v1';

/**
 * Loads games array from localStorage.
 * 
 * @param {Storage} [storage=window?.localStorage] 
 * @returns {Array<Object>} Array of game objects.
 */
export function loadGamesFromStorage(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.error("Failed to load games from localStorage:", err);
  }
  return [];
}

/**
 * Saves games array to localStorage.
 * 
 * @param {Array<Object>} games 
 * @param {Storage} [storage=window?.localStorage] 
 */
export function saveGamesToStorage(games, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Array.isArray(games) ? games : []));
  } catch (err) {
    console.error("Failed to save games to localStorage:", err);
  }
}

/**
 * Merges remote games (from Supabase) and local games (from localStorage) gracefully.
 * Remote games take precedence for matching IDs, while local-only (offline/un-synced) games are preserved.
 * 
 * @param {Array<Object>} [remoteGames=[]] 
 * @param {Array<Object>} [localGames=[]] 
 * @returns {Array<Object>} Merged array of games sorted by date descending.
 */
export function mergeRemoteAndLocalGames(remoteGames = [], localGames = []) {
  const remoteArr = Array.isArray(remoteGames) ? remoteGames.filter(Boolean) : [];
  const localArr = Array.isArray(localGames) ? localGames.filter(Boolean) : [];

  const remoteMap = new Map(remoteArr.map(g => [g.id, g]));
  const localMap = new Map(localArr.map(g => [g.id, g]));

  // Build a set of remote fingerprints for deduplication (date + pokerNowUrl)
  const remoteFingerprints = new Set(
    remoteArr
      .filter(g => g && g.date && g.pokerNowUrl)
      .map(g => `${g.date}_${g.pokerNowUrl}`)
  );

  const merged = [];

  // Add all remote games
  for (const remoteGame of remoteMap.values()) {
    merged.push(remoteGame);
  }

  // Add any local games not present in remote by ID or fingerprint
  for (const [id, localGame] of localMap) {
    if (remoteMap.has(id)) continue;

    const localFingerprint = (localGame?.date && localGame?.pokerNowUrl)
      ? `${localGame.date}_${localGame.pokerNowUrl}`
      : null;

    if (localFingerprint && remoteFingerprints.has(localFingerprint)) {
      continue;
    }

    merged.push(localGame);
  }

  // Sort by date descending (newest first)
  return merged.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}
