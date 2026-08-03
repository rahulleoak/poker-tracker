/**
 * Maps raw database session rows (with legacy or new ledger schemas) to app game models.
 * Handles missing fields, null ledger arrays, and pre-flop statistics columns seamlessly.
 * 
 * @param {Array<Object>} dbSessions - Raw sessions data returned from Supabase query.
 * @returns {Array<Object>} Formatted game objects.
 */
export function mapDatabaseSessionsToGames(dbSessions) {
  if (!Array.isArray(dbSessions)) return [];

  return dbSessions.map(session => {
    if (!session) return null;

    const ledgerEntries = Array.isArray(session.ledger) ? session.ledger : [];

    return {
      id: session.id || `session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      date: session.date || new Date().toISOString().split('T')[0],
      currency: session.currency || 'USD',
      chipValue: Number(session.chip_value) || 1,
      pokerNowUrl: session.poker_now_url || '',
      isActive: session.is_active !== false,
      entries: ledgerEntries.map(entry => {
        if (!entry) return null;
        return {
          name: (entry.player_name || '').trim() || 'Unknown',
          externalId: (entry.external_player_id || entry.player_external_id || entry.player_poker_now_id || '').trim() || null,
          pokerNowId: (entry.player_poker_now_id || entry.external_player_id || entry.player_external_id || '').trim() || null,
          buyIn: Number(entry.buy_in) || 0,
          buyOut: 0,
          stack: Number(entry.cash_out) || 0,
          currency: entry.currency || session.currency || 'USD',
          isBank: Boolean(entry.is_bank),
          handsPlayed: Number(entry.hands_played) || 0,
          vpipHands: Number(entry.vpip_hands) || 0,
          pfrHands: Number(entry.pfr_hands) || 0,
          threeBetOpps: Number(entry.three_bet_opps) || 0,
          threeBetHands: Number(entry.three_bet_hands) || 0
        };
      }).filter(Boolean)
    };
  }).filter(Boolean);
}

/**
 * Creates a default manual game model with fallback fields.
 * 
 * @param {string} [currency='USD'] 
 * @param {string} [id] 
 * @returns {Object} Game object.
 */
export function createDefaultGame(currency = 'USD', id) {
  const sessionDate = new Date().toISOString().split('T')[0];
  const sessionId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`);

  return {
    id: sessionId,
    date: sessionDate,
    currency: currency || 'USD',
    chipValue: 1,
    pokerNowUrl: '',
    isActive: true,
    entries: [
      { name: 'Player 1', buyIn: 0, buyOut: 0, stack: 0, currency: currency || 'USD', isBank: false, handsPlayed: 0, vpipHands: 0, pfrHands: 0, threeBetOpps: 0, threeBetHands: 0 },
      { name: 'Player 2', buyIn: 0, buyOut: 0, stack: 0, currency: currency || 'USD', isBank: false, handsPlayed: 0, vpipHands: 0, pfrHands: 0, threeBetOpps: 0, threeBetHands: 0 }
    ]
  };
}

/**
 * Converts parsed CSV player entries into a standard game object.
 * 
 * @param {Array<Object>} parsedEntries 
 * @param {string} [currency='USD'] 
 * @param {string} [date] 
 * @param {string} [id] 
 * @returns {Object} Game object.
 */
export function createGameFromCSVEntries(parsedEntries = [], currency = 'USD', date, id) {
  const sessionDate = date || new Date().toISOString().split('T')[0];
  const sessionId = id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`);

  const rawEntries = Array.isArray(parsedEntries) && parsedEntries.length > 0 
    ? parsedEntries 
    : [
        { name: 'Player 1', buyIn: 0, buyOut: 0, stack: 0 },
        { name: 'Player 2', buyIn: 0, buyOut: 0, stack: 0 }
      ];

  const formattedEntries = rawEntries.map(entry => ({
    name: ((entry && entry.name) || '').trim() || 'Unknown',
    externalId: (entry?.externalId || entry?.pokerNowId || entry?.playerExternalId || '').trim() || null,
    pokerNowId: (entry?.pokerNowId || entry?.externalId || '').trim() || null,
    buyIn: Number(entry?.buyIn) || 0,
    buyOut: Number(entry?.buyOut) || 0,
    stack: Number(entry?.stack) || 0,
    currency: currency || 'USD',
    isBank: false,
    handsPlayed: Number(entry?.handsPlayed) || 0,
    vpipHands: Number(entry?.vpipHands) || 0,
    pfrHands: Number(entry?.pfrHands) || 0,
    threeBetOpps: Number(entry?.threeBetOpps) || 0,
    threeBetHands: Number(entry?.threeBetHands) || 0
  }));

  return {
    id: sessionId,
    date: sessionDate,
    currency: currency || 'USD',
    chipValue: 1,
    pokerNowUrl: '',
    isActive: false,
    entries: formattedEntries
  };
}

/**
 * Extracts a PokerNow URL from raw text or log content.
 * 
 * @param {string} text 
 * @returns {string} PokerNow URL or empty string.
 */
export function extractPokerNowUrl(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/https?:\/\/(?:www\.)?pokernow\.club\/games\/[a-zA-Z0-9_-]+/i);
  return match ? match[0] : '';
}

/**
 * Checks if an existing session matches a new game by poker_now_url or date.
 * 
 * @param {Array<Object>} existingGames 
 * @param {Object} newGame 
 * @returns {Object|null} Matching game object or null.
 */
export function findMatchingSession(existingGames, newGame) {
  if (!Array.isArray(existingGames) || !newGame) return null;

  const newUrl = (newGame.pokerNowUrl || '').trim().toLowerCase();
  if (newUrl) {
    const urlMatch = existingGames.find(g => g && (g.pokerNowUrl || '').trim().toLowerCase() === newUrl);
    if (urlMatch) return urlMatch;
  }

  const newDate = (newGame.date || '').trim();
  if (newDate) {
    const dateMatch = existingGames.find(g => g && (g.date || '').trim() === newDate);
    if (dateMatch) return dateMatch;
  }

  return null;
}

/**
 * Incrementally merges new player entries into existing session entries.
 * Accumulates buy-ins, buy-outs, stacks, and hand stats for matching player names / external IDs
 * without wiping custom manual edits.
 * 
 * @param {Array<Object>} existingEntries 
 * @param {Array<Object>} newEntries 
 * @returns {Array<Object>} Merged entries array.
 */
export function mergeSessionEntries(existingEntries = [], newEntries = []) {
  const safeExisting = Array.isArray(existingEntries) ? existingEntries : [];
  const safeNew = Array.isArray(newEntries) ? newEntries : [];

  const mergedMap = new Map();
  const consumedNewIndices = new Set();

  const getPlayerKey = (entry) => {
    const extId = (entry?.externalId || entry?.pokerNowId || '').trim();
    if (extId) return `ext:${extId.toLowerCase()}`;
    const name = (entry?.name || '').trim().toLowerCase();
    return `name:${name}`;
  };

  for (const existing of safeExisting) {
    if (!existing) continue;
    const key = getPlayerKey(existing);
    
    let matchedNewIndex = -1;
    let matchedNew = null;

    for (let i = 0; i < safeNew.length; i++) {
      if (consumedNewIndices.has(i)) continue;
      const incoming = safeNew[i];
      if (!incoming) continue;

      const incomingKey = getPlayerKey(incoming);
      const nameMatch = (existing.name || '').trim().toLowerCase() === (incoming.name || '').trim().toLowerCase();
      const extMatch = (existing.externalId && incoming.externalId && existing.externalId === incoming.externalId) ||
                       (existing.pokerNowId && incoming.pokerNowId && existing.pokerNowId === incoming.pokerNowId);

      if (extMatch || nameMatch || key === incomingKey) {
        matchedNewIndex = i;
        matchedNew = incoming;
        break;
      }
    }

    if (matchedNew) {
      consumedNewIndices.add(matchedNewIndex);
      mergedMap.set(key, {
        ...existing,
        externalId: existing.externalId || matchedNew.externalId || null,
        pokerNowId: existing.pokerNowId || matchedNew.pokerNowId || null,
        buyIn: (Number(existing.buyIn) || 0) + (Number(matchedNew.buyIn) || 0),
        buyOut: (Number(existing.buyOut) || 0) + (Number(matchedNew.buyOut) || 0),
        stack: (Number(existing.stack) || 0) + (Number(matchedNew.stack) || 0),
        handsPlayed: (Number(existing.handsPlayed) || 0) + (Number(matchedNew.handsPlayed) || 0),
        vpipHands: (Number(existing.vpipHands) || 0) + (Number(matchedNew.vpipHands) || 0),
        pfrHands: (Number(existing.pfrHands) || 0) + (Number(matchedNew.pfrHands) || 0),
        threeBetOpps: (Number(existing.threeBetOpps) || 0) + (Number(matchedNew.threeBetOpps) || 0),
        threeBetHands: (Number(existing.threeBetHands) || 0) + (Number(matchedNew.threeBetHands) || 0)
      });
    } else {
      mergedMap.set(key, { ...existing });
    }
  }

  for (let i = 0; i < safeNew.length; i++) {
    if (consumedNewIndices.has(i)) continue;
    const incoming = safeNew[i];
    if (!incoming) continue;
    const key = getPlayerKey(incoming);
    if (!mergedMap.has(key)) {
      mergedMap.set(key, { ...incoming });
    } else {
      const existing = mergedMap.get(key);
      mergedMap.set(key, {
        ...existing,
        buyIn: (Number(existing.buyIn) || 0) + (Number(incoming.buyIn) || 0),
        buyOut: (Number(existing.buyOut) || 0) + (Number(incoming.buyOut) || 0),
        stack: (Number(existing.stack) || 0) + (Number(incoming.stack) || 0),
        handsPlayed: (Number(existing.handsPlayed) || 0) + (Number(incoming.handsPlayed) || 0),
        vpipHands: (Number(existing.vpipHands) || 0) + (Number(incoming.vpipHands) || 0),
        pfrHands: (Number(existing.pfrHands) || 0) + (Number(incoming.pfrHands) || 0),
        threeBetOpps: (Number(existing.threeBetOpps) || 0) + (Number(incoming.threeBetOpps) || 0),
        threeBetHands: (Number(existing.threeBetHands) || 0) + (Number(incoming.threeBetHands) || 0)
      });
    }
  }

  return Array.from(mergedMap.values());
}
