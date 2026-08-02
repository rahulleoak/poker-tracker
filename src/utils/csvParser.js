function parseCSVLine(line) {
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
}

function normalizeHeader(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function findColIndexInHeaders(headersNormalized, aliases) {
  return headersNormalized.findIndex(col => aliases.includes(col));
}

function getLogEntryText(parsedCols, rawLine, logTextIdx) {
  if (logTextIdx > -1 && parsedCols[logTextIdx] !== undefined) {
    return parsedCols[logTextIdx];
  }
  const matchCol = parsedCols.find(col =>
    /-- starting hand|Player stacks:|folds|checks|calls|raises|approved|sits down|quits|stands up|cashed out|updated the player/i.test(col)
  );
  if (matchCol !== undefined) return matchCol;
  return parsedCols[1] || parsedCols[0] || rawLine;
}

function parseLogStructure(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { chronoLines: [], logTextIdx: -1 };
  }

  const firstLineCols = parseCSVLine(lines[0]);
  const firstLineColsNorm = firstLineCols.map(normalizeHeader);

  const logTextIdx = findColIndexInHeaders(firstLineColsNorm, ['entry', 'action', 'text', 'log', 'log_entry', 'message', 'entry_text']);
  const timeIdx = findColIndexInHeaders(firstLineColsNorm, ['created_at', 'at', 'timestamp', 'date', 'time']);
  const idIdx = findColIndexInHeaders(firstLineColsNorm, ['entry_id', 'id', 'order']);

  const isHeader = logTextIdx > -1 || timeIdx > -1 || idIdx > -1 ||
    firstLineColsNorm.some(c => ['buy_in', 'buyin', 'player', 'nickname', 'player_nickname'].includes(c));

  const dataLines = isHeader ? lines.slice(1) : lines;
  if (dataLines.length === 0) {
    return { chronoLines: [], logTextIdx };
  }

  let isReverse = true;
  if (dataLines.length >= 2) {
    const firstCols = parseCSVLine(dataLines[0]);
    const lastCols = parseCSVLine(dataLines[dataLines.length - 1]);

    let determined = false;
    if (timeIdx > -1 && firstCols[timeIdx] !== undefined && lastCols[timeIdx] !== undefined) {
      const t1 = Date.parse(firstCols[timeIdx]);
      const t2 = Date.parse(lastCols[timeIdx]);
      if (!isNaN(t1) && !isNaN(t2) && t1 !== t2) {
        isReverse = t1 > t2;
        determined = true;
      }
    }
    if (!determined && idIdx > -1 && firstCols[idIdx] !== undefined && lastCols[idIdx] !== undefined) {
      const id1 = parseFloat(firstCols[idIdx]);
      const id2 = parseFloat(lastCols[idIdx]);
      if (!isNaN(id1) && !isNaN(id2) && id1 !== id2) {
        isReverse = id1 > id2;
        determined = true;
      }
    }
    if (!determined) {
      const firstText = dataLines[0];
      const lastText = dataLines[dataLines.length - 1];
      if (/quits|stands up|Player stacks/i.test(firstText) && /participation|sits down|requested stack/i.test(lastText)) {
        isReverse = true;
      } else if (/participation|sits down|requested stack/i.test(firstText) && /quits|stands up|Player stacks/i.test(lastText)) {
        isReverse = false;
      } else {
        const h1 = firstText.match(/-- starting hand #(\d+)/i);
        const h2 = lastText.match(/-- starting hand #(\d+)/i);
        if (h1 && h2) {
          isReverse = parseInt(h1[1], 10) > parseInt(h2[1], 10);
        }
      }
    }
  }

  const chronoLines = isReverse ? dataLines.slice().reverse() : dataLines.slice();
  return { chronoLines, logTextIdx };
}

/**
 * Parses PokerNow CSV log lines chronologically to compute pre-flop player statistics.
 * Tracks total hands played, VPIP hands, PFR hands, 3-Bet opportunities, and 3-Bet hands.
 *
 * @param {string} csvText - Raw CSV content from a PokerNow log export.
 * @returns {Record<string, { handsPlayed: number, vpipHands: number, pfrHands: number, threeBetOpps: number, threeBetHands: number }>}
 */
export function parsePokerNowLogStats(csvText) {
  if (!csvText || typeof csvText !== 'string') return {};

  const { chronoLines, logTextIdx } = parseLogStructure(csvText);
  if (chronoLines.length === 0) return {};

  const playerStats = {};

  const getPlayer = (name) => {
    if (!name || typeof name !== 'string') return null;
    const cleanName = name.split(' @ ')[0].replace(/^"|"$/g, '').trim();
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

  for (const rawLine of chronoLines) {
    const cols = parseCSVLine(rawLine);
    const entry = getLogEntryText(cols, rawLine, logTextIdx);

    const startingMatch = entry.match(/-- starting hand #(\d+)(?:\s+\(id: ([^)]+)\))?/i);
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

    if (handActive && entry.includes('Player stacks:')) {
      const entryPart = entry.substring(entry.indexOf('Player stacks:') + 'Player stacks:'.length);
      const parts = entryPart.split('|').map(p => p.trim());
      for (const part of parts) {
        const match = part.match(/#\d+\s+"?(.+?)(?:\s+@\s+[^\s"()]+)?"?\s*\(([-+]?\d+)\)/);
        if (match) {
          const name = match[1].replace(/^"|"$/g, '').trim();
          const p = getPlayer(name);
          if (p) p.handsPlayed++;
        }
      }
      continue;
    }

    if (handActive && preflop) {
      if (entry.includes('Flop:') || 
          entry.includes('Turn:') || 
          entry.includes('River:') ||
          entry.includes('Undealt cards:') ||
          entry.includes('-- ending hand') ||
          entry.includes('shows a ') ||
          entry.includes('collected ') ||
          entry.includes('returned to ')) {
        preflop = false;
      }
    }

    if (handActive && entry.includes('-- ending hand')) {
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

    if (handActive && preflop) {
      const foldMatch = entry.match(/^"?(.+?)(?:\s+@\s+[^\s"]+)?"?\s+folds/i);
      if (foldMatch) {
        const name = foldMatch[1].replace(/^"|"$/g, '').trim();
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const checkMatch = entry.match(/^"?(.+?)(?:\s+@\s+[^\s"]+)?"?\s+checks/i);
      if (checkMatch) {
        const name = checkMatch[1].replace(/^"|"$/g, '').trim();
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const callMatch = entry.match(/^"?(.+?)(?:\s+@\s+[^\s"]+)?"?\s+calls\s+(\d+)/i);
      if (callMatch) {
        const name = callMatch[1].replace(/^"|"$/g, '').trim();
        vpipInHand.add(name);
        if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const raiseMatch = entry.match(/^"?(.+?)(?:\s+@\s+[^\s"]+)?"?\s+raises\s+to\s+(\d+)/i);
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

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawName) => {
    if (!rawName || typeof rawName !== 'string') return null;
    let cleanName = rawName.split(' @ ')[0].replace(/^"|"$/g, '').trim();
    if (!cleanName) return null;

    if (!players[cleanName]) {
      players[cleanName] = { 
        name: cleanName,
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

  const headerColsRaw = parseCSVLine(lines[0]);
  const headerColsNormalized = headerColsRaw.map(normalizeHeader);

  const nameIdx = findColIndexInHeaders(headerColsNormalized, ['player_nickname', 'nickname', 'player', 'name', 'player_name']);
  const buyInIdx = findColIndexInHeaders(headerColsNormalized, ['buy_in', 'buyin', 'buy_ins']);
  const buyOutIdx = findColIndexInHeaders(headerColsNormalized, ['buy_out', 'buyout', 'cash_out', 'cashout', 'buy_outs']);
  const stackIdx = findColIndexInHeaders(headerColsNormalized, ['stack', 'current_stack', 'ending_stack', 'net', 'ending_stack_amount']);

  const hasLogColumns = headerColsNormalized.some(col => col === 'entry' || col === 'entry_id' || col === 'action' || col === 'created_at');
  const isLedgerCSV = !hasLogColumns && headerColsRaw.length > 1 && nameIdx > -1 && (buyInIdx > -1 || buyOutIdx > -1 || stackIdx > -1);

  if (isLedgerCSV) {
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]).map(c => c.replace(/^"|"$/g, '').trim());
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
    const { chronoLines, logTextIdx } = parseLogStructure(text);
    const currentTableStack = {};
    
    for (const rawLine of chronoLines) {
      const parsedCols = parseCSVLine(rawLine);
      const line = getLogEntryText(parsedCols, rawLine, logTextIdx);

      let m = line.match(/approved the player "?([^"]+?)"? participation with a stack of (\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          const amt = parseInt(m[2], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }
      
      m = line.match(/approved the player "?([^"]+?)"? requested stack of (\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          const amt = parseInt(m[2], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }
      
      m = line.match(/player "?([^"]+?)"? sits down with a stack of (\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          const amt = parseInt(m[2], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }

      m = line.match(/approved the player "?([^"]+?)"? cash out request (?:for|of) (\d+)/i) ||
          line.match(/approved the player "?([^"]+?)"? cash out request.*?stack of (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out with (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out for (\d+)/i) ||
          line.match(/player "?([^"]+?)"? cashed out\D*(\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          const amt = parseInt(m[2], 10);
          p.buyOut += amt;
          currentTableStack[p.name] = Math.max(0, (currentTableStack[p.name] || 0) - amt);
        }
        continue;
      }

      m = line.match(/player "?([^"]+?)"? quits the game with a stack of (\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          p.stack += parseInt(m[2], 10);
          currentTableStack[p.name] = 0;
        }
        continue;
      }
      
      m = line.match(/player "?([^"]+?)"? stands up with a stack of (\d+)/i);
      if (m) {
        const p = getPlayer(m[1]);
        if (p) {
          p.stack += parseInt(m[2], 10);
          currentTableStack[p.name] = 0;
        }
        continue;
      }
      
      m = line.match(/updated the player "?([^"]+?)"? stack from (\d+) to (\d+)/i);
      if (m) {
        const from = parseInt(m[2], 10);
        const to = parseInt(m[3], 10);
        const p = getPlayer(m[1]);
        if (p) {
          if (to > from) {
            p.buyIn += (to - from);
            currentTableStack[p.name] = (currentTableStack[p.name] || 0) + (to - from);
          }
          if (from > to) {
            p.stack += (from - to);
            currentTableStack[p.name] = Math.max(0, (currentTableStack[p.name] || 0) - (from - to));
          }
        }
        continue;
      }

      if (line.includes('Player stacks:')) {
        const entryPart = line.substring(line.indexOf('Player stacks:') + 'Player stacks:'.length);
        const parts = entryPart.split('|').map(p => p.trim());
        for (const part of parts) {
          const match = part.match(/#\d+\s+"?(.+?)(?:\s+@\s+[^\s"()]+)?"?\s*\(([-+]?\d+)\)/);
          if (match) {
            const name = match[1].replace(/^"|"$/g, '').trim();
            const stackVal = parseInt(match[2], 10);
            const p = getPlayer(name);
            if (p) {
              currentTableStack[p.name] = stackVal;
            }
          }
        }
      }
    }

    for (const p of Object.values(players)) {
      if (currentTableStack[p.name] > 0) {
        p.stack += currentTableStack[p.name];
      }
    }
  }

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
