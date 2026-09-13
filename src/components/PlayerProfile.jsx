import { useMemo } from 'react';
import { ChevronLeft, TrendingUp, TrendingDown, History, DollarSign } from 'lucide-react';
import MetricCard from './MetricCard';
import InfoTooltip from './InfoTooltip';
import { formatFiat } from '../utils/formatters';

export default function PlayerProfile({ playerName, games = [], exchangeRates, globalCurrency = 'USD', getPlayerDisplayName = (n) => n, onBack }) {
  const playerHistory = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    return safeGames
      .map(game => {
        if (!game) return null;
        const entries = Array.isArray(game.entries) ? game.entries : [];
        const matchingEntries = entries.filter(e => e && getPlayerDisplayName(e.name, e.externalId || e.pokerNowId) === playerName);
        
        if (matchingEntries.length > 0) {
          const buyIn = matchingEntries.reduce((s, e) => s + (Number(e.buyIn) || 0), 0);
          const buyOut = matchingEntries.reduce((s, e) => s + (Number(e.buyOut) || 0), 0);
          const stack = matchingEntries.reduce((s, e) => s + (Number(e.stack) || 0), 0);
          const totalCashOutChips = buyOut + stack;
          const netChips = totalCashOutChips - buyIn;
          
          const gameCurrency = game.currency || 'USD';
          const chipValue = Number(game.chipValue) || 1;
          const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
            ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
            : 1;
          const multiplier = chipValue * rateToGlobal;

          return {
            date: game.date,
            gameId: game.id,
            buyInFiat: buyIn * multiplier,
            cashOutFiat: totalCashOutChips * multiplier,
            netFiat: netChips * multiplier
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); 
  }, [playerName, games, exchangeRates, globalCurrency, getPlayerDisplayName]);

  const advancedStats = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    let handsPlayed = 0;
    let vpipHands = 0;
    let pfrHands = 0;
    let threeBetOpps = 0;
    let threeBetHands = 0;

    safeGames.forEach(game => {
      if (!game) return;
      const entries = Array.isArray(game.entries) ? game.entries : [];
      const matchingEntries = entries.filter(e => e && getPlayerDisplayName(e.name, e.externalId || e.pokerNowId) === playerName);
      matchingEntries.forEach(entry => {
        handsPlayed += Number(entry.handsPlayed) || 0;
        vpipHands += Number(entry.vpipHands) || 0;
        pfrHands += Number(entry.pfrHands) || 0;
        threeBetOpps += Number(entry.threeBetOpps) || 0;
        threeBetHands += Number(entry.threeBetHands) || 0;
      });
    });

    const vpipPct = handsPlayed > 0 ? `${((vpipHands / handsPlayed) * 100).toFixed(1)}%` : '-';
    const pfrPct = handsPlayed > 0 ? `${((pfrHands / handsPlayed) * 100).toFixed(1)}%` : '-';
    const threeBetPct = threeBetOpps > 0 ? `${((threeBetHands / threeBetOpps) * 100).toFixed(1)}%` : '-';

    return {
      handsPlayed,
      vpipPct,
      pfrPct,
      threeBetPct,
      vpipHands,
      pfrHands,
      threeBetOpps,
      threeBetHands
    };
  }, [playerName, games, getPlayerDisplayName]);

  const totalNet = playerHistory.reduce((sum, s) => sum + (s?.netFiat || 0), 0);
  const totalBuyIn = playerHistory.reduce((sum, s) => sum + (s?.buyInFiat || 0), 0);
  const avgBuyIn = playerHistory.length > 0 ? (totalBuyIn / playerHistory.length) : 0;
  
  const bestSession = playerHistory.length > 0 ? playerHistory.reduce((prev, current) => ((prev?.netFiat || 0) > (current?.netFiat || 0)) ? prev : current) : null;
  const worstSession = playerHistory.length > 0 ? playerHistory.reduce((prev, current) => ((prev?.netFiat || 0) < (current?.netFiat || 0)) ? prev : current) : null;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-200">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-3xl font-bold text-slate-100">{playerName}&apos;s Profile</h2>
          <p className="text-slate-500">All values converted to {globalCurrency}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="All-Time Net Profit" 
          value={`${totalNet > 0 ? '+' : ''}${formatFiat(totalNet, globalCurrency)}`}
          icon={totalNet >= 0 ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-rose-400" />}
        />
        <MetricCard 
          title="Total Sessions" 
          value={playerHistory.length} 
          icon={<History className="w-5 h-5 text-indigo-400" />}
        />
        <MetricCard 
          title="Total Buy-Ins" 
          value={formatFiat(totalBuyIn, globalCurrency)} 
          icon={<DollarSign className="w-5 h-5 text-amber-400" />}
        />
        <MetricCard 
          title="Avg Buy-In / Session" 
          value={formatFiat(avgBuyIn, globalCurrency)} 
          icon={<DollarSign className="w-5 h-5 text-purple-400" />}
        />
      </div>

      {/* Advanced Pre-Flop Poker Stats */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-100 mb-4 flex items-center gap-2">
          <span>Pre-Flop Playing Style</span>
          <span className="text-xs font-normal text-slate-400">({advancedStats.handsPlayed.toLocaleString()} hands recorded)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">VPIP</span>
              <InfoTooltip text="Voluntarily Put Money In Pot: Percentage of hands where the player put money in pre-flop (excluding un-raised blinds). High = Loose, Low = Tight." />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-emerald-400">{advancedStats.vpipPct}</span>
              <span className="text-xs text-slate-500">({advancedStats.vpipHands} hands)</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">PFR</span>
              <InfoTooltip text="Pre-Flop Raise: Percentage of hands where the player raised or re-raised pre-flop. Measures pre-flop aggression." />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-indigo-400">{advancedStats.pfrPct}</span>
              <span className="text-xs text-slate-500">({advancedStats.pfrHands} hands)</span>
            </div>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">3-Bet</span>
              <InfoTooltip text="3-Bet Percentage: Percentage of times the player re-raised when facing a pre-flop raise. Measures re-raising aggression." />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-amber-400">{advancedStats.threeBetPct}</span>
              <span className="text-xs text-slate-500">({advancedStats.threeBetHands} / {advancedStats.threeBetOpps} opps)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-500">Best Session</span>
          {bestSession ? (
            <div className="mt-4">
              <div className="text-3xl font-extrabold text-emerald-400">
                +{formatFiat(bestSession.netFiat, globalCurrency)}
              </div>
              <p className="text-sm text-slate-400 mt-1">Date: {bestSession.date}</p>
            </div>
          ) : (
            <p className="text-slate-500 mt-2">No session recorded</p>
          )}
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl flex flex-col justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-rose-500">Worst Session</span>
          {worstSession ? (
            <div className="mt-4">
              <div className="text-3xl font-extrabold text-rose-400">
                {formatFiat(worstSession.netFiat, globalCurrency)}
              </div>
              <p className="text-sm text-slate-400 mt-1">Date: {worstSession.date}</p>
            </div>
          ) : (
            <p className="text-slate-500 mt-2">No session recorded</p>
          )}
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h3 className="text-lg font-bold text-slate-100">Session History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-slate-400 text-sm">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium text-right">Buy-In</th>
                <th className="p-4 font-medium text-right">Cash-Out</th>
                <th className="p-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {playerHistory.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-8 text-center text-slate-500">No session history found for this player.</td>
                </tr>
              ) : (
                playerHistory.map((s, idx) => (
                  <tr key={`${s.gameId}-${idx}`} className="hover:bg-slate-800/20 transition-colors">
                    <td className="p-4 font-medium text-slate-200">{s.date}</td>
                    <td className="p-4 text-right text-slate-400">{formatFiat(s.buyInFiat, globalCurrency)}</td>
                    <td className="p-4 text-right text-slate-400">{formatFiat(s.cashOutFiat, globalCurrency)}</td>
                    <td className={`p-4 text-right font-bold ${s.netFiat > 0 ? 'text-emerald-400' : s.netFiat < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {s.netFiat > 0 ? '+' : ''}{formatFiat(s.netFiat, globalCurrency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
