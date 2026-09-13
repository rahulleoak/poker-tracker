import { useMemo } from 'react';
import { ChevronLeft, TrendingUp, TrendingDown, History, DollarSign, Activity, Zap } from 'lucide-react';
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
    <div className="space-y-6 animate-in fade-in duration-500 font-sans">
      {/* Header */}
      <div className="flex items-center gap-4 border-b border-white/10 pb-4">
        <button 
          onClick={onBack} 
          className="p-2 bg-black/60 hover:bg-zinc-900 border border-white/15 text-zinc-300 transition-all text-xs font-mono font-bold uppercase flex items-center gap-1 hover:border-cyan-400 hover:text-cyan-300"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div>
          <h2 className="text-2xl font-bold text-white uppercase tracking-tight flex items-center gap-2">
            <span>{playerName}</span>
            <span className="text-xs font-mono font-bold px-2 py-0.5 bg-black border border-white/15 text-cyan-400">
              TELEMETRY DOSSIER
            </span>
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">Valuations normalized to {globalCurrency}</p>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="All-Time Net Profit" 
          value={`${totalNet > 0 ? '+' : ''}${formatFiat(totalNet, globalCurrency)}`}
          icon={totalNet >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
          accentColor={totalNet >= 0 ? "emerald" : "rose"}
        />
        <MetricCard 
          title="Total Sessions" 
          value={playerHistory.length} 
          icon={<History className="w-4 h-4 text-cyan-400" />}
          accentColor="cyan"
        />
        <MetricCard 
          title="Total Buy-Ins" 
          value={formatFiat(totalBuyIn, globalCurrency)} 
          icon={<DollarSign className="w-4 h-4 text-amber-400" />}
          accentColor="amber"
        />
        <MetricCard 
          title="Avg Buy-In / Session" 
          value={formatFiat(avgBuyIn, globalCurrency)} 
          icon={<Zap className="w-4 h-4 text-purple-400" />}
          accentColor="cyan"
        />
      </div>

      {/* Advanced Pre-Flop Poker Stats */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-6 shadow-2xl backdrop-blur-xl space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Pre-Flop Tactical Profile
          </h3>
          <span className="text-xs font-mono text-zinc-500">
            {advancedStats.handsPlayed.toLocaleString()} hands sampled
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-black/60 border border-white/10 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">VPIP</span>
              <InfoTooltip text="Voluntarily Put Money In Pot: Percentage of hands where player put money in pre-flop (excluding blinds). High = Loose, Low = Tight." />
            </div>
            <div className="mt-3 flex items-baseline gap-2 font-mono">
              <span className="text-2xl font-black tabular-nums text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]">
                {advancedStats.vpipPct}
              </span>
              <span className="text-xs text-zinc-500">({advancedStats.vpipHands} hands)</span>
            </div>
          </div>

          <div className="bg-black/60 border border-white/10 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">PFR</span>
              <InfoTooltip text="Pre-Flop Raise: Percentage of hands where player raised or re-raised pre-flop. Measures aggression." />
            </div>
            <div className="mt-3 flex items-baseline gap-2 font-mono">
              <span className="text-2xl font-black tabular-nums text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]">
                {advancedStats.pfrPct}
              </span>
              <span className="text-xs text-zinc-500">({advancedStats.pfrHands} hands)</span>
            </div>
          </div>

          <div className="bg-black/60 border border-white/10 p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest">3-Bet</span>
              <InfoTooltip text="3-Bet Percentage: Percentage of times player re-raised when facing a pre-flop raise." />
            </div>
            <div className="mt-3 flex items-baseline gap-2 font-mono">
              <span className="text-2xl font-black tabular-nums text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]">
                {advancedStats.threeBetPct}
              </span>
              <span className="text-xs text-zinc-500">({advancedStats.threeBetHands} / {advancedStats.threeBetOpps} opps)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Best & Worst Sessions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="hud-corner-reticle hud-corner-emerald bg-hud-card/90 border border-white/10 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" /> Best Recorded Session
          </span>
          {bestSession ? (
            <div className="mt-3">
              <div className="text-2xl font-mono font-bold tabular-nums text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.7)]">
                +{formatFiat(bestSession.netFiat, globalCurrency)}
              </div>
              <p className="text-xs font-mono text-zinc-500 mt-1">Date: {bestSession.date}</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-zinc-500 mt-2">No session recorded</p>
          )}
        </div>

        <div className="hud-corner-reticle hud-corner-rose bg-hud-card/90 border border-white/10 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-rose-400 flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5" /> Worst Recorded Session
          </span>
          {worstSession ? (
            <div className="mt-3">
              <div className="text-2xl font-mono font-bold tabular-nums text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.7)]">
                {formatFiat(worstSession.netFiat, globalCurrency)}
              </div>
              <p className="text-xs font-mono text-zinc-500 mt-1">Date: {worstSession.date}</p>
            </div>
          ) : (
            <p className="text-xs font-mono text-zinc-500 mt-2">No session recorded</p>
          )}
        </div>
      </div>

      {/* Session History Table */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="p-4 border-b border-white/10 bg-black/60 flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-white">Session History Log ({playerHistory.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-sans text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-black/80 text-zinc-400 font-mono font-semibold uppercase tracking-wider text-[11px]">
                <th className="p-3.5">Session Date</th>
                <th className="p-3.5 text-right">Buy-In</th>
                <th className="p-3.5 text-right">Cash-Out</th>
                <th className="p-3.5 text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono font-medium">
              {playerHistory.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-8 text-center text-zinc-500 text-xs uppercase tracking-wider">No session history found for this player.</td>
                </tr>
              ) : (
                playerHistory.map((s, idx) => (
                  <tr key={`${s.gameId}-${idx}`} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-3.5 font-bold text-zinc-200">{s.date}</td>
                    <td className="p-3.5 text-right text-zinc-400 tabular-nums">{formatFiat(s.buyInFiat, globalCurrency)}</td>
                    <td className="p-3.5 text-right text-zinc-400 tabular-nums">{formatFiat(s.cashOutFiat, globalCurrency)}</td>
                    <td className={`p-3.5 text-right font-bold tabular-nums ${
                      s.netFiat > 0 
                        ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' 
                        : s.netFiat < 0 
                        ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' 
                        : 'text-zinc-500'
                    }`}>
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
