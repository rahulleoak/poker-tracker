import { History, DollarSign, Users } from 'lucide-react';
import MetricCard from './MetricCard';
import { formatFiat } from '../utils/formatters';

export default function Dashboard({ stats, totalSessions, totalMoney, globalCurrency, onPlayerClick }) {
  const topWinner = stats.length > 0 && stats[0].netFiat > 0 ? stats[0] : null;
  const topLoser = stats.length > 0 && stats[stats.length - 1].netFiat < 0 ? stats[stats.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Sessions" value={totalSessions} icon={<History className="w-5 h-5 text-blue-400" />} />
        <MetricCard title={`Money Wagered (${globalCurrency})`} value={formatFiat(totalMoney, globalCurrency)} icon={<DollarSign className="w-5 h-5 text-emerald-400" />} />
        <MetricCard 
          title="Top Shark" 
          value={topWinner ? topWinner.name : '-'} 
          subtitle={topWinner ? `+${formatFiat(topWinner.netFiat, globalCurrency)}` : ''}
          icon={<Users className="w-5 h-5 text-amber-400" />} 
        />
        <MetricCard 
          title="Biggest Donor" 
          value={topLoser ? topLoser.name : '-'} 
          subtitle={topLoser ? `${formatFiat(topLoser.netFiat, globalCurrency)}` : ''}
          valueColor="text-rose-400"
          icon={<Users className="w-5 h-5 text-rose-400" />} 
        />
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
                <th className="p-4 font-medium text-right">Total In</th>
                <th className="p-4 font-medium text-right">Total Out</th>
                <th className="p-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {stats.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">No data available yet. Play some games!</td>
                </tr>
              ) : (
                stats.map((player, index) => (
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
                    <td className="p-4 text-right text-slate-400">{formatFiat(player.buyInFiat, globalCurrency)}</td>
                    <td className="p-4 text-right text-slate-400">{formatFiat(player.cashOutFiat, globalCurrency)}</td>
                    <td className={`p-4 text-right font-bold ${player.netFiat > 0 ? 'text-emerald-400' : player.netFiat < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {player.netFiat > 0 ? '+' : ''}{formatFiat(player.netFiat, globalCurrency)}
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
