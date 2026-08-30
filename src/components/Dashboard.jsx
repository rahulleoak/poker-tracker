import { History, DollarSign, Crown, HeartHandshake } from 'lucide-react';
import MetricCard from './MetricCard';
import ProfitGraph from './ProfitGraph';
import { formatFiat } from '../utils/formatters';

export default function Dashboard({ stats = [], totalSessions = 0, totalMoney = 0, globalCurrency = 'USD', onPlayerClick, games = [], exchangeRates = {}, getPlayerDisplayName }) {
  const safeStats = Array.isArray(stats) ? stats : [];
  const topWinner = safeStats.length > 0 && safeStats[0]?.netFiat > 0 ? safeStats[0] : null;
  const topLoser = safeStats.length > 0 && safeStats[safeStats.length - 1]?.netFiat < 0 ? safeStats[safeStats.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard title="Total Sessions" value={totalSessions} icon={<History className="w-5 h-5 text-[var(--text-primary)]" />} />
        <MetricCard title={`Money Wagered (${globalCurrency})`} value={formatFiat(totalMoney, globalCurrency)} icon={<DollarSign className="w-5 h-5 text-[var(--text-primary)]" />} />
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
        <div 
          onClick={() => topWinner && topWinner.name && onPlayerClick && onPlayerClick(topWinner.name)}
          className="bg-[var(--bg-nav)] border border-[var(--text-primary)]/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-[var(--text-primary)]/50 hover:shadow-[var(--text-primary)]/5 transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--text-primary)]/5 rounded-full blur-3xl group-hover:bg-[var(--text-primary)]/10 transition-colors"></div>
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--text-primary)]/10 text-[var(--text-primary)] text-xs font-semibold border border-[var(--text-primary)]/20">
                🏆 Top Shark
              </span>
              <div>
                <h3 className="text-3xl font-extrabold text-[var(--text-main)] group-hover:text-[var(--text-primary)] transition-colors">
                  {topWinner ? topWinner.name : 'No Shark Yet'}
                </h3>
                <p className="text-slate-400 text-sm mt-1">Dominating the table</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-[var(--text-primary)]">
                  {topWinner ? `+${formatFiat(topWinner.netFiat, globalCurrency)}` : '-'}
                </span>
                <span className="text-slate-500 text-xs">all-time net profit</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-[var(--text-primary)]/10 rounded-2xl flex items-center justify-center border border-[var(--text-primary)]/20 group-hover:scale-110 transition-transform duration-300 shrink-0">
              <Crown className="w-8 h-8 text-[var(--text-primary)]" />
            </div>
          </div>
        </div>

        {/* Biggest Donor Podium */}
        <div 
          onClick={() => topLoser && topLoser.name && onPlayerClick && onPlayerClick(topLoser.name)}
          className="bg-[var(--bg-nav)] border border-[var(--text-secondary)]/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-[var(--text-secondary)]/50 hover:shadow-[var(--text-secondary)]/5 transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--text-secondary)]/5 rounded-full blur-3xl group-hover:bg-[var(--text-secondary)]/10 transition-colors"></div>
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--text-secondary)]/10 text-[var(--text-secondary)] text-xs font-semibold border border-[var(--text-secondary)]/20">
                🎁 Biggest Donor
              </span>
              <div>
                <h3 className="text-3xl font-extrabold text-[var(--text-main)] group-hover:text-[var(--text-secondary)] transition-colors">
                  {topLoser ? topLoser.name : 'No Donor Yet'}
                </h3>
                <p className="text-slate-400 text-sm mt-1">Keeping the game alive</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-[var(--text-secondary)]">
                  {topLoser ? formatFiat(topLoser.netFiat, globalCurrency) : '-'}
                </span>
                <span className="text-slate-500 text-xs">all-time contribution</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-[var(--text-secondary)]/10 rounded-2xl flex items-center justify-center border border-[var(--text-secondary)]/20 group-hover:scale-110 transition-transform duration-300 shrink-0">
              <HeartHandshake className="w-8 h-8 text-[var(--text-secondary)]" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[var(--bg-nav)] border border-[var(--border-color)] rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-[var(--border-color)] flex justify-between items-center">
          <h2 className="text-lg font-bold text-[var(--text-main)]">All-Time Leaderboard</h2>
          <p className="text-xs text-slate-500">Click a player for details</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-slate-400 text-sm">
                <th className="p-4 font-medium">Rank</th>
                <th className="p-4 font-medium">Player</th>
                <th className="p-4 font-medium text-right">Games</th>
                <th className="p-4 font-medium text-right">VPIP</th>
                <th className="p-4 font-medium text-right">PFR</th>
                <th className="p-4 font-medium text-right">3-Bet</th>
                <th className="p-4 font-medium text-right">Total In</th>
                <th className="p-4 font-medium text-right">Total Out</th>
                <th className="p-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {safeStats.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-slate-500">No data available yet. Play some games!</td>
                </tr>
              ) : (
                safeStats.map((player, index) => {
                  if (!player) return null;

                  const handsPlayed = Number(player.handsPlayed) || 0;
                  const vpipHands = Number(player.vpipHands) || 0;
                  const pfrHands = Number(player.pfrHands) || 0;
                  const threeBetOpps = Number(player.threeBetOpps) || 0;
                  const threeBetHands = Number(player.threeBetHands) || 0;

                  const vpipPct = handsPlayed > 0 ? `${((vpipHands / handsPlayed) * 100).toFixed(1)}%` : '-';
                  const pfrPct = handsPlayed > 0 ? `${((pfrHands / handsPlayed) * 100).toFixed(1)}%` : '-';
                  const threeBetPct = threeBetOpps > 0 ? `${((threeBetHands / threeBetOpps) * 100).toFixed(1)}%` : '-';
                  
                  return (
                    <tr 
                      key={player.name || index} 
                      onClick={() => player.name && onPlayerClick && onPlayerClick(player.name)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      <td className="p-4 font-medium text-slate-500">#{index + 1}</td>
                      <td className="p-4 font-semibold text-[var(--text-main)] group-hover:text-[var(--text-primary)] transition-colors flex items-center gap-2">
                        {player.name || 'Unknown'}
                      </td>
                      <td className="p-4 text-right text-slate-400">{player.gamesPlayed || 0}</td>
                      <td className="p-4 text-right text-slate-400">{vpipPct}</td>
                      <td className="p-4 text-right text-slate-400">{pfrPct}</td>
                      <td className="p-4 text-right text-slate-400">{threeBetPct}</td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(player.buyInFiat, globalCurrency)}</td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(player.cashOutFiat, globalCurrency)}</td>
                      <td className={`p-4 text-right font-bold ${(player.netFiat || 0) > 0 ? 'text-[var(--text-primary)]' : (player.netFiat || 0) < 0 ? 'text-[var(--text-secondary)]' : 'text-slate-400'}`}>
                        {(player.netFiat || 0) > 0 ? '+' : ''}{formatFiat(player.netFiat, globalCurrency)}
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
