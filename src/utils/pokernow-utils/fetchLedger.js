/* global process */
const ledgerUrl = (gameId) => `https://www.pokernow.com/games/${gameId}/ledger_${gameId}.csv`;

export function extractGameId(input) {
  if (!input) return null;
  const match = input.match(/games\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : input.trim();
}

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
  return result.map(c => c.replace(/^"|"$/g, '').trim());
}

export async function fetchLedgerCSV(gameId) {
  const url = ledgerUrl(gameId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ledger CSV (${res.status}): ${url}`);
  }
  return res.text();
}

/**
 * Aggregates a PokerNow ledger CSV (one row per buy-in/cash-out session) into
 * one final result per player_id, since the same person can rejoin under a
 * new nickname or player_id across sessions/devices.
 *
 * @param {string} csvText - Raw ledger CSV content.
 * @returns {Array<{ playerId: string, nicknames: string[], totalBuyIn: number, totalBuyOut: number, currentStack: number, net: number, sessions: number, isActive: boolean }>}
 */
export function parseFinalLedger(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const players = new Map();

  for (const line of lines.slice(1)) {
    const [nickname, playerId, sessionStartAt, sessionEndAt, buyIn, buyOut, stack, , net] = parseCSVLine(line);
    if (!playerId) continue;

    if (!players.has(playerId)) {
      players.set(playerId, {
        playerId,
        nicknames: [],
        totalBuyIn: 0,
        totalBuyOut: 0,
        currentStack: 0,
        net: 0,
        sessions: 0,
        isActive: false
      });
    }

    const p = players.get(playerId);
    if (nickname && !p.nicknames.includes(nickname)) p.nicknames.push(nickname);
    p.totalBuyIn += parseFloat(buyIn) || 0;
    p.totalBuyOut += parseFloat(buyOut) || 0;
    p.net += parseFloat(net) || 0;
    p.sessions += 1;
    if (sessionStartAt && !sessionEndAt) {
      p.isActive = true;
      p.currentStack += parseFloat(stack) || 0;
    }
  }

  return Array.from(players.values()).sort((a, b) => b.net - a.net);
}

export async function getFinalLedger(gameUrlOrId) {
  const gameId = extractGameId(gameUrlOrId);
  if (!gameId) throw new Error('Could not determine game ID from input');
  const csvText = await fetchLedgerCSV(gameId);
  return parseFinalLedger(csvText);
}

if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node fetchLedger.js <gameUrlOrId>');
    process.exit(1);
  }
  getFinalLedger(input)
    .then(ledger => console.log(JSON.stringify(ledger, null, 2)))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
