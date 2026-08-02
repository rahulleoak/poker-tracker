export function parsePokerNowLogStats(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return {};

  // Reverse the logs so we process them in chronological order
  const dataLines = lines.slice(1).reverse();
  const playerStats = {};

  const getPlayer = (name) => {
    if (!playerStats[name]) {
      playerStats[name] = {
        handsPlayed: 0,
        vpipHands: 0,
        pfrHands: 0,
        threeBetOpps: 0,
        threeBetHands: 0
      };
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

  // Robust CSV line parser
  const parseCSVLine = (line) => {
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
    if (cols.length < 3) continue;
    const entry = cols[0];

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
          getPlayer(name).handsPlayed++;
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
        getPlayer(name).vpipHands++;
      }
      for (const name of pfrInHand) {
        getPlayer(name).pfrHands++;
      }
      for (const name of threeBetOppInHand) {
        getPlayer(name).threeBetOpps++;
      }
      for (const name of threeBetInHand) {
        getPlayer(name).threeBetHands++;
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

export function parsePokerNowCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawName) => {
    const cleanName = rawName.split(' @ ')[0].replace(/^"|"$/g, '').trim();
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

  const header = lines[0].toLowerCase();
  
  if (header.includes('player_nickname') && header.includes('buy_in')) {
    const headerCols = lines[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
    const nameIdx = headerCols.indexOf('player_nickname');
    const buyInIdx = headerCols.indexOf('buy_in');
    const buyOutIdx = headerCols.indexOf('buy_out');
    const stackIdx = headerCols.indexOf('stack');

    if (nameIdx > -1 && buyInIdx > -1) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length > nameIdx) {
          const buyIn = (buyInIdx > -1 && cols.length > buyInIdx) ? (parseFloat(cols[buyInIdx]) || 0) : 0;
          const buyOut = (buyOutIdx > -1 && cols.length > buyOutIdx) ? (parseFloat(cols[buyOutIdx]) || 0) : 0;
          const stack = (stackIdx > -1 && cols.length > stackIdx) ? (parseFloat(cols[stackIdx]) || 0) : 0;

          if (buyIn > 0 || buyOut > 0 || stack > 0) {
            const p = getPlayer(cols[nameIdx]);
            p.buyIn += buyIn;
            p.buyOut += buyOut;
            p.stack += stack;
          }
        }
      }
    }
  } else {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      let m = line.match(/approved the player "([^"]+)" participation with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/approved the player "([^"]+)" requested stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" sits down with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" quits the game with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).stack += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" stands up with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).stack += parseInt(m[2], 10);
      m = line.match(/updated the player "([^"]+)" stack from (\d+) to (\d+)/i);
      if (m) {
        const from = parseInt(m[2], 10);
        const to = parseInt(m[3], 10);
        if (to > from) getPlayer(m[1]).buyIn += (to - from);
        if (from > to) getPlayer(m[1]).stack += (from - to);
      }
    }

    if (header.includes('entry') || header.includes('at') || header.includes('order')) {
      const stats = parsePokerNowLogStats(text);
      for (const [cleanName, s] of Object.entries(stats)) {
        const p = getPlayer(cleanName);
        p.handsPlayed = s.handsPlayed;
        p.vpipHands = s.vpipHands;
        p.pfrHands = s.pfrHands;
        p.threeBetOpps = s.threeBetOpps;
        p.threeBetHands = s.threeBetHands;
      }
    }
  }

  return Object.entries(players).map(([name, data]) => ({
    name,
    buyIn: data.buyIn,
    buyOut: data.buyOut,
    stack: data.stack,
    handsPlayed: data.handsPlayed || 0,
    vpipHands: data.vpipHands || 0,
    pfrHands: data.pfrHands || 0,
    threeBetOpps: data.threeBetOpps || 0,
    threeBetHands: data.threeBetHands || 0
  })).filter(p => p.buyIn > 0 || p.stack > 0 || p.buyOut > 0);
}
