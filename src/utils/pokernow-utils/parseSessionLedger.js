import { parseCumulativeNet } from './parseHandLog.js';
import { parseFinalLedger } from './fetchLedger.js';

const EMPTY_STATS = {
  handsPlayed: 0,
  vpipHands: 0,
  pfrHands: 0,
  threeBetOpps: 0,
  threeBetHands: 0
};

function isLedgerCsv(csvText) {
  const header = (csvText.split('\n')[0] || '').toLowerCase();
  return header.includes('player_id') && (header.includes('buy_in') || header.includes('net'));
}

const netOf = (e) => (Number(e.buyOut) || 0) + (Number(e.stack) || 0) - (Number(e.buyIn) || 0);

/**
 * A cash-game ledger is zero-sum by definition, but reconstructing one from a
 * hand-history log leaves a small residual: PokerNow admins reset stacks by
 * hand ("from 5802 to 3000") and players top up off-log, and neither is fully
 * recoverable. Spread that residual back across players in proportion to how
 * much they bought in — a proxy for how much churn, and therefore
 * reconstruction error, each contributed — by nudging their buy-ins so the nets
 * sum to exactly zero. Left alone if the residual is too large to be slop
 * (> 2% of money in play), so a genuinely broken CSV still shows as unbalanced.
 *
 * @param {Array<Object>} entries
 * @returns {Array<Object>}
 */
function reconcileToZero(entries) {
  if (entries.length === 0) return entries;

  const residual = Math.round(entries.reduce((sum, e) => sum + netOf(e), 0));
  if (residual === 0) return entries;

  const weights = entries.map(e => Math.max(1, Number(e.buyIn) || 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(residual) > totalWeight * 0.02) return entries;

  let allocated = 0;
  return entries.map((e, i) => {
    const share = i === entries.length - 1
      ? residual - allocated
      : Math.round((residual * weights[i]) / totalWeight);
    allocated += share;
    // positive residual => more was cashed out than bought in => buy-ins undercounted
    return { ...e, buyIn: (Number(e.buyIn) || 0) + share };
  });
}

/**
 * Reduces a PokerNow export to one balanced ledger entry per PokerNow player id.
 *
 * Unlike the name-keyed csvParser, this collapses a player who renamed
 * themselves or rejoined mid-session (same `@ id`, different nicknames) into a
 * single node, reconstructs rebuys/admin stack resets, and reconciles the
 * result so net across all entries sums to 0 like a real cash game. Accepts
 * either a hand-history log CSV (`entry,at,order`) or a ledger CSV
 * (`..,player_id,..,buy_in,..`).
 *
 * @param {string} csvText - Raw PokerNow CSV content.
 * @returns {Array<{ name: string, externalId: string, pokerNowId: string, buyIn: number, buyOut: number, stack: number, handsPlayed: number, vpipHands: number, pfrHands: number, threeBetOpps: number, threeBetHands: number }>}
 */
export function parseSessionLedger(csvText) {
  if (!csvText || typeof csvText !== 'string') return [];

  if (isLedgerCsv(csvText)) {
    // A real ledger CSV already balances exactly; no reconciliation needed.
    return parseFinalLedger(csvText).map(p => ({
      name: p.nicknames[p.nicknames.length - 1] || p.playerId,
      externalId: p.playerId,
      pokerNowId: p.playerId,
      buyIn: Number(p.totalBuyIn) || 0,
      buyOut: Number(p.totalBuyOut) || 0,
      stack: p.isActive ? Number(p.currentStack) || 0 : 0,
      ...EMPTY_STATS
    }));
  }

  const { players } = parseCumulativeNet(csvText);

  const entries = [...players.entries()]
    .map(([id, p]) => ({
      name: [...p.nicknames].slice(-1)[0] || id,
      externalId: id,
      pokerNowId: id,
      buyIn: Number(p.buyIn) || 0,
      buyOut: Number(p.cashOut) || 0,
      stack: p.active ? Number(p.currentStack) || 0 : 0,
      ...EMPTY_STATS
    }))
    .filter(e => e.buyIn !== 0 || e.buyOut !== 0 || e.stack !== 0);

  return reconcileToZero(entries);
}
