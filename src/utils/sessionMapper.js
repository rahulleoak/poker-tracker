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
