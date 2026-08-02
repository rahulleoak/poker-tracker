import { History, DollarSign, Crown, HeartHandshake } from 'lucide-react';
import MetricCard from './MetricCard';
import { formatFiat } from '../utils/formatters';

export default function Dashboard({ stats, totalSessions, totalMoney, globalCurrency, onPlayerClick }) {
  const topWinner = stats.length > 0 && stats[0].netFiat > 0 ? stats[0] : null;
  const topLoser = stats.length > 0 && stats[stats.length - 1].netFiat < 0 ? stats[stats.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Overview Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard title="Total Sessions" value={totalSessions} icon={<History className="w-5 h-5 text-indigo-400" />} />
        <MetricCard title={`Money Wagered (${globalCurrency})`} value={formatFiat(totalMoney, globalCurrency)} icon={<DollarSign className="w-5 h-5 text-emerald-400" />} />
      </div>

      {/* Hall of Fame Podiums */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Shark Podium */}
        <div 
          onClick={() => topWinner && onPlayerClick(topWinner.name)}
          className="bg-slate-900 border border-emerald-500/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-emerald-500/50 hover:shadow-emerald-500/5 transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-3xl group-hover:bg-emerald-500/10 transition-colors"></div>
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
                🏆 Top Shark
              </span>
              <div>
                <h3 className="text-3xl font-extrabold text-slate-100 group-hover:text-emerald-400 transition-colors">
                  {topWinner ? topWinner.name : 'No Shark Yet'}
                </h3>
                <p className="text-slate-400 text-sm mt-1">Dominating the table</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-400">
                  {topWinner ? `+${formatFiat(topWinner.netFiat, globalCurrency)}` : '-'}
                </span>
                <span className="text-slate-500 text-xs">all-time net profit</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center border border-emerald-500/20 group-hover:scale-110 transition-transform duration-300 shrink-0">
              <Crown className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Biggest Donor Podium */}
        <div 
          onClick={() => topLoser && onPlayerClick(topLoser.name)}
          className="bg-slate-900 border border-rose-500/20 rounded-2xl p-6 shadow-2xl relative overflow-hidden group cursor-pointer hover:border-rose-500/50 hover:shadow-rose-500/5 transition-all duration-300"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/5 rounded-full blur-3xl group-hover:bg-rose-500/10 transition-colors"></div>
          <div className="flex items-start justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 text-xs font-semibold border border-rose-500/20">
                🎁 Biggest Donor
              </span>
              <div>
                <h3 className="text-3xl font-extrabold text-slate-100 group-hover:text-rose-400 transition-colors">
                  {topLoser ? topLoser.name : 'No Donor Yet'}
                </h3>
                <p className="text-slate-400 text-sm mt-1">Keeping the game alive</p>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">
                  {topLoser ? formatFiat(topLoser.netFiat, globalCurrency) : '-'}
                </span>
                <span className="text-slate-500 text-xs">all-time contribution</span>
              </div>
            </div>
            <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 group-hover:scale-110 transition-transform duration-300 shrink-0">
              <HeartHandshake className="w-8 h-8 text-rose-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-100">All-Time Leaderboard</h2>
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
              {stats.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-slate-500">No data available yet. Play some games!</td>
                </tr>
              ) : (
                stats.map((player, index) => {
                  const vpipPct = player.handsPlayed > 0 ? `${((player.vpipHands / player.handsPlayed) * 100).toFixed(1)}%` : '-';
                  const pfrPct = player.handsPlayed > 0 ? `${((player.pfrHands / player.handsPlayed) * 100).toFixed(1)}%` : '-';
                  const threeBetPct = player.threeBetOpps > 0 ? `${((player.threeBetHands / player.threeBetOpps) * 100).toFixed(1)}%` : '-';
                  
                  return (
                    <tr 
                      key={player.name} 
                      onClick={() => onPlayerClick(player.name)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      <td className="p-4 font-medium text-slate-500">#{index + 1}</td>
                      <td className="p-4 font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors flex items-center gap-2">
                        {player.name}
                      </td>
                      <td className="p-4 text-right text-slate-400">{player.gamesPlayed}</td>
                      <td className="p-4 text-right text-slate-400">{vpipPct}</td>
                      <td className="p-4 text-right text-slate-400">{pfrPct}</td>
                      <td className="p-4 text-right text-slate-400">{threeBetPct}</td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(player.buyInFiat, globalCurrency)}</td>
                      <td className="p-4 text-right text-slate-400">{formatFiat(player.cashOutFiat, globalCurrency)}</td>
                      <td className={`p-4 text-right font-bold ${player.netFiat > 0 ? 'text-emerald-400' : player.netFiat < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                        {player.netFiat > 0 ? '+' : ''}{formatFiat(player.netFiat, globalCurrency)}
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
