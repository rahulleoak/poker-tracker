function parsePlayerIdentifier(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') {
    return { name: 'Unknown', externalId: null, pokerNowId: null };
  }
  let cleanName = rawInput.trim();
  let externalId = null;

  cleanName = cleanName.replace(/^"|"$/g, '').trim();

  if (cleanName.includes(' @ ')) {
    const parts = cleanName.split(' @ ');
    cleanName = parts[0].replace(/^"|"$/g, '').trim();
    externalId = parts.slice(1).join(' @ ').replace(/^"|"$/g, '').replace(/[()]/g, '').trim();
  }

  return {
    name: cleanName || 'Unknown',
    externalId: externalId || null,
    pokerNowId: externalId || null
  };
}

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

export function parsePokerNowLogStats(csvText) {
  if (!csvText || typeof csvText !== 'string') return {};

  const { chronoLines, logTextIdx } = parseLogStructure(csvText);
  if (chronoLines.length === 0) return {};

  const playerStats = {};

  const getPlayer = (rawInput) => {
    const { name, externalId, pokerNowId } = parsePlayerIdentifier(rawInput);
    if (!name) return null;

    if (!playerStats[name]) {
      playerStats[name] = {
        name,
        externalId: externalId || null,
        pokerNowId: pokerNowId || null,
        handsPlayed: 0,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpps: 0,
        threeBetHands: 0
      };
    } else if ((externalId || pokerNowId) && !playerStats[name].externalId) {
      playerStats[name].externalId = externalId || pokerNowId;
      playerStats[name].pokerNowId = pokerNowId || externalId;
    }
    return playerStats[name];
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
        const match = part.match(/#\d+\s+"?(.+?)(?:\s+@\s+([^\s"()]+))?"?\s*\(([-+]?\d+)\)/);
        if (match) {
          const rawStr = match[1] + (match[2] ? ' @ ' + match[2] : '');
          const p = getPlayer(rawStr);
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
      const foldMatch = entry.match(/^"?(.+?)(?:\s+@\s+([^\s"]+))?"?\s+folds/i);
      if (foldMatch) {
        const rawStr = foldMatch[1] + (foldMatch[2] ? ' @ ' + foldMatch[2] : '');
        const p = getPlayer(rawStr);
        const name = p ? p.name : null;
        if (name && raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const checkMatch = entry.match(/^"?(.+?)(?:\s+@\s+([^\s"]+))?"?\s+checks/i);
      if (checkMatch) {
        const rawStr = checkMatch[1] + (checkMatch[2] ? ' @ ' + checkMatch[2] : '');
        const p = getPlayer(rawStr);
        const name = p ? p.name : null;
        if (name && raiseCount === 2 && !actedPreflop3Bet.has(name)) {
          actedPreflop3Bet.add(name);
          threeBetOppInHand.add(name);
        }
        continue;
      }

      const callMatch = entry.match(/^"?(.+?)(?:\s+@\s+([^\s"]+))?"?\s+calls\s+(\d+)/i);
      if (callMatch) {
        const rawStr = callMatch[1] + (callMatch[2] ? ' @ ' + callMatch[2] : '');
        const p = getPlayer(rawStr);
        const name = p ? p.name : null;
        if (name) {
          vpipInHand.add(name);
          if (raiseCount === 2 && !actedPreflop3Bet.has(name)) {
            actedPreflop3Bet.add(name);
            threeBetOppInHand.add(name);
          }
        }
        continue;
      }

      const raiseMatch = entry.match(/^"?(.+?)(?:\s+@\s+([^\s"]+))?"?\s+raises\s+to\s+(\d+)/i);
      if (raiseMatch) {
        const rawStr = raiseMatch[1] + (raiseMatch[2] ? ' @ ' + raiseMatch[2] : '');
        const p = getPlayer(rawStr);
        const name = p ? p.name : null;
        if (name) {
          vpipInHand.add(name);
          pfrInHand.add(name);
          raiseCount++;
          
          if (raiseCount === 3 && !actedPreflop3Bet.has(name)) {
            actedPreflop3Bet.add(name);
            threeBetOppInHand.add(name);
            threeBetInHand.add(name);
          }
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
 * @returns {Array<{ name: string, externalId: string|null, pokerNowId: string|null, buyIn: number, buyOut: number, stack: number, handsPlayed: number, vpipHands: number, pfrHands: number, threeBetOpps: number, threeBetHands: number }>}
 */
export function parsePokerNowCSV(text) {
  if (!text || typeof text !== 'string') return [];

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawInput) => {
    const { name, externalId, pokerNowId } = parsePlayerIdentifier(rawInput);
    if (!name) return null;

    if (!players[name]) {
      players[name] = { 
        name,
        externalId: externalId || null,
        pokerNowId: pokerNowId || null,
        buyIn: 0, 
        buyOut: 0, 
        stack: 0,
        handsPlayed: 0,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpps: 0,
        threeBetHands: 0
      };
    } else if ((externalId || pokerNowId) && !players[name].externalId) {
      players[name].externalId = externalId || pokerNowId;
      players[name].pokerNowId = pokerNowId || externalId;
    }
    return players[name];
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
        const rawPlayerCol = cols[nameIdx];
        const buyIn = (buyInIdx > -1 && cols.length > buyInIdx) ? (parseFloat(cols[buyInIdx]) || 0) : 0;
        const buyOut = (buyOutIdx > -1 && cols.length > buyOutIdx) ? (parseFloat(cols[buyOutIdx]) || 0) : 0;
        const stack = (stackIdx > -1 && cols.length > stackIdx) ? (parseFloat(cols[stackIdx]) || 0) : 0;

        if (buyIn !== 0 || buyOut !== 0 || stack !== 0) {
          const p = getPlayer(rawPlayerCol);
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

      let m = line.match(/approved the player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? participation with a stack of (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          const amt = parseInt(m[3], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }
      
      m = line.match(/approved the player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? requested stack of (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          const amt = parseInt(m[3], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }
      
      m = line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? sits down with a stack of (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          const amt = parseInt(m[3], 10);
          p.buyIn += amt;
          currentTableStack[p.name] = (currentTableStack[p.name] || 0) + amt;
        }
        continue;
      }

      m = line.match(/approved the player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? cash out request (?:for|of) (\d+)/i) ||
          line.match(/approved the player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? cash out request.*?stack of (\d+)/i) ||
          line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? cashed out with (\d+)/i) ||
          line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? cashed out for (\d+)/i) ||
          line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? cashed out\D*(\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          const amt = parseInt(m[3], 10);
          p.buyOut += amt;
          currentTableStack[p.name] = Math.max(0, (currentTableStack[p.name] || 0) - amt);
        }
        continue;
      }

      m = line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? quits the game with a stack of (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          p.stack += parseInt(m[3], 10);
          currentTableStack[p.name] = 0;
        }
        continue;
      }
      
      m = line.match(/player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? stands up with a stack of (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const p = getPlayer(rawStr);
        if (p) {
          p.stack += parseInt(m[3], 10);
          currentTableStack[p.name] = 0;
        }
        continue;
      }
      
      m = line.match(/updated the player "?([^"]+?)"?(?:\s+@\s+([^\s"]+))? stack from (\d+) to (\d+)/i);
      if (m) {
        const rawStr = m[1] + (m[2] ? ' @ ' + m[2] : '');
        const from = parseInt(m[3], 10);
        const to = parseInt(m[4], 10);
        const p = getPlayer(rawStr);
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
          const match = part.match(/#\d+\s+"?(.+?)(?:\s+@\s+([^\s"()]+))?"?\s*\(([-+]?\d+)\)/);
          if (match) {
            const rawStr = match[1] + (match[2] ? ' @ ' + match[2] : '');
            const stackVal = parseInt(match[3], 10);
            const p = getPlayer(rawStr);
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
        if (s.externalId && !p.externalId) {
          p.externalId = s.externalId;
          p.pokerNowId = s.pokerNowId;
        }
        p.handsPlayed = s.handsPlayed || 0;
        p.vpipHands = s.vpipHands || 0;
        p.pfrHands = s.pfrHands || 0;
        p.threeBetOpps = s.threeBetOpps || 0;
        p.threeBetHands = s.threeBetHands || 0;
      }
    }
  }

  return Object.entries(players).map(([name, data]) => ({
    name: data.name || name,
    externalId: data.externalId || null,
    pokerNowId: data.pokerNowId || null,
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
