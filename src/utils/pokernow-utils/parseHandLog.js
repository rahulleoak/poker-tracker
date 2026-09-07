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
