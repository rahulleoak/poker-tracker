/**
 * Parses PokerNow CSV log lines chronologically to compute pre-flop player statistics.
 * Tracks total hands played, VPIP hands, PFR hands, 3-Bet opportunities, and 3-Bet hands.
 *
 * @param {string} csvText - Raw CSV content from a PokerNow log export.
 * @returns {Record<string, { handsPlayed: number, vpipHands: number, pfrHands: number, threeBetOpps: number, threeBetHands: number }>}
 */
export function parsePokerNowLogStats(csvText) {
  if (!csvText || typeof csvText !== 'string') return {};

  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return {};

  // Reverse the logs so we process them in chronological order
  const dataLines = lines.slice(1).reverse();
  const playerStats = {};

  const getPlayer = (name) => {
    if (!name || typeof name !== 'string') return null;
    const cleanName = name.trim();
    if (!cleanName) return null;

    if (!playerStats[cleanName]) {
      playerStats[cleanName] = {
        handsPlayed: 0,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpps: 0,
        threeBetHands: 0
      };
    }
    return playerStats[cleanName];
  };

  let handActive = false;
  let preflop = false;
  let raiseCount = 1;

  const vpipInHand = new Set();
  const pfrInHand = new Set();
  const threeBetOppInHand = new Set();
  const threeBetInHand = new Set();
  const actedPreflop3Bet = new Set();

  // Robust CSV line parser
  const parseCSVLine = (line) => {
    if (!line) return [];
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
  };

  for (const line of dataLines) {
    const cols = parseCSVLine(line);
    if (cols.length < 1) continue;
    const entry = cols[0] || '';

    // Hand starts
    const startingMatch = entry.match(/-- starting hand #(\d+) \(id: ([^)]+)\)/);
    if (startingMatch) {
      handActive = true;
      preflop = true;
      raiseCount = 1;
      vpipInHand.clear();
      pfrInHand.clear();
      threeBetOppInHand.clear();
      threeBetInHand.clear();
      actedPreflop3Bet.clear();
      continue;
    }

    // Capture active players
    if (handActive && entry.startsWith('Player stacks:')) {
      const parts = entry.substring('Player stacks:'.length).split('|').map(p => p.trim());
      for (const part of parts) {
        const match = part.match(/#\d+\s+"?(.+?)\s+@\s+([^"\s()]+)"?/);
        if (match) {
          const name = match[1].replace(/^"|"$/g, '').trim();
          const p = getPlayer(name);
          if (p) p.handsPlayed++;
        }
      }
      continue;
    }

    // Determine street shifts
    if (handActive && preflop) {
      if (entry.startsWith('Flop:') || 
          entry.startsWith('Turn:') || 
          entry.startsWith('River:') ||
          entry.startsWith('Undealt cards:') ||
          entry.startsWith('-- ending hand') ||
          entry.includes('shows a ') ||
          entry.includes('collected ') ||
          entry.includes('returned to ')) {
        preflop = false;
      }
    }

    // Hand ends
    if (handActive && entry.startsWith('-- ending hand')) {
      for (const name of vpipInHand) {
        const p = getPlayer(name);
        if (p) p.vpipHands++;
      }
      for (const name of pfrInHand) {
        const p = getPlayer(name);
        if (p) p.pfrHands++;
      }
      for (const name of threeBetOppInHand) {
        const p = getPlayer(name);
        if (p) p.threeBetOpps++;
      }
      for (const name of threeBetInHand) {
        const p = getPlayer(name);
        if (p) p.threeBetHands++;
      }
      handActive = false;
      continue;
    }

    // Parse preflop actions
    if (handActive && preflop) {
      const foldMatch = entry.match(/^"?(.+?)\s+@\s+([^"\s]+)"?\s+folds/);
      if (foldMatch) {
        const name = foldMatch[1].replace(/^"|"$/g, '').trim();
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const checkMatch = entry.match(/^"?(.+?)\s+@\s+([^"\s]+)"?\s+checks/);
      if (checkMatch) {
        const name = checkMatch[1].replace(/^"|"$/g, '').trim();
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const callMatch = entry.match(/^"?(.+?)\s+@\s+([^"\s]+)"?\s+calls\s+(\d+)/);
      if (callMatch) {
        const name = callMatch[1].replace(/^"|"$/g, '').trim();
        vpipInHand.add(name);
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const raiseMatch = entry.match(/^"?(.+?)\s+@\s+([^"\s]+)"?\s+raises\s+to\s+(\d+)/);
      if (raiseMatch) {
        const name = raiseMatch[1].replace(/^"|"$/g, '').trim();
        vpipInHand.add(name);
        pfrInHand.add(name);
        raiseCount++;
        
        if (raiseCount === 3 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
          threeBetInHand.add(name);
        }
        continue;
      }
    }
  }

  return playerStats;
}

/**
 * Parses a PokerNow CSV file (either standard ledger CSV or log history CSV)
 * into player financial entries and aggregated pre-flop statistics.
 *
 * @param {string} text - Raw CSV content.
 * @returns {Array<{ name: string, buyIn: number, buyOut: number, stack: number, handsPlayed: number, vpipHands: number, pfrHands: number, threeBetOpps: number, threeBetHands: number }>}
 */
export function parsePokerNowCSV(text) {
  if (!text || typeof text !== 'string') return [];

  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawName) => {
    if (!rawName || typeof rawName !== 'string') return null;
    let cleanName = rawName.split(' @ ')[0].replace(/^"|"$/g, '').trim();
    if (!cleanName) return null;

    if (!players[cleanName]) {
      players[cleanName] = { 
        buyIn: 0, 
        buyOut: 0, 
        stack: 0,
        handsPlayed: 0,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpps: 0,
        threeBetHands: 0
      };
    }
    return players[cleanName];
  };

  const normalizeHeader = (str) => str.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase();

  // Check if header line contains comma-separated columns or matches ledger columns
  const parseCSVLine = (line) => {
    if (!line) return [];
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
  };

  const headerColsRaw = lines[0].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
  const headerColsNormalized = headerColsRaw.map(normalizeHeader);

  // Column aliases mapping
  const findColIndex = (aliases) => {
    return headerColsNormalized.findIndex(col => aliases.includes(col));
  };

  const nameIdx = findColIndex(['player_nickname', 'nickname', 'player', 'name', 'player_name']);
  const buyInIdx = findColIndex(['buy_in', 'buyin', 'buy_ins']);
  const buyOutIdx = findColIndex(['buy_out', 'buyout', 'cash_out', 'cashout', 'buy_outs']);
  const stackIdx = findColIndex(['stack', 'current_stack', 'ending_stack', 'net', 'ending_stack_amount']);

  // Only treat as a ledger CSV if header has columns matching player name AND buy_in/buy_out/stack, and NOT entry_id/entry/action
  const hasLogColumns = headerColsNormalized.some(col => col === 'entry' || col === 'entry_id' || col === 'action' || col === 'created_at');
  const isLedgerCSV = !hasLogColumns && headerColsRaw.length > 1 && nameIdx > -1 && (buyInIdx > -1 || buyOutIdx > -1 || stackIdx > -1);

  if (isLedgerCSV) {
    const parseCols = (line) => line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCols(lines[i]);
      if (cols.length > nameIdx) {
        const buyIn = (buyInIdx > -1 && cols.length > buyInIdx) ? (parseFloat(cols[buyInIdx]) || 0) : 0;
        const buyOut = (buyOutIdx > -1 && cols.length > buyOutIdx) ? (parseFloat(cols[buyOutIdx]) || 0) : 0;
        const stack = (stackIdx > -1 && cols.length > stackIdx) ? (parseFloat(cols[stackIdx]) || 0) : 0;

        if (buyIn !== 0 || buyOut !== 0 || stack !== 0) {
          const p = getPlayer(cols[nameIdx]);
          if (p) {
            p.buyIn += buyIn;
            p.buyOut += buyOut;
            p.stack += stack;
          }
        }
      }
    }
  } else {
    // Process logs chronologically (lines are in reverse chronological order in PokerNow log CSV exports)
    // We reverse lines from index 1 to end so we go from oldest entry to newest entry
    const logLines = lines.slice(1).reverse();
    
    for (const rawLine of logLines) {
      const parsedCols = parseCSVLine(rawLine);
      const line = parsedCols[1] || parsedCols[0] || rawLine;
      let m = line.match(/approved the player "?([^"]+?)"? participation with a stack of (\d+)/i) ||
              line.match(/approved the player "([^"]+)" participation with a stack of (\d+)/i);
      if (m) { const p = getPlayer(m[1]); if (p) p.buyIn += parseInt(m[2], 10); continue; }
      
      m = line.match(/approved the player "?([^"]+?)"? requested stack of (\d+)/i) ||
          line.match(/approved the player "([^"]+)" requested stack of (\d+)/i);
      if (m) { const p = getPlayer(m[1]); if (p) p.buyIn += parseInt(m[2], 10); continue; }
      
      m = line.match(/player "?([^"]+?)"? sits down with a stack of (\d+)/i) ||
          line.match(/player "([^"]+)" sits down with a stack of (\d+)/i);
      if (m) { const p = getPlayer(m[1]); if (p) p.buyIn += parseInt(m[2], 10); continue; }

      // Cash-out / Buy-out requests & actions
      m = line.match(/approved the player "?([^"]+?)"? cash out request (?:for|of) (\d+)/i) ||
          line.match(/approved the player "?([^"]+?)"? cash out request.*stack of (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out with (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out for (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out.*(\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) p.buyOut += parseInt(m[2], 10);
        continue;
      }

      m = line.match(/player "?([^"]+?)"? quits the game with a stack of (\d+)/i);
      if (m) { const p = getPlayer(m[1]); if (p) p.stack += parseInt(m[2], 10); continue; }
      
      m = line.match(/player "?([^"]+?)"? stands up with a stack of (\d+)/i);
      if (m) { const p = getPlayer(m[1]); if (p) p.stack += parseInt(m[2], 10); continue; }
      
      m = line.match(/updated the player "?([^"]+?)"? stack from (\d+) to (\d+)/i);
      if (m) {
        const from = parseInt(m[2], 10);
        const to = parseInt(m[3], 10);
        const p = getPlayer(m[1]);
        if (p) {
          if (to > from) p.buyIn += (to - from);
          if (from > to) p.stack += (from - to);
        }
        continue;
      }

      // Capture final player stacks from the final "Player stacks:" entry in chronological log
      if (line.includes('Player stacks:')) {
        const entryPart = line.substring(line.indexOf('Player stacks:') + 'Player stacks:'.length);
        const parts = entryPart.split('|').map(p => p.trim());
        for (const part of parts) {
          // Format: #1 "Name @ ID" (stack) or #1 Name @ ID (stack)
          const match = part.match(/#\d+\s+"?(.+?)(?:\s+@\s+[^"\s()]+)?"?\s*\(([-+]?\d+)\)/);
          if (match) {
            const name = match[1].replace(/^"|"$/g, '').trim();
            const stackVal = parseInt(match[2], 10);
            const p = getPlayer(name);
            if (p) {
              p.stack = stackVal; // update stack to latest known stack in chronological order
            }
          }
        }
      }
    }
  }

  // Also extract log stats if log lines are present in the text
  if (text.includes('-- starting hand') || text.includes('Player stacks:')) {
    const stats = parsePokerNowLogStats(text);
    for (const [cleanName, s] of Object.entries(stats)) {
      const p = getPlayer(cleanName);
      if (p) {
        p.handsPlayed = s.handsPlayed || 0;
        p.vpipHands = s.vpipHands || 0;
        p.pfrHands = s.pfrHands || 0;
        p.threeBetOpps = s.threeBetOpps || 0;
        p.threeBetHands = s.threeBetHands || 0;
      }
    }
  }

  return Object.entries(players).map(([name, data]) => ({
    name,
    buyIn: Number(data.buyIn) || 0,
    buyOut: Number(data.buyOut) || 0,
    stack: Number(data.stack) || 0,
    handsPlayed: Number(data.handsPlayed) || 0,
    vpipHands: Number(data.vpipHands) || 0,
    pfrHands: Number(data.pfrHands) || 0,
    threeBetOpps: Number(data.threeBetOpps) || 0,
    threeBetHands: Number(data.threeBetHands) || 0
  })).filter(p => p.buyIn !== 0 || p.stack !== 0 || p.buyOut !== 0 || p.handsPlayed > 0);
}
