import { extractPokerNowUrl } from '../sessionMapper.js';

/**
 * Derives the PokerNow game id from an export's file name
 * (`poker_now_log_<id>.csv`, `ledger_<id>.csv`, optionally with a browser
 * ` (1)` dedupe suffix), falling back to a game URL embedded in the content.
 *
 * @param {string} [fileName]
 * @param {string} [text] - Raw CSV content, used only for the URL fallback.
 * @returns {string|null} The game id, or null if none can be determined.
 */
export function extractPokerNowGameId(fileName, text) {
  const fromName = (fileName || '').trim()
    .match(/^(?:poker_now_log_|ledger_)(.+?)(?:\s*\(\d+\))?\.csv$/i);
  if (fromName && fromName[1]) return fromName[1];

  const fromUrl = extractPokerNowUrl(text || '').match(/games\/([a-zA-Z0-9_-]+)/i);
  return fromUrl ? fromUrl[1] : null;
}

/**
 * Finds the earliest ISO timestamp in a PokerNow export and returns its
 * calendar date (UTC, `YYYY-MM-DD`) — i.e. when the game started.
 *
 * @param {string} text - Raw CSV content.
 * @returns {string|null}
 */
export function extractSessionStartDate(text) {
  if (!text || typeof text !== 'string') return null;
  const stamps = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g);
  if (!stamps || stamps.length === 0) return null;
  let earliest = stamps[0];
  for (const s of stamps) if (s < earliest) earliest = s;
  return earliest.slice(0, 10);
}

const GROUP_SUM_FIELDS = ['buyIn', 'buyOut', 'stack', 'handsPlayed', 'vpipHands', 'pfrHands', 'threeBetOpps', 'threeBetHands'];

/**
 * Collapses user-defined player groups into single merged ledger entries.
 *
 * Each group is a list of identifier tokens (a PokerNow id, external id, or
 * name — matched case-insensitively against any of those fields on an entry)
 * that represent the same real person across multiple seats. Grouped entries
 * are summed (buy-ins, buy-outs, stack, hand stats) into one entry that keeps
 * the first-listed member as its primary identity and sits at that member's
 * position. Each entry is consumed by at most one group; entries in no group
 * pass through untouched.
 *
 * @param {Array<Object>} entries - Parsed CSV player entries.
 * @param {Array<Array<string>>} groups - Groups of identifier tokens to merge.
 * @returns {Array<Object>} Entries with grouped players collapsed.
 */
export function applyPlayerGroups(entries = [], groups = []) {
  const safeEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  const safeGroups = (Array.isArray(groups) ? groups : [])
    .map(g => (Array.isArray(g) ? g.map(t => (t || '').trim().toLowerCase()).filter(Boolean) : []))
    .filter(g => g.length > 1);

  if (safeGroups.length === 0) return safeEntries.map(e => ({ ...e }));

  const idsOf = (entry) =>
    [entry.pokerNowId, entry.externalId, entry.name]
      .map(v => (v || '').trim().toLowerCase())
      .filter(Boolean);

  const claimed = new Set(); // entry indices already merged into a group
  const mergedAt = new Map(); // primary entry index -> merged entry
  const dropped = new Set(); // non-primary entry indices to omit from output

  for (const group of safeGroups) {
    const memberIndices = [];
    for (const token of group) {
      const idx = safeEntries.findIndex(
        (e, i) => !claimed.has(i) && !memberIndices.includes(i) && idsOf(e).includes(token)
      );
      if (idx !== -1) memberIndices.push(idx);
    }
    if (memberIndices.length < 2) continue;

    const primaryIdx = memberIndices[0];
    const merged = { ...safeEntries[primaryIdx] };
    for (let i = 1; i < memberIndices.length; i++) {
      const m = safeEntries[memberIndices[i]];
      merged.externalId = merged.externalId || m.externalId || null;
      merged.pokerNowId = merged.pokerNowId || m.pokerNowId || null;
      for (const field of GROUP_SUM_FIELDS) {
        merged[field] = (Number(merged[field]) || 0) + (Number(m[field]) || 0);
      }
    }

    memberIndices.forEach(i => claimed.add(i));
    memberIndices.slice(1).forEach(i => dropped.add(i));
    mergedAt.set(primaryIdx, merged);
  }

  const result = [];
  for (let i = 0; i < safeEntries.length; i++) {
    if (dropped.has(i)) continue;
    result.push(mergedAt.has(i) ? mergedAt.get(i) : { ...safeEntries[i] });
  }
  return result;
}
