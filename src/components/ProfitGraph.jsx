import { useMemo, useState } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  ReferenceLine
} from 'recharts';
import { motion } from 'framer-motion';
import { Filter, Activity, TrendingUp, Crosshair, EyeOff, RotateCcw } from 'lucide-react';
import { formatFiat } from '../utils/formatters';

// Neon-infused broadcast color palette
const PLAYER_COLORS = [
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#3b82f6', // blue
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
  '#eab308'  // yellow
];

const DATE_RANGES = [
  { id: 'ALL', label: 'All Time' },
  { id: '30D', label: '30 Days' },
  { id: '90D', label: '90 Days' },
  { id: 'YTD', label: 'This Year' }
];

export default function ProfitGraph({ 
  games = [], 
  exchangeRates = {}, 
  globalCurrency = 'USD', 
  getPlayerDisplayName 
}) {
  const [dateRange, setDateRange] = useState('ALL');
  const [viewMode, setViewMode] = useState('CUMULATIVE'); // 'CUMULATIVE' | 'PER_SESSION'
  const [playerPreset, setPlayerPreset] = useState('TOP_5'); // 'TOP_5' | 'TOP_10' | 'ALL'
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());
  const [focusMode, setFocusMode] = useState(false); // false = omit on click, true = solo view on click
  const [focusedPlayer, setFocusedPlayer] = useState(null);

  // Filter games based on selected date range
  const filteredGames = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    if (dateRange === 'ALL') return safeGames;

    const now = new Date();
    let cutoffDate = new Date(0);

    if (dateRange === '30D') {
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (dateRange === '90D') {
      cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (dateRange === 'YTD') {
      cutoffDate = new Date(now.getFullYear(), 0, 1);
    }

    return safeGames.filter(g => {
      if (!g || !g.date) return false;
      return new Date(g.date).getTime() >= cutoffDate.getTime();
    });
  }, [games, dateRange]);

  // Process data for the chart
  const { chartData, rankedProfiles, playerColorMap, allProfilesInScope } = useMemo(() => {
    // 1. Sort games chronologically
    const sortedGames = [...filteredGames].sort((a, b) => {
      const dateA = a?.date ? new Date(a.date).getTime() : 0;
      const dateB = b?.date ? new Date(b.date).getTime() : 0;
      return dateA - dateB;
    });

    // 2. Track player cumulative and per-session metrics
    const profileSet = new Set();
    const playerTotalProfit = {};

    sortedGames.forEach(game => {
      if (!game) return;
      const gameCurrency = game.currency || 'USD';
      const chipValue = Number(game.chipValue) || 1;
      const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
        ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
        : 1;
      const chipToFiatMultiplier = chipValue * rateToGlobal;

      const entries = Array.isArray(game.entries) ? game.entries : [];
      entries.forEach(entry => {
        if (!entry || !entry.name) return;
        const profileName = getPlayerDisplayName ? getPlayerDisplayName(entry.name, entry.externalId || entry.pokerNowId, true) : null;
        if (!profileName) return;

        profileSet.add(profileName);

        const buyIn = Number(entry.buyIn) || 0;
        const buyOut = Number(entry.buyOut) || 0;
        const stack = Number(entry.stack) || 0;
        const sessionNet = ((buyOut + stack) - buyIn) * chipToFiatMultiplier;

        playerTotalProfit[profileName] = (playerTotalProfit[profileName] || 0) + sessionNet;
      });
    });

    const allProfiles = Array.from(profileSet);

    // Rank profiles by net profit to pick Top 5 / Top 10
    const sortedByRank = [...allProfiles].sort((a, b) => {
      return (playerTotalProfit[b] || 0) - (playerTotalProfit[a] || 0);
    });

    // Color mapping
    const colorMap = {};
    sortedByRank.forEach((p, idx) => {
      colorMap[p] = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    });

    // Build timeline points
    const dateMap = {};
    const runningTotals = {};
    allProfiles.forEach(p => { runningTotals[p] = 0; });

    sortedGames.forEach(game => {
      if (!game || !game.date) return;
      const dateStr = game.date;
      if (!dateMap[dateStr]) dateMap[dateStr] = {};

      const gameCurrency = game.currency || 'USD';
      const chipValue = Number(game.chipValue) || 1;
      const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
        ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
        : 1;
      const chipToFiatMultiplier = chipValue * rateToGlobal;

      const entries = Array.isArray(game.entries) ? game.entries : [];
      entries.forEach(entry => {
        if (!entry || !entry.name) return;
        const profileName = getPlayerDisplayName ? getPlayerDisplayName(entry.name, entry.externalId || entry.pokerNowId, true) : null;
        if (!profileName) return;

        const buyIn = Number(entry.buyIn) || 0;
        const buyOut = Number(entry.buyOut) || 0;
        const stack = Number(entry.stack) || 0;
        const sessionNet = ((buyOut + stack) - buyIn) * chipToFiatMultiplier;

        dateMap[dateStr][profileName] = (dateMap[dateStr][profileName] || 0) + sessionNet;
      });
    });

    const sortedDates = Object.keys(dateMap).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

    const dataPoints = sortedDates.map(date => {
      const point = { date };
      allProfiles.forEach(profile => {
        const sessionNet = dateMap[date][profile];
        if (sessionNet !== undefined) {
          runningTotals[profile] += sessionNet;
        }

        if (viewMode === 'CUMULATIVE') {
          point[profile] = Number(runningTotals[profile].toFixed(2));
        } else {
          // Per-session mode: exact delta for this date, or null if didn't play
          point[profile] = sessionNet !== undefined ? Number(sessionNet.toFixed(2)) : null;
        }
      });
      return point;
    });

    return {
      chartData: dataPoints,
      rankedProfiles: sortedByRank,
      playerColorMap: colorMap,
      allProfilesInScope: allProfiles
    };
  }, [filteredGames, exchangeRates, globalCurrency, getPlayerDisplayName, viewMode]);

  // Determine active displayed profiles based on preset & manual toggles
  const activeProfiles = useMemo(() => {
    let baseList = rankedProfiles;
    if (playerPreset === 'TOP_5') {
      baseList = rankedProfiles.slice(0, 5);
    } else if (playerPreset === 'TOP_10') {
      baseList = rankedProfiles.slice(0, 10);
    }

    // In focus mode, if a player is selected, show only that player
    if (focusMode && focusedPlayer) {
      return baseList.includes(focusedPlayer) ? [focusedPlayer] : [focusedPlayer];
    }

    return baseList.filter(p => !hiddenPlayers.has(p));
  }, [rankedProfiles, playerPreset, hiddenPlayers, focusMode, focusedPlayer]);

  const handlePlayerClick = (profile) => {
    if (focusMode) {
      // Solo view mode: toggle isolating this player
      setFocusedPlayer(prev => (prev === profile ? null : profile));
    } else {
      // Omit mode: toggle hiding this player
      setHiddenPlayers(prev => {
        const next = new Set(prev);
        if (next.has(profile)) next.delete(profile);
        else next.add(profile);
        return next;
      });
    }
  };

  const handleToggleFocusMode = () => {
    setFocusMode(prev => {
      const nextMode = !prev;
      if (!nextMode) {
        setFocusedPlayer(null);
      }
      return nextMode;
    });
  };

  const handleResetFilters = () => {
    setHiddenPlayers(new Set());
    setFocusedPlayer(null);
  };

  // Custom HUD Tooltip
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;

    const sortedPayload = [...payload]
      .filter(item => item.value !== null && item.value !== undefined)
      .sort((a, b) => Number(b.value) - Number(a.value));

    return (
      <div className="bg-black/90 border border-white/20 p-3.5 backdrop-blur-xl shadow-2xl space-y-2 text-xs font-sans hud-corner-reticle min-w-[200px]">
        <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1">
          <span className="font-mono text-zinc-400 font-semibold">{label}</span>
          <span className="text-[10px] uppercase font-bold tracking-wider text-cyan-400">
            {viewMode === 'CUMULATIVE' ? 'Running Total' : 'Session Delta'}
          </span>
        </div>
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {sortedPayload.map(entry => {
            const val = Number(entry.value);
            const isPos = val > 0;
            const isNeg = val < 0;
            return (
              <div key={entry.dataKey} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-1.5 truncate max-w-[130px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-zinc-200 truncate font-medium">{entry.name}</span>
                </div>
                <span className={`font-mono tabular-nums font-bold ${
                  isPos ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' :
                  isNeg ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' :
                  'text-zinc-400'
                }`}>
                  {isPos ? '+' : ''}{formatFiat(val, globalCurrency)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (allProfilesInScope.length === 0 || chartData.length === 0) {
    return (
      <div className="hud-corner-reticle bg-hud-card/70 border border-white/10 p-8 text-center text-zinc-500 backdrop-blur-md">
        <p className="font-sans text-sm">No session data available for the selected timeframe.</p>
      </div>
    );
  }

  const visibleRanked = rankedProfiles.slice(0, playerPreset === 'TOP_5' ? 5 : playerPreset === 'TOP_10' ? 10 : 25);
  const hasActiveOverrides = hiddenPlayers.size > 0 || focusedPlayer !== null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 sm:p-6 backdrop-blur-xl shadow-2xl space-y-5"
    >
      {/* Top Header & View Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight font-sans uppercase">
              Global Profit & Loss Telemetry
            </h2>
          </div>
          <p className="text-xs text-zinc-400 font-sans mt-0.5">
            {viewMode === 'CUMULATIVE' ? 'Cumulative trajectory' : 'Per-session volatility'} across master player profiles ({globalCurrency})
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Mode Switch */}
          <div className="flex bg-black/60 border border-white/10 p-0.5 rounded-none">
            <button
              onClick={() => setViewMode('CUMULATIVE')}
              className={`px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                viewMode === 'CUMULATIVE'
                  ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Cumulative
            </button>
            <button
              onClick={() => setViewMode('PER_SESSION')}
              className={`px-2.5 py-1 text-xs font-semibold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                viewMode === 'PER_SESSION'
                  ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Per-Session
            </button>
          </div>

          {/* Date Range Selector */}
          <div className="flex bg-black/60 border border-white/10 p-0.5 rounded-none">
            {DATE_RANGES.map(range => (
              <button
                key={range.id}
                onClick={() => setDateRange(range.id)}
                className={`px-2 py-1 text-xs font-mono font-medium transition-all ${
                  dateRange === range.id
                    ? 'bg-zinc-800 text-white font-bold border border-white/20'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* Player Presets */}
          <div className="flex bg-black/60 border border-white/10 p-0.5 rounded-none">
            {['TOP_5', 'TOP_10', 'ALL'].map(preset => (
              <button
                key={preset}
                onClick={() => {
                  setPlayerPreset(preset);
                  setFocusedPlayer(null);
                }}
                className={`px-2 py-1 text-xs font-mono font-medium transition-all ${
                  playerPreset === preset
                    ? 'bg-zinc-800 text-white font-bold border border-white/20'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {preset === 'TOP_5' ? 'Top 5' : preset === 'TOP_10' ? 'Top 10' : 'All'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Interactive Player Visibility Chips & Mode Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* Player Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mr-1 flex items-center gap-1">
            <Filter className="w-3 h-3 text-zinc-400" /> Filter:
          </span>
          {visibleRanked.map(profile => {
            const isHidden = !focusMode && hiddenPlayers.has(profile);
            const isSoloActive = focusMode && focusedPlayer === profile;
            const isSoloDimmed = focusMode && focusedPlayer !== null && focusedPlayer !== profile;
            const color = playerColorMap[profile];

            return (
              <button
                key={profile}
                onClick={() => handlePlayerClick(profile)}
                className={`text-xs px-2.5 py-1 border transition-all flex items-center gap-1.5 font-sans ${
                  isSoloActive
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold shadow-[0_0_10px_rgba(245,158,11,0.4)]'
                    : isSoloDimmed
                    ? 'bg-black/30 border-white/5 text-zinc-600 opacity-40 hover:opacity-80'
                    : isHidden
                    ? 'bg-black/30 border-white/5 text-zinc-600 line-through opacity-50 hover:opacity-80'
                    : 'bg-black/70 border-white/20 text-zinc-200 hover:border-white/40 shadow-sm'
                }`}
                title={focusMode ? `Click to isolate ${profile}` : `Click to hide/show ${profile}`}
              >
                <span 
                  className="w-2 h-2 rounded-full" 
                  style={{ 
                    backgroundColor: (!isHidden && !isSoloDimmed) ? color : '#52525b',
                    boxShadow: (!isHidden && !isSoloDimmed) ? `0 0 6px ${color}` : 'none'
                  }} 
                />
                <span className="truncate max-w-[120px] font-medium">{profile}</span>
              </button>
            );
          })}

          {hasActiveOverrides && (
            <button
              onClick={handleResetFilters}
              className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 px-2 py-1 border border-dashed border-white/20 hover:border-white/40 flex items-center gap-1 transition-all ml-1 bg-black/40"
              title="Reset all filters"
            >
              <RotateCcw className="w-2.5 h-2.5" />
              Reset
            </button>
          )}
        </div>

        {/* Thematic Solo / Omit Switch in Right Red Box Area */}
        <div className="flex items-center shrink-0">
          <div className="flex items-center bg-black/70 border border-white/10 p-0.5 rounded-none shadow-sm">
            <button
              onClick={() => {
                if (focusMode) handleToggleFocusMode();
              }}
              className={`px-2.5 py-1 text-[11px] font-mono font-medium uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                !focusMode
                  ? 'bg-zinc-800 text-zinc-200 border border-white/20 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Clicking a name chip hides/omits that player from the graph"
            >
              <EyeOff className="w-3 h-3 text-zinc-400" />
              <span>Omit Mode</span>
            </button>
            <button
              onClick={() => {
                if (!focusMode) handleToggleFocusMode();
              }}
              className={`px-2.5 py-1 text-[11px] font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                focusMode
                  ? 'bg-amber-950/80 text-amber-400 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Clicking a name chip isolates only that player's data"
            >
              <Crosshair className={`w-3 h-3 ${focusMode ? 'text-amber-400 animate-pulse' : 'text-zinc-500'}`} />
              <span>Solo View</span>
            </button>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="w-full h-[420px] pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 20 }}>
            <CartesianGrid 
              strokeDasharray="2 4" 
              stroke="#27272a" 
              vertical={false} 
              opacity={0.6}
            />
            
            <ReferenceLine y={0} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />

            <XAxis 
              dataKey="date" 
              stroke="#71717a" 
              fontSize={11} 
              tickLine={false} 
              axisLine={{ stroke: '#27272a' }} 
              dy={12}
              fontFamily="monospace"
            />
            
            <YAxis 
              stroke="#71717a" 
              fontSize={11} 
              tickLine={false} 
              axisLine={{ stroke: '#27272a' }}
              tickFormatter={(val) => formatFiat(val, globalCurrency)}
              width={75}
              fontFamily="monospace"
              dx={-6}
            />

            <Tooltip content={<CustomTooltip />} />

            {activeProfiles.map(profile => {
              const color = playerColorMap[profile] || '#10b981';
              return (
                <Line
                  key={profile}
                  type="natural"
                  dataKey={profile}
                  name={profile}
                  stroke={color}
                  strokeWidth={focusMode && focusedPlayer === profile ? 3.5 : 2}
                  dot={{ r: 3, fill: color, stroke: '#09090b', strokeWidth: 1.5 }}
                  activeDot={{ 
                    r: 6, 
                    fill: color, 
                    stroke: '#ffffff', 
                    strokeWidth: 2,
                    boxShadow: `0 0 10px ${color}`
                  }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
