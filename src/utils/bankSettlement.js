import { country, DEFAULT_COUNTRY } from './countries.js';

const EPS = 0.005; // half a cent — below this, treat as settled

/** Stable identity for a ledger entry (matches AdminPlayerLinkDialog grouping keys). */
export function keyOfEntry(entry) {
  return String(entry?.pokerNowId || entry?.externalId || entry?.name || '').trim().toLowerCase();
}

function greedyMatch(nodes) {
  const creditors = nodes.filter((n) => n.amount > EPS).map((n) => ({ ...n })).sort((a, b) => b.amount - a.amount);
  const debtors = nodes.filter((n) => n.amount < -EPS).map((n) => ({ ...n, amount: -n.amount })).sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const amount = Math.min(c.amount, d.amount);
    if (amount > EPS) {
      transfers.push({
        scope: 'bank',
        legId: `bank:${d.key}>${c.key}`,
        fromKey: d.key,
        from: d.name,
        toKey: c.key,
        to: c.name,
        amount
      });
    }
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount <= EPS) ci++;
    if (d.amount <= EPS) di++;
  }
  return transfers;
}

/**
 * Two-tier settlement: within a country, every non-bank player settles their
 * whole net with that country's designated bank; the banks then settle each
 * country's aggregate net between themselves. Players in a country with no bank
 * assigned fall through to the inter-country pool as individuals.
 *
 * Canonical amounts (`amount`, `net`) are CAD (chips ÷ chipsPerCad). Each
 * country also settles in its own currency: `*Local` fields convert CAD at
 * `cadToUsd` for USD countries (1:1 for CAD). `from` pays `to`.
 *
 * @param {{ entries: Array<Object>, countryByKey?: Record<string,string>, bankByCountry?: Record<string,string>, chipsPerCad?: number, cadToUsd?: number }} args
 */
export function computeBankSettlement({ entries = [], countryByKey = {}, bankByCountry = {}, chipsPerCad = 100, cadToUsd = 1 }) {
  const rate = Number(chipsPerCad) > 0 ? Number(chipsPerCad) : 100;
  const usdRate = Number(cadToUsd) > 0 ? Number(cadToUsd) : 1;
  const currencyRate = (code) => (country(code).currency === 'USD' ? usdRate : 1);

  const units = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && (e.name || '').trim() !== '')
    .map((e) => {
      const key = keyOfEntry(e);
      const netChips = (Number(e.buyOut) || 0) + (Number(e.stack) || 0) - (Number(e.buyIn) || 0);
      return {
        key,
        name: (e.name || '').trim(),
        netCad: netChips / rate,
        country: countryByKey[key] || DEFAULT_COUNTRY
      };
    });

  const byCountry = new Map();
  for (const u of units) {
    if (!byCountry.has(u.country)) byCountry.set(u.country, []);
    byCountry.get(u.country).push(u);
  }

  const playerTransfers = [];
  const interNodes = [];
  const countries = [];

  for (const [code, members] of byCountry) {
    const meta = country(code);
    const fx = currencyRate(code); // CAD -> local currency
    let bankKey = bankByCountry[code] || null;
    const bankUnit = bankKey ? members.find((m) => m.key === bankKey) : null;
    if (!bankUnit) bankKey = null;

    const countryNet = members.reduce((s, m) => s + m.netCad, 0);

    countries.push({
      code,
      name: meta.name,
      flag: meta.flag,
      currency: meta.currency,
      fxFromCad: fx,
      bankKey,
      bankName: bankUnit ? bankUnit.name : null,
      net: countryNet,
      netLocal: countryNet * fx,
      members: members.map((m) => ({
        key: m.key,
        name: m.name,
        netCad: m.netCad,
        netLocal: m.netCad * fx,
        isBank: m.key === bankKey
      }))
    });

    if (bankUnit) {
      for (const m of members) {
        if (m.key === bankKey) continue;
        const common = {
          scope: 'player',
          legId: `player:${m.key}`,
          partyKey: m.key,
          partyName: m.name,
          bankKey,
          bankName: bankUnit.name,
          currency: meta.currency,
          country: code
        };
        if (m.netCad > EPS) {
          // player is up on the session — the bank owes them
          playerTransfers.push({ ...common, direction: 'from_bank', fromKey: bankKey, from: bankUnit.name, toKey: m.key, to: m.name, amount: m.netCad, amountLocal: m.netCad * fx });
        } else if (m.netCad < -EPS) {
          // player is down — they owe the bank
          playerTransfers.push({ ...common, direction: 'to_bank', fromKey: m.key, from: m.name, toKey: bankKey, to: bankUnit.name, amount: -m.netCad, amountLocal: -m.netCad * fx });
        }
      }
      interNodes.push({ key: bankKey, name: bankUnit.name, amount: countryNet });
    } else {
      for (const m of members) interNodes.push({ key: m.key, name: m.name, amount: m.netCad });
    }
  }

  const bankTransfers = greedyMatch(interNodes);
  const balanced = Math.abs(units.reduce((s, m) => s + m.netCad, 0)) < 0.01;

  return { chipsPerCad: rate, cadToUsd: usdRate, countries, playerTransfers, bankTransfers, balanced };
}
