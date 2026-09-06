/* global process */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseNameId(raw) {
  const s = raw.trim();
  const idx = s.indexOf(' @ ');
  if (idx === -1) return { name: s, id: s };
  return { name: s.slice(0, idx).trim(), id: s.slice(idx + 3).trim() };
}

const RE_STARTING_HAND = /^-- starting hand #(\d+)/i;
const RE_PLAYER_STACKS = /^Player stacks:\s*(.+)$/i;
const RE_STACK_ENTRY = /#\d+\s+"([^"]+)"\s*\(([-+]?\d+)\)/g;
const RE_APPROVED_PARTICIPATION = /^The admin approved the player "([^"]+)" participation with a stack of (\d+)/i;
const RE_SITS_DOWN = /^The player "([^"]+)" sits down with a stack of (\d+)/i;
const RE_REBOUGHT = /^The player "([^"]+)" rebought\. New stack (\d+)\.$/i;
const RE_QUITS = /^The player "([^"]+)" quits the game with a stack of (\d+)\.$/i;
const RE_ADMIN_UPDATE = /^The admin updated the player "([^"]+)" stack from (\d+) to (\d+)\.$/i;

/**
 * Walks a PokerNow hand-history log CSV chronologically and reconstructs each
 * player's cumulative net (buy-ins/rebuys vs. cash-outs vs. current live stack)
 * at every hand boundary, using the "Player stacks:" line as the ground-truth
 * stack snapshot rather than trying to sum individual pot wins/losses.
 *
 * @param {string} csvText - Raw poker_now_log_*.csv content.
 * @returns {{ players: Map<string, object>, snapshots: Array<{ handNumber: number|null, timestamp: string, nets: Record<string, { nickname: string, net: number }> }> }}
 */
export function parseCumulativeNet(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { players: new Map(), snapshots: [] };

  const rows = lines.slice(1).map(parseCSVLine).reverse();

  const players = new Map();

  const getPlayer = (id, nickname) => {
    if (!players.has(id)) {
      players.set(id, { nicknames: new Set(), currentStack: 0, active: false, buyIn: 0, cashOut: 0 });
    }
    const p = players.get(id);
    if (nickname) p.nicknames.add(nickname);
    return p;
  };

  const netOf = (p) => p.cashOut - p.buyIn + (p.active ? p.currentStack : 0);

  const snapshots = [];
  let currentHand = null;

  for (const cols of rows) {
    const entry = cols[0] || '';
    const at = cols[1] || '';
    let m;

    if ((m = entry.match(RE_STARTING_HAND))) {
      currentHand = parseInt(m[1], 10);
      continue;
    }

    if ((m = entry.match(RE_APPROVED_PARTICIPATION)) || (m = entry.match(RE_SITS_DOWN))) {
      // "The player X joined the game with a stack of N" is unreliable as a
      // buy-in signal: it sometimes never fires for a real join (a quick
      // re-seat can skip straight from "requested a seat" to a later quit),
      // and it can also spuriously re-fire on a plain "sit back" with no
      // money involved. "admin approved ... participation" is 1:1 with real
      // joins instead - only count it if they weren't already active.
      const { name, id } = parseNameId(m[1]);
      const amt = parseFloat(m[2]) || 0;
      const p = getPlayer(id, name);
      if (!p.active) p.buyIn += amt;
      p.currentStack = amt;
      p.active = true;
      continue;
    }

    if ((m = entry.match(RE_REBOUGHT))) {
      // A rebuy always follows busting to (near) zero mid-hand-cycle, before
      // the next "Player stacks:" snapshot would reflect that bust - so our
      // tracked currentStack here is stale (pre-bust) and unusable for a
      // delta. Count the full rebought amount as fresh buy-in instead.
      const { name, id } = parseNameId(m[1]);
      const amt = parseFloat(m[2]) || 0;
      const p = getPlayer(id, name);
      p.buyIn += amt;
      p.currentStack = amt;
      p.active = true;
      continue;
    }

    if ((m = entry.match(RE_QUITS))) {
      const { name, id } = parseNameId(m[1]);
      const amt = parseFloat(m[2]) || 0;
      const p = getPlayer(id, name);
      p.cashOut += amt;
      p.currentStack = 0;
      p.active = false;
      continue;
    }

    if ((m = entry.match(RE_ADMIN_UPDATE))) {
      // These pair with "WARNING: the admin queued the stack change... reseting
      // to N chips" - verified against the real ledger CSV's buy_out column
      // (sum of downward resets in one session matched buy_out exactly), so
      // they ARE real money: capped-down excess is cashed out, topped-up
      // short stacks are a real buy-in.
      const { name, id } = parseNameId(m[1]);
      const from = parseFloat(m[2]) || 0;
      const to = parseFloat(m[3]) || 0;
      const p = getPlayer(id, name);
      if (to > from) p.buyIn += (to - from);
      else if (from > to) p.cashOut += (from - to);
      p.currentStack = to;
      p.active = true;
      continue;
    }

    if ((m = entry.match(RE_PLAYER_STACKS))) {
      RE_STACK_ENTRY.lastIndex = 0;
      let sm;
      while ((sm = RE_STACK_ENTRY.exec(m[1])) !== null) {
        const { name, id } = parseNameId(sm[1]);
        const stack = parseFloat(sm[2]) || 0;
        const p = getPlayer(id, name);
        p.currentStack = stack;
        p.active = true;
      }
      const nets = {};
      for (const [id, p] of players.entries()) {
        nets[id] = { nickname: [...p.nicknames].slice(-1)[0] || id, net: netOf(p) };
      }
      snapshots.push({ handNumber: currentHand, timestamp: at, nets });
    }
  }

  const finalNets = {};
  for (const [id, p] of players.entries()) {
    finalNets[id] = { nickname: [...p.nicknames].slice(-1)[0] || id, net: netOf(p) };
  }
  snapshots.push({ handNumber: currentHand, timestamp: 'latest', nets: finalNets });

  return { players, snapshots };
}

/**
 * Collapses parseCumulativeNet output so players linked in the /admin review
 * dialog chart as one line. `groups` is a list of identity-token lists (a
 * PokerNow id, or any nickname the player used) — the same shape applyPlayerGroups
 * consumes. Each group's members are summed per snapshot and folded onto the
 * first-resolved member's id, keeping that member's latest nickname as the
 * label. A no-op when there are no multi-member groups.
 *
 * @param {ReturnType<typeof parseCumulativeNet>} parsed
 * @param {Array<Array<string>>} groups
 * @returns {ReturnType<typeof parseCumulativeNet>}
 */
export function groupCumulativeNet(parsed, groups) {
  const safeGroups = (Array.isArray(groups) ? groups : [])
    .map(g => (Array.isArray(g) ? g.map(t => (t || '').trim().toLowerCase()).filter(Boolean) : []))
    .filter(g => g.length > 1);
  if (!parsed || safeGroups.length === 0) return parsed;

  const { players, snapshots } = parsed;
  const allIds = [...players.keys()];

  const tokensFor = (id) => {
    const p = players.get(id);
    const t = [String(id).toLowerCase()];
    if (p) for (const nk of p.nicknames) t.push(String(nk).toLowerCase());
    return t;
  };

  const primaryOf = new Map(); // memberId -> primaryId
  for (const group of safeGroups) {
    const memberIds = [];
    for (const token of group) {
      const id = allIds.find(
        x => !memberIds.includes(x) && !primaryOf.has(x) && tokensFor(x).includes(token)
      );
      if (id) memberIds.push(id);
    }
    if (memberIds.length < 2) continue;
    for (const mid of memberIds) primaryOf.set(mid, memberIds[0]);
  }
  if (primaryOf.size === 0) return parsed;

  const canon = (id) => primaryOf.get(id) || id;

  const newPlayers = new Map();
  for (const id of allIds) {
    if (canon(id) !== id) continue; // folded into its primary
    const merged = { ...players.get(id), nicknames: new Set() };
    for (const mid of allIds) {
      if (canon(mid) !== id || mid === id) continue;
      const m = players.get(mid);
      for (const nk of m.nicknames) merged.nicknames.add(nk);
      // Keep buy-in/cash-out aggregate parity with applyPlayerGroups so the
      // chart and the ledger table reconcile against the same weights.
      merged.buyIn = (merged.buyIn || 0) + (m.buyIn || 0);
      merged.cashOut = (merged.cashOut || 0) + (m.cashOut || 0);
      merged.currentStack = (merged.currentStack || 0) + (m.currentStack || 0);
    }
    for (const nk of players.get(id).nicknames) merged.nicknames.add(nk); // primary's last => label
    newPlayers.set(id, merged);
  }

  const labelFor = (id) => [...(newPlayers.get(id)?.nicknames || [])].slice(-1)[0] || id;

  const newSnapshots = snapshots.map(s => {
    const nets = {};
    for (const [mid, val] of Object.entries(s.nets)) {
      const c = canon(mid);
      if (!nets[c]) nets[c] = { nickname: labelFor(c), net: 0 };
      nets[c].net += val.net;
    }
    return { ...s, nets };
  });

  return { players: newPlayers, snapshots: newSnapshots };
}

/**
 * Nudges a cumulative-net timeline so its final point sums to exactly zero,
 * matching the reconciled ledger table. The residual (admin stack resets,
 * off-log top-ups — see reconcileToZero in parseSessionLedger) is split across
 * players by buy-in weight and eased in linearly from hand 1 to Final, so the
 * curve shape is untouched and there's no jump at the end. Left alone if the
 * residual is larger than slop (> 2% of buy-in) or already zero.
 *
 * @param {ReturnType<typeof parseCumulativeNet>} parsed
 * @returns {ReturnType<typeof parseCumulativeNet>}
 */
export function reconcileCumulativeNet(parsed) {
  if (!parsed || parsed.snapshots.length < 2) return parsed;

  const { players, snapshots } = parsed;
  const finalNets = snapshots[snapshots.length - 1].nets;
  const ids = Object.keys(finalNets);

  const residual = Math.round(ids.reduce((sum, id) => sum + finalNets[id].net, 0));
  if (residual === 0) return parsed;

  const weights = ids.map(id => Math.max(1, Number(players.get(id)?.buyIn) || 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (Math.abs(residual) > totalWeight * 0.02) return parsed;

  const shareById = {};
  let allocated = 0;
  ids.forEach((id, i) => {
    const share = i === ids.length - 1
      ? residual - allocated
      : Math.round((residual * weights[i]) / totalWeight);
    allocated += share;
    shareById[id] = share;
  });

  const lastIdx = snapshots.length - 1;
  const newSnapshots = snapshots.map((s, k) => {
    const ramp = k / lastIdx; // 0 at hand 1, 1 at Final
    const nets = {};
    for (const [id, v] of Object.entries(s.nets)) {
      nets[id] = { ...v, net: v.net - (shareById[id] || 0) * ramp };
    }
    return { ...s, nets };
  });

  return { players, snapshots: newSnapshots };
}

/**
 * Reshapes parseCumulativeNet's output into one time series per player,
 * ready for charting: { [playerId]: { nicknames: string[], points: [{ handNumber, timestamp, net }] } }
 */
export function toPerPlayerSeries(parsed) {
  const { players, snapshots } = parsed;
  const series = {};
  for (const [id, p] of players.entries()) {
    series[id] = {
      nicknames: [...p.nicknames],
      points: snapshots
        .filter(s => id in s.nets)
        .map(s => ({ handNumber: s.handNumber, timestamp: s.timestamp, net: s.nets[id].net }))
    };
  }
  return series;
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const fs = await import('node:fs');
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node parseHandLog.js <path-to-hand-log.csv>');
    process.exit(1);
  }
  const csvText = fs.readFileSync(filePath, 'utf8');
  const parsed = parseCumulativeNet(csvText);
  console.log(JSON.stringify(toPerPlayerSeries(parsed), null, 2));
}
