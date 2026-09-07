export function calculateSettlement({
  entries = [],
  chipValue = 1,
  gameCurrency = 'USD',
  settlementCurrency = 'USD',
  exchangeRates,
  useBankBuddies,
  bankSettlementMode = 'strict'
}) {
  let tBuyIn = 0;
  let tCashOut = 0;
  const nets = [];
  const safeEntries = Array.isArray(entries) ? entries : [];

  safeEntries.forEach((e, index) => {
    if (!e) return;
    const buyIn = Number(e.buyIn) || 0;
    const buyOut = Number(e.buyOut) || 0;
    const stack = Number(e.stack) || 0;
    
    const sessionCashOut = buyOut + stack;

    tBuyIn += buyIn;
    tCashOut += sessionCashOut;
    
    const netChips = sessionCashOut - buyIn;
    const name = (e.name || '').trim();
    if (name !== '') {
      nets.push({ name, netChips, id: index });
    }
  });

  const balanced = tBuyIn === tCashOut && tBuyIn > 0;
  const chipsOnTable = tBuyIn - tCashOut;
  let trans = [];

  if (balanced) {
    const fxRate = (exchangeRates && exchangeRates[settlementCurrency] && exchangeRates[gameCurrency]) 
      ? (exchangeRates[settlementCurrency] / exchangeRates[gameCurrency]) 
      : 1;
    const safeChipValue = Number(chipValue) || 1;
    const chipToTargetFiatMultiplier = safeChipValue * fxRate;

    let playersFiat = nets.map(p => ({
       ...p,
       fiatAmount: p.netChips * chipToTargetFiatMultiplier,
       currency: (safeEntries[p.id]?.currency || gameCurrency || 'USD').toUpperCase(),
       isBank: Boolean(safeEntries[p.id]?.isBank)
    }));
    
    if (useBankBuddies) {
        const zones = {};
        playersFiat.forEach(p => {
            if (!zones[p.currency]) zones[p.currency] = { currency: p.currency, players: [], bankBuddy: null, net: 0 };
            zones[p.currency].players.push({...p}); 
            if (p.isBank && !zones[p.currency].bankBuddy) zones[p.currency].bankBuddy = p.name;
            zones[p.currency].net += p.fiatAmount;
        });

        // Auto-elect a fallback bank buddy for any zone that has players but no designated banker.
        // This ensures strict mode and international-only modes can function consistently and mathematically correct
        // without bypassing normal routing or treating regular players as individual cross-border clearance points.
        Object.values(zones).forEach(zone => {
            if (!zone.bankBuddy && zone.players.length > 0) {
                let bestCandidate = zone.players[0];
                let maxBuyIn = -1;
                
                zone.players.forEach(p => {
                    const originalEntry = safeEntries[p.id];
                    const buyIn = originalEntry ? (Number(originalEntry.buyIn) || 0) : 0;
                    if (buyIn > maxBuyIn) {
                        maxBuyIn = buyIn;
                        bestCandidate = p;
                    }
                });
                
                zone.bankBuddy = bestCandidate.name;
                
                // Keep the isBank flag synced for calculations
                const bbPlayer = zone.players.find(p => p.name === bestCandidate.name);
                if (bbPlayer) bbPlayer.isBank = true;
                
                const origPlayer = playersFiat.find(p => p.name === bestCandidate.name);
                if (origPlayer) origPlayer.isBank = true;
            }
        });

        const interZoneDebtors = [];
        const interZoneCreditors = [];

        Object.values(zones).forEach(zone => {
            if (zone.bankBuddy) {
                if (zone.net < -0.01) interZoneDebtors.push({ name: zone.bankBuddy, amount: Math.abs(zone.net) });
                else if (zone.net > 0.01) interZoneCreditors.push({ name: zone.bankBuddy, amount: zone.net });
            } else {
                zone.players.forEach(p => {
                    if (p.fiatAmount < -0.01) interZoneDebtors.push({ name: p.name, amount: Math.abs(p.fiatAmount) });
                    else if (p.fiatAmount > 0.01) interZoneCreditors.push({ name: p.name, amount: p.fiatAmount });
                });
            }
        });

        interZoneDebtors.sort((a,b) => b.amount - a.amount);
        interZoneCreditors.sort((a,b) => b.amount - a.amount);

        let d = 0; let c = 0;
        while(d < interZoneDebtors.length && c < interZoneCreditors.length) {
            let debtor = interZoneDebtors[d];
            let creditor = interZoneCreditors[c];
            let amount = Math.min(debtor.amount, creditor.amount);
            
            if (amount > 0.01) {
                trans.push({ from: debtor.name, to: creditor.name, amount, type: 'Cross-Border' });
            }
            debtor.amount -= amount;
            creditor.amount -= amount;

            Object.values(zones).forEach(z => {
                if (z.bankBuddy === debtor.name) {
                    const bb = z.players.find(p => p.name === debtor.name);
                    if (bb) bb.fiatAmount += amount;
                }
                if (z.bankBuddy === creditor.name) {
                    const bb = z.players.find(p => p.name === creditor.name);
                    if (bb) bb.fiatAmount -= amount;
                }
            });

            if (debtor.amount < 0.01) d++;
            if (creditor.amount < 0.01) c++;
        }

        Object.values(zones).forEach(zone => {
            if (zone.bankBuddy && bankSettlementMode === 'strict') {
                zone.players.forEach(p => {
                    if (p.name === zone.bankBuddy) return;
                    
                    if (p.fiatAmount < -0.01) {
                        trans.push({ from: p.name, to: zone.bankBuddy, amount: Math.abs(p.fiatAmount), type: 'Bank-Settlement' });
                    } else if (p.fiatAmount > 0.01) {
                        trans.push({ from: zone.bankBuddy, to: p.name, amount: p.fiatAmount, type: 'Bank-Settlement' });
                    }
                });
            } else if (bankSettlementMode === 'international-only') {
                let intraDebtors = zone.players.filter(p => p.fiatAmount < -0.01).map(p => ({...p, amount: Math.abs(p.fiatAmount)})).sort((a,b) => b.amount - a.amount);
                let intraCreditors = zone.players.filter(p => p.fiatAmount > 0.01).map(p => ({...p, amount: p.fiatAmount})).sort((a,b) => b.amount - a.amount);

                let iD = 0; let iC = 0;
                while(iD < intraDebtors.length && iC < intraCreditors.length) {
                    let debtor = intraDebtors[iD];
                    let creditor = intraCreditors[iC];
                    let amount = Math.min(debtor.amount, creditor.amount);
                    
                    if (amount > 0.01) {
                        trans.push({ from: debtor.name, to: creditor.name, amount, type: 'Local' });
                    }
                    debtor.amount -= amount;
                    creditor.amount -= amount;
                    
                    if (debtor.amount < 0.01) iD++;
                    if (creditor.amount < 0.01) iC++;
                }
            }
        });

    } else {
        let debtors = playersFiat.filter(p => p.fiatAmount < -0.01).map(p => ({ ...p, amount: Math.abs(p.fiatAmount) })).sort((a,b) => b.amount - a.amount);
        let creditors = playersFiat.filter(p => p.fiatAmount > 0.01).map(p => ({ ...p, amount: p.fiatAmount })).sort((a,b) => b.amount - a.amount);
        
        let d = 0;
        let c = 0;
        
        while (d < debtors.length && c < creditors.length) {
          let debtor = debtors[d];
          let creditor = creditors[c];
          let amount = Math.min(debtor.amount, creditor.amount);
          
          if (amount > 0.01) {
            trans.push({ from: debtor.name, to: creditor.name, amount });
          }
          debtor.amount -= amount;
          creditor.amount -= amount;
          if (debtor.amount < 0.01) d++;
          if (creditor.amount < 0.01) c++;
        }
    }
  }

  return { totalBuyIn: tBuyIn, totalCashOut: tCashOut, isBalanced: balanced, settlements: trans, chipsOnTable };
}
