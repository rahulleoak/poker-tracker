// Cross-session settlement ledger.
//
// Two pure steps:
//   1. legsFromSession(sessionRow)  — flatten one admin_sessions row's settlement
//      into `admin_session_legs` rows (persisted at save time by sessionApi).
//   2. buildCountrySettlement({ legs, marks, ... }) — roll those leg rows up per
//      player for one country, minus the check-offs that are already settled.
//
// See design/banks-settlement.md.

import { computeBankSettlement, keyOfEntry } from './bankSettlement.js';
import { country as countryMeta } from './countries.js';

// NUL: never appears in a session id or leg id, so the join can't collide.
const SEP = '\u0000';

/** Stable identity for one settled leg: (session, leg). */
export const markKey = (sessionId, legId) => `${sessionId}${SEP}${legId}`;

// >0 => the bank owes the party; <0 => the party owes the bank.
const signOf = (direction) => (direction === 'from_bank' ? 1 : -1);

/**
 * Flatten one session's settlement into `admin_session_legs` rows.
 *
 * `party_key` / `bank_key` carry the master `playerId` when the seat resolved to
 * a profile (so cross-session aggregation groups the same person even across
 * nickname changes), else the raw `keyOfEntry` token. Names are frozen only as a
 * display fallback — they're resolved live at render.
 *
 * @param {{ id: string, date?: string, entries?: Array, settlement?: Object, currency?: string, exchangeRates?: Object }} session
 * @returns {Array<Object>} leg rows
 */
export function legsFromSession(session) {
  if (!session || !session.id) return [];
  const entries = Array.isArray(session.entries) ? session.entries : [];
  const config = session.settlement && typeof session.settlement === 'object' ? session.settlement : {};
  const r = computeBankSettlement({
    entries,
    gameCurrency: session.currency || config.gameCurrency,
    exchangeRates: session.exchangeRates || config.exchangeRates,
    ...config
  });

  const pid = new Map(entries.map((e) => [keyOfEntry(e), e.playerId || null]));
  const pidOr = (key) => pid.get(key) || key;
  const sessionDate = session.date ? String(session.date).slice(0, 10) : null;
  const cadToUsd = r.cadToUsd || 1;

  const playerLegs = r.playerTransfers.map((t) => ({
    session_id: session.id,
    leg_id: t.legId,
    scope: 'player',
    country: t.country,
    counter_country: null,
    party_key: pidOr(t.partyKey),
    party_name: t.partyName,
    bank_key: pidOr(t.bankKey),
    bank_name: t.bankName,
    direction: t.direction,
    amount_cad: t.amount,
    amount_local: t.amountLocal,
    currency: t.currency,
    session_date: sessionDate
  }));

  const bankLegs = r.bankTransfers.map((t) => ({
    session_id: session.id,
    leg_id: t.legId,
    scope: 'bank',
    country: t.fromCountry || null,
    counter_country: t.toCountry || null,
    party_key: pidOr(t.fromKey),
    party_name: t.from,
    bank_key: pidOr(t.toKey),
    bank_name: t.to,
    direction: 'bank',
    amount_cad: t.amount,
    amount_local: cadToUsd !== 1 ? t.amount * cadToUsd : t.amount,
    currency: 'CAD',
    session_date: sessionDate
  }));

  return [...playerLegs, ...bankLegs];
}

/**
 * Supports both object signature ({ legs, marks, countryCode, nameOf, resolveId })
 * and positional signature (countryCode, legsOrSessions, marks, nameOf).
 */
export function buildCountrySettlement(optsOrCountry = {}, maybeLegs = [], maybeMarks = [], maybeNameOf = null) {
  let legs = [];
  let marks = [];
  let countryCode = 'CA';
  let nameOf = null;
  let resolvePartyId = null;

  if (typeof optsOrCountry === 'string') {
    countryCode = optsOrCountry;
    const raw = Array.isArray(maybeLegs) ? maybeLegs : [];
    if (raw.length > 0 && (raw[0]?.entries || raw[0]?.settlement)) {
      legs = raw.flatMap(legsFromSession);
    } else {
      legs = raw;
    }
    marks = Array.isArray(maybeMarks) ? maybeMarks : [];
    nameOf = typeof maybeNameOf === 'function' ? maybeNameOf : null;
  } else if (optsOrCountry && typeof optsOrCountry === 'object') {
    const raw = Array.isArray(optsOrCountry.legs) ? optsOrCountry.legs : [];
    if (raw.length > 0 && (raw[0]?.entries || raw[0]?.settlement)) {
      legs = raw.flatMap(legsFromSession);
    } else {
      legs = raw;
    }
    marks = Array.isArray(optsOrCountry.marks) ? optsOrCountry.marks : [];
    countryCode = optsOrCountry.countryCode || 'CA';
    nameOf = typeof optsOrCountry.nameOf === 'function' ? optsOrCountry.nameOf : null;
    resolvePartyId = typeof optsOrCountry.resolveId === 'function' ? optsOrCountry.resolveId : null;
  }

  const resolveName = typeof nameOf === 'function' ? nameOf : () => null;
  const activeMarks = new Set(
    (marks || [])
      .filter((m) => m && !m.undone_at)
      .map((m) => markKey(m.session_id, m.leg_id))
  );

  const meta = countryMeta(countryCode);
  const nameFor = (key, fallback) => resolveName(key) || resolveName(fallback) || fallback || key;

  // Newest first: the first leg seen per party sets the display name + the
  // "current" bank / currency for the country.
  const playerLegs = (legs || [])
    .filter((l) => l.scope === 'player' && l.country === meta.code)
    .sort((a, b) => String(b.session_date || '').localeCompare(String(a.session_date || '')));
  const bankLegRows = (legs || []).filter(
    (l) => l.scope === 'bank' && (l.country === meta.code || l.counter_country === meta.code)
  );

  const newest = playerLegs[0];
  const currency = newest?.currency || meta.currency;
  const bankName = newest ? nameFor(newest.bank_key, newest.bank_name) : null;

  const byParty = new Map();
  for (const l of playerLegs) {
    const liveName = resolveName(l.party_key) || resolveName(l.party_name);
    const liveId = resolvePartyId ? (resolvePartyId(l.party_key) || resolvePartyId(l.party_name)) : null;
    const finalPartyKey = liveId || (liveName ? `profile:${liveName.toLowerCase()}` : l.party_key);
    const finalDisplayName = liveName || l.party_name || l.party_key;
    const finalPlayerId = liveId || l.party_key || null;

    if (!byParty.has(finalPartyKey)) {
      byParty.set(finalPartyKey, {
        partyKey: finalPartyKey,
        playerId: finalPlayerId,
        name: finalDisplayName,
        lines: []
      });
    }
    const g = byParty.get(finalPartyKey);
    if (liveName) g.name = liveName;
    if (finalPlayerId) g.playerId = finalPlayerId;

    g.lines.push({
      sessionId: l.session_id,
      date: l.session_date || null,
      sessionDate: l.session_date || null,
      legId: l.leg_id,
      direction: l.direction,
      bankName: nameFor(l.bank_key, l.bank_name),
      bankPartyKey: l.bank_key,
      bankKey: l.bank_key,
      amountCad: Number(l.amount_cad) || 0,
      amountLocal: Number(l.amount_local) || 0,
      currency: l.currency,
      settled: activeMarks.has(markKey(l.session_id, l.leg_id))
    });
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
        netLocal: outstandingLocal,
        netCad: outstandingCad,
        settled: outstanding.length === 0,
        direction:
          outstandingLocal > 0.005 ? 'bank_owes' : outstandingLocal < -0.005 ? 'owes_bank' : 'even'
      };
    })
    .filter((p) => p.lines.length > 0)
    .sort((a, b) => Math.abs(b.outstandingLocal) - Math.abs(a.outstandingLocal));

  const bankLines = bankLegRows
    .map((l) => ({
      sessionId: l.session_id,
      date: l.session_date || null,
      sessionDate: l.session_date || null,
      legId: l.leg_id,
      from: nameFor(l.party_key, l.party_name),
      fromPartyKey: l.party_key,
      fromKey: l.party_key,
      to: nameFor(l.bank_key, l.bank_name),
      toPartyKey: l.bank_key,
      toKey: l.bank_key,
      outgoing: l.country === meta.code, // this country's bank is the debtor
      amountCad: Number(l.amount_cad) || 0,
      amountLocal: Number(l.amount_local) || 0,
      settled: activeMarks.has(markKey(l.session_id, l.leg_id))
    }))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  const activePlayers = players.filter((p) => p.outstandingCount > 0);
  const collectLocal = activePlayers
    .filter((p) => p.direction === 'owes_bank')
    .reduce((s, p) => s + Math.abs(p.outstandingLocal), 0);
  const payLocal = activePlayers
    .filter((p) => p.direction === 'bank_owes')
    .reduce((s, p) => s + Math.abs(p.outstandingLocal), 0);

  const collectCount = activePlayers.filter((p) => p.direction === 'owes_bank').length;
  const payCount = activePlayers.filter((p) => p.direction === 'bank_owes').length;
  const netOutstandingLocal = collectLocal - payLocal;

  const recentMarks = (marks || [])
    .filter((m) => m && (!m.country || m.country === meta.code) && !m.undone_at)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  return {
    countryCode: meta.code,
    countryName: meta.name,
    flag: meta.flag,
    currency,
    bankName,
    players,
    bankLines,
    bankTransfers: bankLines,
    outstandingPlayerCount: activePlayers.length,
    collectLocal,
    payLocal,
    collectCount,
    payCount,
    netOutstandingLocal,
    summary: {
      bankName: bankName || null,
      bankKey: newest?.bank_key || null,
      bankNetCad: -players.reduce((s, p) => s + p.outstandingCad, 0),
      bankNetLocal: -players.reduce((s, p) => s + p.outstandingLocal, 0),
      totalPlayers: players.length,
      openPlayersCount: activePlayers.length
    },
    recentMarks,
    recentActivity: recentMarks
  };
}
