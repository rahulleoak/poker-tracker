import { useMemo } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { formatFiat } from '../utils/formatters';

// Distinct, vibrant color palette for master player lines
const PLAYER_COLORS = [
  '#10b981', // emerald-500
  '#3b82f6', // blue-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#eab308'  // yellow-500
];

export default function ProfitGraph({ games = [], exchangeRates = {}, globalCurrency = 'USD', getPlayerDisplayName }) {
  // Aggregate daily P/L per master player profile
  const { chartData, masterProfiles } = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    
    // 1. Collect all distinct master profiles and sort games chronologically
    const profileSet = new Set();
    const sortedGames = [...safeGames].sort((a, b) => {
      const dateA = a?.date ? new Date(a.date).getTime() : 0;
      const dateB = b?.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    sortedGames.forEach(game => {
      if (!game) return;
      const entries = Array.isArray(game.entries) ? game.entries : [];
      entries.forEach(entry => {
        if (!entry || !entry.name) return;
        const profileName = getPlayerDisplayName ? getPlayerDisplayName(entry.name, entry.externalId || entry.pokerNowId) : entry.name;
        if (profileName) {
          profileSet.add(profileName);
        }
      });
    });

    const profiles = Array.from(profileSet);

    // 2. Build chronological date timeline and accumulate running totals
    const dateMap = {}; // date -> { [profileName]: netFiatForSession }
    const cumulativeTotals = {}; // profileName -> runningSum

    profiles.forEach(p => {
      cumulativeTotals[p] = 0;
    });

    sortedGames.forEach(game => {
      if (!game || !game.date) return;
      const dateStr = game.date;
      
      if (!dateMap[dateStr]) {
        dateMap[dateStr] = {};
      }

      const gameCurrency = game.currency || 'USD';
      const chipValue = Number(game.chipValue) || 1;
      const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
        ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
        : 1;
      const chipToFiatMultiplier = chipValue * rateToGlobal;

      const entries = Array.isArray(game.entries) ? game.entries : [];
      entries.forEach(entry => {
        if (!entry || !entry.name) return;
        const profileName = getPlayerDisplayName ? getPlayerDisplayName(entry.name, entry.externalId || entry.pokerNowId) : entry.name;
        if (!profileName) return;

        const buyIn = Number(entry.buyIn) || 0;
        const buyOut = Number(entry.buyOut) || 0;
        const stack = Number(entry.stack) || 0;
        const sessionNetFiat = ((buyOut + stack) - buyIn) * chipToFiatMultiplier;

        // If multiple games occur on the same date, sum them up for that date
        if (!dateMap[dateStr][profileName]) {
          dateMap[dateStr][profileName] = 0;
        }
        dateMap[dateStr][profileName] += sessionNetFiat;
      });
    });

    const sortedDates = Object.keys(dateMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const dataPoints = sortedDates.map(date => {
      const point = { date };
      profiles.forEach(profile => {
        if (dateMap[date][profile] !== undefined) {
          cumulativeTotals[profile] += dateMap[date][profile];
        }
        // Carry forward previous cumulative total (or 0 if never played yet)
        point[profile] = Number(cumulativeTotals[profile].toFixed(2));
      });
      return point;
    });

    return { chartData: dataPoints, masterProfiles: profiles };
  }, [games, exchangeRates, globalCurrency, getPlayerDisplayName]);

  if (masterProfiles.length === 0 || chartData.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-500 shadow-xl">
        <p>No player profile data available for profit graph.</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100">Global Profit / Loss Trend</h2>
          <p className="text-xs text-slate-500">Cumulative net {globalCurrency} across all master player profiles over time</p>
        </div>
      </div>

      <div className="w-full h-[400px] pt-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
            <XAxis 
              dataKey="date" 
              stroke="#64748b" 
              fontSize={12} 
              tickLine={false} 
              axisLine={{ stroke: '#334155' }} 
              dy={10}
            />
            <YAxis 
              stroke="#64748b" 
              fontSize={12} 
              tickLine={false} 
              axisLine={{ stroke: '#334155' }}
              tickFormatter={(val) => formatFiat(val, globalCurrency)}
              width={80}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#f8fafc', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.5)' }}
              formatter={(value, name) => [formatFiat(value, globalCurrency), name]}
              labelStyle={{ color: '#94a3b8', fontWeight: 'bold', marginBottom: '4px' }}
            />
            <Legend 
              wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }}
              formatter={(value) => <span className="text-slate-300 font-medium mr-2">{value}</span>}
            />
            {masterProfiles.map((profile, idx) => (
              <Line
                key={profile}
                type="monotone"
                dataKey={profile}
                name={profile}
                stroke={PLAYER_COLORS[idx % PLAYER_COLORS.length]}
                strokeWidth={2.5}
                dot={{ r: 3, fill: PLAYER_COLORS[idx % PLAYER_COLORS.length] }}
                activeDot={{ r: 6, stroke: '#0f172a', strokeWidth: 2 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
