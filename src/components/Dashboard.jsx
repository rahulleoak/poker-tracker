import { History, DollarSign, Crown, HeartHandshake, ShieldCheck, Activity } from 'lucide-react';
import { motion } from 'framer-motion';
import MetricCard from './MetricCard';
import ProfitGraph from './ProfitGraph';
import { formatFiat } from '../utils/formatters';

export default function Dashboard({ 
  stats = [], 
  totalSessions = 0, 
  totalMoney = 0, 
  globalCurrency = 'USD', 
  onPlayerClick, 
  games = [], 
  exchangeRates = {}, 
  getPlayerDisplayName 
}) {
  const safeStats = Array.isArray(stats) ? stats : [];
  const topWinner = safeStats.length > 0 && safeStats[0]?.netFiat > 0 ? safeStats[0] : null;
  const topLoser = safeStats.length > 0 && safeStats[safeStats.length - 1]?.netFiat < 0 ? safeStats[safeStats.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500 font-sans">
      {/* Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard 
          title="Total Sessions" 
          value={totalSessions} 
          subtitle="Lifetime tracked games"
          icon={<History className="w-6 h-6 text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" />} 
          valueColor="text-white"
        />
        <MetricCard 
          title={`Money Wagered (${globalCurrency})`} 
          value={formatFiat(totalMoney, globalCurrency)} 
          subtitle="Total volume in play"
          icon={<DollarSign className="w-6 h-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]" />} 
          valueColor="text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.4)]"
        />
      </div>

      {/* Global Profit / Loss Trend Graph */}
      <ProfitGraph 
        games={games} 
        exchangeRates={exchangeRates} 
        globalCurrency={globalCurrency} 
        getPlayerDisplayName={getPlayerDisplayName} 
      />

      {/* Hall of Fame Podiums */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Shark Podium */}
        <motion.div 
          whileHover={{ scale: 1.01 }}
          transition={{ duration: 0.2 }}
          onClick={() => topWinner && topWinner.name && onPlayerClick && onPlayerClick(topWinner.name)}
          className="hud-corner-reticle hud-corner-emerald bg-hud-card/90 border border-emerald-500/20 p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-emerald-500/60 hover:shadow-neon-emerald transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-colors pointer-events-none" />
          <div className="flex items-start justify-between relative z-10">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider border border-emerald-500/30">
                <Crown className="w-3.5 h-3.5 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.8)]" /> Top Shark
              </span>
              <div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-white group-hover:text-emerald-300 transition-colors tracking-tight">
                  {topWinner ? topWinner.name : 'No Shark Yet'}
                </h3>
                <p className="text-zinc-400 text-xs mt-1 font-sans">Dominating the table</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-mono font-black text-emerald-400 drop-shadow-[0_0_10px_rgba(34,197,94,0.6)] tabular-nums">
                  {topWinner ? `+${formatFiat(topWinner.netFiat, globalCurrency)}` : '—'}
                </span>
                <span className="text-zinc-500 text-xs font-mono uppercase">all-time net</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shrink-0">
              <Crown className="w-8 h-8 text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
            </div>
          </div>
        </motion.div>

        {/* Biggest Donor Podium */}
        <motion.div 
          whileHover={{ scale: 1.01 }}
          transition={{ duration: 0.2 }}
          onClick={() => topLoser && topLoser.name && onPlayerClick && onPlayerClick(topLoser.name)}
          className="hud-corner-reticle hud-corner-rose bg-hud-card/90 border border-rose-500/20 p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-rose-500/60 hover:shadow-neon-rose transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-40 h-40 bg-rose-500/10 rounded-full blur-3xl group-hover:bg-rose-500/20 transition-colors pointer-events-none" />
          <div className="flex items-start justify-between relative z-10">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-rose-500/10 text-rose-400 text-xs font-mono font-bold uppercase tracking-wider border border-rose-500/30">
                <HeartHandshake className="w-3.5 h-3.5 text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]" /> Biggest Donor
              </span>
              <div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-white group-hover:text-rose-300 transition-colors tracking-tight">
                  {topLoser ? topLoser.name : 'No Donor Yet'}
                </h3>
                <p className="text-zinc-400 text-xs mt-1 font-sans">Keeping the action alive</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-mono font-black text-rose-400 drop-shadow-[0_0_10px_rgba(244,63,94,0.6)] tabular-nums">
                  {topLoser ? formatFiat(topLoser.netFiat, globalCurrency) : '—'}
                </span>
                <span className="text-zinc-500 text-xs font-mono uppercase">contribution</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/30 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shrink-0">
              <HeartHandshake className="w-8 h-8 text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Broadcast Leaderboard */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
            <h2 className="text-base font-bold text-white uppercase tracking-wider font-sans">All-Time Master Leaderboard</h2>
          </div>
          <p className="text-xs text-zinc-500 font-mono">Select player to inspect profile & history</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/80 text-zinc-400 text-xs font-mono uppercase tracking-wider border-b border-white/10">
                <th className="p-4 font-semibold w-16">Rank</th>
                <th className="p-4 font-semibold">Player</th>
                <th className="p-4 font-semibold text-right">Games</th>
                <th className="p-4 font-semibold text-right">VPIP</th>
                <th className="p-4 font-semibold text-right">PFR</th>
                <th className="p-4 font-semibold text-right">3-Bet</th>
                <th className="p-4 font-semibold text-right">Total In</th>
                <th className="p-4 font-semibold text-right">Total Out</th>
                <th className="p-4 font-semibold text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {safeStats.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-10 text-center text-zinc-500 font-mono text-sm">
                    No player records logged yet. Import a session CSV to initialize telemetry.
                  </td>
                </tr>
              ) : (
                safeStats.map((player, index) => {
                  if (!player) return null;

                  const handsPlayed = Number(player.handsPlayed) || 0;
                  const vpipHands = Number(player.vpipHands) || 0;
                  const pfrHands = Number(player.pfrHands) || 0;
                  const threeBetOpps = Number(player.threeBetOpps) || 0;
                  const threeBetHands = Number(player.threeBetHands) || 0;

                  const vpipPct = handsPlayed > 0 ? `${((vpipHands / handsPlayed) * 100).toFixed(1)}%` : '—';
                  const pfrPct = handsPlayed > 0 ? `${((pfrHands / handsPlayed) * 100).toFixed(1)}%` : '—';
                  const threeBetPct = threeBetOpps > 0 ? `${((threeBetHands / threeBetOpps) * 100).toFixed(1)}%` : '—';
                  
                  const isTop3 = index < 3;
                  const isPositive = (player.netFiat || 0) > 0;
                  const isNegative = (player.netFiat || 0) < 0;

                  return (
                    <tr 
                      key={player.name || index} 
                      onClick={() => player.name && onPlayerClick && onPlayerClick(player.name)}
                      className="hover:bg-white/[0.04] transition-colors cursor-pointer group"
                    >
                      <td className="p-4 font-mono font-bold text-xs">
                        {index === 0 && <span className="text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.8)]">#01</span>}
                        {index === 1 && <span className="text-slate-300 drop-shadow-[0_0_6px_rgba(255,255,255,0.6)]">#02</span>}
                        {index === 2 && <span className="text-amber-600 drop-shadow-[0_0_6px_rgba(217,119,6,0.8)]">#03</span>}
                        {index > 2 && <span className="text-zinc-600">#{String(index + 1).padStart(2, '0')}</span>}
                      </td>
                      <td className="p-4 font-semibold text-zinc-100 group-hover:text-cyan-400 transition-colors font-sans flex items-center gap-2">
                        {player.name || 'Unknown'}
                      </td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-400">{player.gamesPlayed || 0}</td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-300">{vpipPct}</td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-300">{pfrPct}</td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-300">{threeBetPct}</td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-400">{formatFiat(player.buyInFiat, globalCurrency)}</td>
                      <td className="p-4 text-right font-mono tabular-nums text-zinc-400">{formatFiat(player.cashOutFiat, globalCurrency)}</td>
                      <td className={`p-4 text-right font-mono tabular-nums font-bold ${
                        isPositive ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' :
                        isNegative ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' :
                        'text-zinc-400'
                      }`}>
                        {isPositive ? '+' : ''}{formatFiat(player.netFiat, globalCurrency)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
