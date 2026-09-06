// Cross-session settlement ledger.
//
// Given every admin session's `entries` + `settlement` config and the set of
// active `settlement_marks`, roll each country's per-session bank legs up per
// player: how much the bank still owes them (or they still owe the bank) across
// all sessions that haven't been checked off. Pure — the /settlement pages and
// their tests are the only callers.
//
// See design/banks-settlement.md.

import { computeBankSettlement, keyOfEntry } from './bankSettlement.js';
import { country as countryMeta } from './countries.js';

const SEP = '\u0000';

/** Stable identity for one settled leg: (session, leg). */
export const markKey = (sessionId, legId) => `${sessionId}${SEP}${legId}`;

// >0 => the bank owes the party; <0 => the party owes the bank.
const signOf = (direction) => (direction === 'from_bank' ? 1 : -1);

/**
 * @param {{
 *   sessions?: Array<{ id: string, date?: string, entries?: Array, settlement?: Object }>,
 *   marks?: Array<{ session_id: string, leg_id: string, undone_at?: string|null }>,
 *   countryCode: string,
 *   nameOf?: (playerId: string) => (string | null)
 * }} args
 */
export function buildCountrySettlement({ sessions = [], marks = [], countryCode, nameOf } = {}) {
  const resolveName = typeof nameOf === 'function' ? nameOf : () => null;
  const activeMarks = new Set(
    (marks || [])
      .filter((m) => m && !m.undone_at)
      .map((m) => markKey(m.session_id, m.leg_id))
  );

  const meta = countryMeta(countryCode);
  const byParty = new Map(); // groupKey -> { playerId, partyKey, name, lines: [] }
  const bankLines = [];
  let currency = meta.currency;
  let bankName = null;
  let cadToUsd = 1;

  // Newest session first, so the "current" bank + currency win.
  const ordered = [...sessions].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );

  for (const s of ordered) {
    const config = s.settlement && typeof s.settlement === 'object' ? s.settlement : {};
    const entries = Array.isArray(s.entries) ? s.entries : [];
    const r = computeBankSettlement({ entries, ...config });
    cadToUsd = r.cadToUsd || cadToUsd;

    const keyToPid = new Map();
    for (const e of entries) keyToPid.set(keyOfEntry(e), e.playerId || null);
    // Prefer the master profile name; fall back to the raw session name.
    const nameForKey = (key, fallback) => resolveName(keyToPid.get(key)) || fallback || key;
    const pidForKey = (key) => keyToPid.get(key) || key;

    const cInfo = r.countries.find((c) => c.code === countryCode);
    if (cInfo) {
      if (bankName == null && cInfo.bankName) bankName = nameForKey(cInfo.bankKey, cInfo.bankName);
      currency = cInfo.currency || currency;
    }
    const bankKey = cInfo?.bankKey || null;

    for (const t of r.playerTransfers) {
      if (t.country !== countryCode) continue;
      const pid = keyToPid.get(t.partyKey) || null;
      const groupKey = pid || t.partyKey;
      if (!byParty.has(groupKey)) {
        byParty.set(groupKey, { playerId: pid, partyKey: t.partyKey, name: null, lines: [] });
      }
      const g = byParty.get(groupKey);
      const live = resolveName(pid);
      if (live) g.name = live;
      else if (!g.name) g.name = t.partyName;
      g.lines.push({
        sessionId: s.id,
        date: s.date || null,
        legId: t.legId,
        direction: t.direction,
        bankName: nameForKey(t.bankKey, t.bankName),
        bankPartyKey: pidForKey(t.bankKey),
        amountCad: t.amount,
        amountLocal: t.amountLocal,
        currency: t.currency,
        settled: activeMarks.has(markKey(s.id, t.legId))
      });
    }

    if (bankKey) {
      for (const t of r.bankTransfers) {
        if (t.fromKey !== bankKey && t.toKey !== bankKey) continue;
        bankLines.push({
          sessionId: s.id,
          date: s.date || null,
          legId: t.legId,
          from: nameForKey(t.fromKey, t.from),
          fromPartyKey: pidForKey(t.fromKey),
          to: nameForKey(t.toKey, t.to),
          toPartyKey: pidForKey(t.toKey),
          outgoing: t.fromKey === bankKey,
          amountCad: t.amount,
          settled: activeMarks.has(markKey(s.id, t.legId))
        });
      }
    }
  }

  const players = [...byParty.values()]
    .map((g) => {
      const lines = g.lines.sort((a, b) =>
        String(a.date || '').localeCompare(String(b.date || ''))
      );
      const outstanding = lines.filter((l) => !l.settled);
      const outstandingCad = outstanding.reduce((s, l) => s + signOf(l.direction) * l.amountCad, 0);
      const outstandingLocal = outstanding.reduce((s, l) => s + signOf(l.direction) * l.amountLocal, 0);
      return {
        key: g.playerId || g.partyKey,
        playerId: g.playerId,
        partyKey: g.partyKey,
        name: g.name || g.partyKey,
        lines,
        outstandingCount: outstanding.length,
        settledCount: lines.length - outstanding.length,
        outstandingCad,
        outstandingLocal,
        direction:
          outstandingLocal > 0.005 ? 'bank_owes' : outstandingLocal < -0.005 ? 'owes_bank' : 'even'
      };
    })
    .filter((p) => p.lines.length > 0)
    .sort((a, b) => Math.abs(b.outstandingLocal) - Math.abs(a.outstandingLocal));

  const activePlayers = players.filter((p) => p.outstandingCount > 0);
  const collectLocal = activePlayers
    .filter((p) => p.direction === 'owes_bank')
    .reduce((s, p) => s + Math.abs(p.outstandingLocal), 0);
  const payLocal = activePlayers
    .filter((p) => p.direction === 'bank_owes')
    .reduce((s, p) => s + Math.abs(p.outstandingLocal), 0);

  return {
    countryCode: meta.code,
    countryName: meta.name,
    flag: meta.flag,
    currency,
    bankName,
    cadToUsd,
    players,
    bankLines: bankLines.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
    outstandingPlayerCount: activePlayers.length,
    collectLocal,
    payLocal
  };
}
