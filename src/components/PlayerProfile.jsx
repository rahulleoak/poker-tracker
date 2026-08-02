import { useMemo } from 'react';
import { ChevronLeft, TrendingUp, TrendingDown, History, DollarSign } from 'lucide-react';
import MetricCard from './MetricCard';
import { formatFiat } from '../utils/formatters';

export default function PlayerProfile({ playerName, games = [], exchangeRates, globalCurrency = 'USD', onBack }) {
  const playerHistory = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    return safeGames
      .map(game => {
        if (!game) return null;
        const entries = Array.isArray(game.entries) ? game.entries : [];
        const entry = entries.find(e => e && e.name === playerName);
        if (entry) {
          const buyIn = Number(entry.buyIn) || 0;
          const buyOut = Number(entry.buyOut) || 0;
          const stack = Number(entry.stack) || 0;
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
  }, [playerName, games, exchangeRates, globalCurrency]);

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
      const entry = entries.find(e => e && e.name === playerName);
      if (entry) {
        handsPlayed += Number(entry.handsPlayed) || 0;
        vpipHands += Number(entry.vpipHands) || 0;
        pfrHands += Number(entry.pfrHands) || 0;
        threeBetOpps += Number(entry.threeBetOpps) || 0;
        threeBetHands += Number(entry.threeBetHands) || 0;
      }
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
  }, [playerName, games]);

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
          <h2 className="text-3xl font-bold text-slate-100">{playerName}'s Profile</h2>
          <p className="text-slate-500">All values converted to {globalCurrency}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="All-Time Net" 
          value={formatFiat(totalNet, globalCurrency)} 
          valueColor={totalNet > 0 ? "text-emerald-400" : totalNet < 0 ? "text-rose-400" : "text-slate-200"}
          icon={totalNet > 0 ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-rose-400" />} 
        />
        <MetricCard title="Games Played" value={playerHistory.length} icon={<History className="w-5 h-5 text-blue-400" />} />
        <MetricCard title="Avg. Buy-in" value={formatFiat(avgBuyIn, globalCurrency)} icon={<DollarSign className="w-5 h-5 text-slate-400" />} />
        <MetricCard 
          title="Total ROI" 
          value={totalBuyIn > 0 ? `${((totalNet / totalBuyIn) * 100).toFixed(1)}%` : '0%'} 
          valueColor={totalNet > 0 ? "text-emerald-400" : totalNet < 0 ? "text-rose-400" : "text-slate-200"}
        />
      </div>

      <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-xl">
        <h3 className="font-bold text-slate-100 mb-4 text-sm uppercase tracking-wider text-slate-400">Pre-flop Statistics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard 
            title="VPIP" 
            value={advancedStats.vpipPct} 
            subtitle={advancedStats.handsPlayed > 0 ? `${advancedStats.vpipHands} / ${advancedStats.handsPlayed} hands` : 'No hands tracked'}
          />
          <MetricCard 
            title="PFR" 
            value={advancedStats.pfrPct} 
            subtitle={advancedStats.handsPlayed > 0 ? `${advancedStats.pfrHands} / ${advancedStats.handsPlayed} hands` : 'No hands tracked'}
          />
          <MetricCard 
            title="3-Bet Frequency" 
            value={advancedStats.threeBetPct} 
            subtitle={advancedStats.threeBetOpps > 0 ? `${advancedStats.threeBetHands} / ${advancedStats.threeBetOpps} opportunities` : 'No opportunities faced'}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-5 border-b border-slate-800 bg-slate-950/50">
            <h3 className="font-bold text-slate-100">Session History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 text-slate-400 text-sm border-b border-slate-800">
                  <th className="p-4 font-medium">Date</th>
                  <th className="p-4 font-medium text-right">Buy In</th>
                  <th className="p-4 font-medium text-right">Cash Out</th>
                  <th className="p-4 font-medium text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {playerHistory.map((session, index) => {
                  if (!session) return null;
                  const sessionDate = session.date ? new Date(session.date) : new Date();
                  const formattedDate = !isNaN(sessionDate.getTime()) 
                    ? sessionDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                    : 'Unknown Date';

                  return (
                    <tr key={index} className="hover:bg-slate-800/20 transition-colors">
                      <td className="p-4 font-medium text-slate-300">
                        {formattedDate}
                      </td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(session.buyInFiat, globalCurrency)}</td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(session.cashOutFiat, globalCurrency)}</td>
                      <td className={`p-4 text-right font-bold ${session.netFiat > 0 ? 'text-emerald-400' : session.netFiat < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {session.netFiat > 0 ? '+' : ''}{formatFiat(session.netFiat, globalCurrency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-xl">
            <h3 className="font-bold text-slate-100 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" /> Best Session
            </h3>
            {bestSession ? (
              <div>
                <p className="text-3xl font-bold text-emerald-400 mb-1">+{formatFiat(bestSession.netFiat, globalCurrency)}</p>
                <p className="text-sm text-slate-500">
                  {bestSession.date && !isNaN(new Date(bestSession.date).getTime()) 
                    ? new Date(bestSession.date).toLocaleDateString() 
                    : 'Unknown Date'}
                </p>
              </div>
            ) : <p className="text-slate-500">No data.</p>}
          </div>

          <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-xl">
            <h3 className="font-bold text-slate-100 mb-4 flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-rose-400" /> Worst Session
            </h3>
            {worstSession ? (
              <div>
                <p className="text-3xl font-bold text-rose-400 mb-1">{formatFiat(worstSession.netFiat, globalCurrency)}</p>
                <p className="text-sm text-slate-500">
                  {worstSession.date && !isNaN(new Date(worstSession.date).getTime()) 
                    ? new Date(worstSession.date).toLocaleDateString() 
                    : 'Unknown Date'}
                </p>
              </div>
            ) : <p className="text-slate-500">No data.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
