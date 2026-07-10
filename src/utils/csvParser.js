export function parsePokerNowCSV(text) {
  const lines = text.split('
').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawName) => {
    const cleanName = rawName.split(' @ ')[0].trim();
    if (!players[cleanName]) {
      players[cleanName] = { buyIn: 0, buyOut: 0, stack: 0 };
    }
    return players[cleanName];
  };

  const header = lines[0].toLowerCase();
  
  if (header.includes('player_nickname') && header.includes('buy_in')) {
    const headerCols = lines[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
    const nameIdx = headerCols.indexOf('player_nickname');
    const buyInIdx = headerCols.indexOf('buy_in');
    const buyOutIdx = headerCols.indexOf('buy_out');

    if (nameIdx > -1 && buyInIdx > -1) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length > Math.max(nameIdx, buyInIdx, buyOutIdx)) {
          const buyIn = parseFloat(cols[buyInIdx]) || 0;
          const cashOut = parseFloat(cols[buyOutIdx]) || 0;
          if (buyIn > 0 || cashOut > 0) {
            const p = getPlayer(cols[nameIdx]);
            p.buyIn += buyIn;
            p.stack += cashOut;
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
  }

  return Object.entries(players).map(([name, data]) => ({
    name,
    buyIn: data.buyIn,
    buyOut: data.buyOut,
    stack: data.stack
  })).filter(p => p.buyIn > 0 || p.stack > 0 || p.buyOut > 0);
}