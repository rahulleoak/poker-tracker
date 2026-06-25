import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, 
  History, 
  Plus, 
  Minus,
  Users, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  Trash2,
  ChevronLeft,
  Upload,
  TrendingUp,
  TrendingDown,
  Settings,
  X,
  Coins,
  Globe,
  Landmark
} from 'lucide-react';

// --- SUPABASE INIT ---
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- CONSTANTS ---
const TOP_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD',
  'SEK', 'KRW', 'SGD', 'NOK', 'MXN', 'INR', 'RUB', 'ZAR', 'BRL', 'TRY'
];

// Helper to format fiat money safely
const formatFiat = (amount, currencyCode) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
  } catch (e) {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
};

// Helper to format chips safely
const formatChips = (amount) => {
  return new Intl.NumberFormat('en-US').format(amount);
};

// --- POKER NOW CSV PARSER ---
function parsePokerNowCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return [];
  const players = {}; 

  const getPlayer = (rawName) => {
    const cleanName = rawName.split(' @ ')[0].trim();
    if (!players[cleanName]) {
      players[cleanName] = { buyIn: 0, buyOut: 0, stack: 0 };
    }
    return players[cleanName];
  };

  const header = lines[0].toLowerCase();
  
  if (header.includes('player_nickname') && header.includes('buy_in')) {
    const headerCols = lines[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
    const nameIdx = headerCols.indexOf('player_nickname');
    const buyInIdx = headerCols.indexOf('buy_in');
    const buyOutIdx = headerCols.indexOf('buy_out');

    if (nameIdx > -1 && buyInIdx > -1) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length > Math.max(nameIdx, buyInIdx, buyOutIdx)) {
          const buyIn = parseFloat(cols[buyInIdx]) || 0;
          const cashOut = parseFloat(cols[buyOutIdx]) || 0;
          if (buyIn > 0 || cashOut > 0) {
            const p = getPlayer(cols[nameIdx]);
            p.buyIn += buyIn;
            p.stack += cashOut;
          }
        }
      }
    }
  } else {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      let m = line.match(/approved the player "([^"]+)" participation with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/approved the player "([^"]+)" requested stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" sits down with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" quits the game with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).stack += parseInt(m[2], 10);
      m = line.match(/player "([^"]+)" stands up with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).stack += parseInt(m[2], 10);
      m = line.match(/updated the player "([^"]+)" stack from (\d+) to (\d+)/i);
      if (m) {
        const from = parseInt(m[2], 10);
        const to = parseInt(m[3], 10);
        if (to > from) getPlayer(m[1]).buyIn += (to - from);
        if (from > to) getPlayer(m[1]).stack += (from - to);
      }
    }
  }

  return Object.entries(players).map(([name, data]) => ({
    name,
    buyIn: data.buyIn,
    buyOut: data.buyOut,
    stack: data.stack
  })).filter(p => p.buyIn > 0 || p.stack > 0 || p.buyOut > 0);
}

export default function App() {
  const [games, setGames] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [editingGameId, setEditingGameId] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  
  // FX Rates & Global Config
  const [exchangeRates, setExchangeRates] = useState(null);
  const [globalCurrency, setGlobalCurrency] = useState('USD');
  const [globalIncrement, setGlobalIncrement] = useState(100);

  // --- FETCH DATA & FX RATES ---
  useEffect(() => {
    // 1. Fetch live exchange rates
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => {
        if (data && data.rates) setExchangeRates(data.rates);
      })
      .catch(err => console.error("Failed to fetch FX rates:", err));

    // 2. Fetch games from DB
    fetchGames();
  }, []);

  const fetchGames = async () => {
    setIsLoading(true);
    // Added poker_now_url and is_active to select query
    const { data, error } = await supabase
      .from('sessions')
      .select(`
        id,
        date,
        currency,
        chip_value,
        poker_now_url,
        is_active,
        ledger ( player_name, buy_in, cash_out, currency, is_bank )
      `)
      .order('date', { ascending: false });

    if (error) {
      console.error("Error fetching data:", error);
    } else {
      const formattedGames = data.map(session => ({
        id: session.id,
        date: session.date,
        currency: session.currency || 'USD',
        chipValue: Number(session.chip_value) || 1,
        pokerNowUrl: session.poker_now_url || '',
        isActive: session.is_active !== false,
        entries: session.ledger.map(entry => ({
          name: entry.player_name,
          buyIn: Number(entry.buy_in),
          buyOut: 0,
          stack: Number(entry.cash_out),
          currency: entry.currency || session.currency || 'USD',
          isBank: Boolean(entry.is_bank)
        }))
      }));
      setGames(formattedGames);
    }
    setIsLoading(false);
  };

  // --- DERIVED STATS (ALL-TIME FIAT) ---
  const playerStats = useMemo(() => {
    const stats = {};
    games.forEach(game => {
      // Calculate exchange rate multiplier for this specific game to the global dashboard currency
      const rateToGlobal = exchangeRates ? (exchangeRates[globalCurrency] / exchangeRates[game.currency]) : 1;
      const chipToFiatMultiplier = game.chipValue * rateToGlobal;

      game.entries.forEach(entry => {
        if (!stats[entry.name]) {
          stats[entry.name] = { name: entry.name, buyInFiat: 0, cashOutFiat: 0, gamesPlayed: 0, netFiat: 0 };
        }
        const totalCashOutChips = entry.buyOut + entry.stack;
        
        stats[entry.name].buyInFiat += (entry.buyIn * chipToFiatMultiplier);
        stats[entry.name].cashOutFiat += (totalCashOutChips * chipToFiatMultiplier);
        stats[entry.name].netFiat += ((totalCashOutChips - entry.buyIn) * chipToFiatMultiplier);
        stats[entry.name].gamesPlayed += 1;
      });
    });
    return Object.values(stats).sort((a, b) => b.netFiat - a.netFiat);
  }, [games, exchangeRates, globalCurrency]);

  const totalMoneyInPlayFiat = useMemo(() => {
    return games.reduce((sum, game) => {
      const rateToGlobal = exchangeRates ? (exchangeRates[globalCurrency] / exchangeRates[game.currency]) : 1;
      const gameBuyInFiat = game.entries.reduce((s, e) => s + e.buyIn, 0) * game.chipValue * rateToGlobal;
      return sum + gameBuyInFiat;
    }, 0);
  }, [games, exchangeRates, globalCurrency]);

  // --- HANDLERS ---
  const handleCreateGame = async () => {
    const date = new Date().toISOString().split('T')[0];
    
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .insert([{ date, currency: globalCurrency, chip_value: 1, is_active: true }])
      .select()
      .single();

    if (sessionError) return console.error(sessionError);

    const initialEntries = [
      { session_id: sessionData.id, player_name: 'Player 1', buy_in: 0, cash_out: 0, currency: globalCurrency, is_bank: false },
      { session_id: sessionData.id, player_name: 'Player 2', buy_in: 0, cash_out: 0, currency: globalCurrency, is_bank: false }
    ];

    await supabase.from('ledger').insert(initialEntries);
    
    await fetchGames();
    setEditingGameId(sessionData.id);
    setSelectedPlayer(null);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const parsedEntries = parsePokerNowCSV(text);
      
      const date = file.lastModified ? new Date(file.lastModified).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .insert([{ date, currency: globalCurrency, chip_value: 1, is_active: false }])
        .select()
        .single();
        
      if(sessionError) return console.error(sessionError);

      const dbEntries = (parsedEntries.length > 0 ? parsedEntries : [
        { name: 'Player 1', buyIn: 0, buyOut: 0, stack: 0 },
        { name: 'Player 2', buyIn: 0, buyOut: 0, stack: 0 }
      ]).map(entry => ({
        session_id: sessionData.id,
        player_name: entry.name.trim() || 'Unknown',
        buy_in: entry.buyIn || 0,
        cash_out: (entry.buyOut || 0) + (entry.stack || 0),
        currency: globalCurrency,
        is_bank: false
      }));

      await supabase.from('ledger').insert(dbEntries);
      
      await fetchGames();
      setEditingGameId(sessionData.id);
      setSelectedPlayer(null);
    };
    reader.readAsText(file);
    event.target.value = null;
  };

  const handleUpdateGame = async (updatedGame) => {
    setGames(games.map(g => g.id === updatedGame.id ? updatedGame : g));

    await supabase.from('sessions')
      .update({ 
        date: updatedGame.date, 
        currency: updatedGame.currency, 
        chip_value: updatedGame.chipValue,
        poker_now_url: updatedGame.pokerNowUrl,
        is_active: updatedGame.isActive
      })
      .eq('id', updatedGame.id);
      
    await supabase.from('ledger').delete().eq('session_id', updatedGame.id);
    
    const validEntries = updatedGame.entries
      .filter(e => e.name.trim() !== '' || e.buyIn > 0 || e.buyOut > 0 || e.stack > 0)
      .map(e => ({
        session_id: updatedGame.id,
        player_name: e.name.trim() || 'Unknown Player',
        buy_in: e.buyIn || 0,
        cash_out: (e.buyOut || 0) + (e.stack || 0),
        currency: e.currency || updatedGame.currency,
        is_bank: e.isBank || false
      }));

    if (validEntries.length > 0) {
      await supabase.from('ledger').insert(validEntries);
    }
  };

  const handleDeleteGame = async (id) => {
    setGames(games.filter(g => g.id !== id));
    if (editingGameId === id) setEditingGameId(null);
    await supabase.from('sessions').delete().eq('id', id);
  };

  if (isLoading || !exchangeRates) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-emerald-400">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <Coins className="w-12 h-12" />
          <p className="font-bold tracking-widest uppercase">Initializing Vault...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xl tracking-tight">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400">
              <Globe className="w-5 h-5" />
            </div>
            <span>HomeGame Tracker</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Dashboard View:</label>
              <select 
                value={globalCurrency}
                onChange={(e) => setGlobalCurrency(e.target.value)}
                className="bg-slate-950 border border-slate-800 text-emerald-400 text-sm font-bold rounded-lg px-2 py-1 outline-none focus:border-emerald-500 transition-colors"
              >
                {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
              <button 
                onClick={() => { setActiveTab('dashboard'); setEditingGameId(null); setSelectedPlayer(null); }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                  activeTab === 'dashboard' && !editingGameId && !selectedPlayer ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">Dashboard</span>
              </button>
              <button 
                onClick={() => { setActiveTab('games'); setEditingGameId(null); setSelectedPlayer(null); }}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                  (activeTab === 'games' || editingGameId) ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <History className="w-4 h-4" />
                <span className="hidden sm:inline">Sessions</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {editingGameId ? (
          <GameEditor 
            game={games.find(g => g.id === editingGameId)} 
            globalIncrement={globalIncrement}
            setGlobalIncrement={setGlobalIncrement}
            exchangeRates={exchangeRates}
            onSave={handleUpdateGame}
            onBack={() => setEditingGameId(null)}
            onDelete={() => handleDeleteGame(editingGameId)}
          />
        ) : selectedPlayer ? (
          <PlayerProfile 
            playerName={selectedPlayer} 
            games={games} 
            exchangeRates={exchangeRates}
            globalCurrency={globalCurrency}
            onBack={() => setSelectedPlayer(null)} 
          />
        ) : activeTab === 'dashboard' ? (
          <Dashboard stats={playerStats} totalSessions={games.length} totalMoney={totalMoneyInPlayFiat} globalCurrency={globalCurrency} onPlayerClick={setSelectedPlayer} />
        ) : (
          <GamesList games={games} onCreate={handleCreateGame} onFileUpload={handleFileUpload} onEdit={setEditingGameId} exchangeRates={exchangeRates} globalCurrency={globalCurrency} />
        )}
      </main>
    </div>
  );
}

// ==========================================
// COMPONENT: PLAYER PROFILE
// ==========================================
function PlayerProfile({ playerName, games, exchangeRates, globalCurrency, onBack }) {
  const playerHistory = useMemo(() => {
    return games
      .map(game => {
        const entry = game.entries.find(e => e.name === playerName);
        if (entry) {
          const totalCashOutChips = entry.buyOut + entry.stack;
          const netChips = totalCashOutChips - entry.buyIn;
          
          const rateToGlobal = exchangeRates ? (exchangeRates[globalCurrency] / exchangeRates[game.currency]) : 1;
          const multiplier = game.chipValue * rateToGlobal;

          return {
            date: game.date,
            gameId: game.id,
            buyInFiat: entry.buyIn * multiplier,
            cashOutFiat: totalCashOutChips * multiplier,
            netFiat: netChips * multiplier
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date)); 
  }, [playerName, games, exchangeRates, globalCurrency]);

  const totalNet = playerHistory.reduce((sum, s) => sum + s.netFiat, 0);
  const totalBuyIn = playerHistory.reduce((sum, s) => sum + s.buyInFiat, 0);
  const avgBuyIn = playerHistory.length > 0 ? (totalBuyIn / playerHistory.length) : 0;
  
  const bestSession = playerHistory.length > 0 ? playerHistory.reduce((prev, current) => (prev.netFiat > current.netFiat) ? prev : current) : null;
  const worstSession = playerHistory.length > 0 ? playerHistory.reduce((prev, current) => (prev.netFiat < current.netFiat) ? prev : current) : null;

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
                {playerHistory.map((session, index) => (
                  <tr key={index} className="hover:bg-slate-800/20 transition-colors">
                    <td className="p-4 font-medium text-slate-300">
                      {new Date(session.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="p-4 text-right text-slate-400">{formatFiat(session.buyInFiat, globalCurrency)}</td>
                    <td className="p-4 text-right text-slate-400">{formatFiat(session.cashOutFiat, globalCurrency)}</td>
                    <td className={`p-4 text-right font-bold ${session.netFiat > 0 ? 'text-emerald-400' : session.netFiat < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                      {session.netFiat > 0 ? '+' : ''}{formatFiat(session.netFiat, globalCurrency)}
                    </td>
                  </tr>
                ))}
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
                <p className="text-sm text-slate-500">{new Date(bestSession.date).toLocaleDateString()}</p>
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
                <p className="text-sm text-slate-500">{new Date(worstSession.date).toLocaleDateString()}</p>
              </div>
            ) : <p className="text-slate-500">No data.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// COMPONENT: DASHBOARD
// ==========================================
function Dashboard({ stats, totalSessions, totalMoney, globalCurrency, onPlayerClick }) {
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

function MetricCard({ title, value, subtitle, icon, valueColor = "text-slate-100" }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
      <h3 className={`text-2xl font-bold ${valueColor}`}>{value}</h3>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// ==========================================
// COMPONENT: GAMES LIST
// ==========================================
function GamesList({ games, onCreate, onFileUpload, onEdit, exchangeRates, globalCurrency }) {
  const fileInputRef = useRef(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-100">Poker Sessions</h2>
        <div className="flex flex-wrap gap-3">
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={onFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button 
            onClick={onCreate}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            <Plus className="w-4 h-4" />
            Log New Session
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map(game => {
          const totalBuyInChips = game.entries.reduce((sum, e) => sum + e.buyIn, 0);
          const totalCashOutChips = game.entries.reduce((sum, e) => sum + (e.buyOut + e.stack), 0);
          const isBalanced = totalBuyInChips === totalCashOutChips;
          
          // Show pot in the global dashboard currency
          const rateToGlobal = exchangeRates ? (exchangeRates[globalCurrency] / exchangeRates[game.currency]) : 1;
          const potFiat = totalBuyInChips * game.chipValue * rateToGlobal;

          return (
            <div 
              key={game.id} 
              onClick={() => onEdit(game.id)}
              className="bg-slate-900 border border-slate-800 p-5 rounded-xl cursor-pointer hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/10 transition-all group relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-1 h-full ${game.isActive ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-slate-700'}`}></div>
              <div className="flex justify-between items-start mb-4 ml-2">
                <div>
                  <h3 className="font-bold text-slate-200">{new Date(game.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                      <Globe className="w-3 h-3" /> {game.currency}
                    </span>
                    <p className="text-sm text-slate-500">{game.entries.length} Players</p>
                  </div>
                </div>
                {isBalanced ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                )}
              </div>
              <div className="flex justify-between items-center text-sm mt-6 pt-4 border-t border-slate-800/50 ml-2">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Pot Size</span>
                  <span className="font-semibold text-slate-200">{formatFiat(potFiat, globalCurrency)}</span>
                </div>
                <span className="text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 text-xs font-medium">
                  View Ledger <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          );
        })}
        {games.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
            No sessions logged yet. Create your first game!
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENT: GAME EDITOR & SETTLEMENTS
// ==========================================
function GameEditor({ game, globalIncrement, setGlobalIncrement, exchangeRates, onSave, onBack, onDelete }) {
  const [date, setDate] = useState(game.date);
  const [gameCurrency, setGameCurrency] = useState(game.currency);
  
  const [ratioChips, setRatioChips] = useState(() => {
    if (game.chipValue === 1) return 1;
    if (game.chipValue > 0) {
      const inv = 1 / game.chipValue;
      // If 1/chipValue is a clean integer (e.g. 0.01 -> 100), use it visually
      if (Math.abs(inv - Math.round(inv)) < 0.001) return Math.round(inv);
    }
    return 1000; // Default multiplier for complex fractions
  });
  
  const [ratioFiat, setRatioFiat] = useState(() => {
    if (game.chipValue === 1) return 1;
    if (game.chipValue > 0) {
      const inv = 1 / game.chipValue;
      if (Math.abs(inv - Math.round(inv)) < 0.001) return 1;
    }
    return Number((game.chipValue * 1000).toFixed(2));
  });

  const chipValue = ratioChips > 0 ? ratioFiat / ratioChips : 0;

  const [entries, setEntries] = useState(game.entries);
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [settlementCurrency, setSettlementCurrency] = useState(game.currency);
  const [useBankBuddies, setUseBankBuddies] = useState(false);

  // Derived calculations for the current session
  const { totalBuyIn, totalCashOut, isBalanced, settlements, chipsOnTable } = useMemo(() => {
    let tBuyIn = 0;
    let tCashOut = 0;
    const nets = []; // Store the nets in pure CHIPS first

    entries.forEach((e, index) => {
      const buyIn = Number(e.buyIn) || 0;
      const buyOut = Number(e.buyOut) || 0;
      const stack = Number(e.stack) || 0;
      
      const sessionCashOut = buyOut + stack;

      tBuyIn += buyIn;
      tCashOut += sessionCashOut;
      
      const netChips = sessionCashOut - buyIn;
      if (e.name.trim() !== '') {
        nets.push({ name: e.name, netChips, id: index });
      }
    });

    const balanced = tBuyIn === tCashOut && tBuyIn > 0;
    const chipsOnTable = tBuyIn - tCashOut;
    let trans = [];

    // Calculate Settlement in Target Fiat Currency
    if (balanced) {
      // 1. Calculate the conversion rate multiplier for Fiat cash
      const fxRate = exchangeRates ? (exchangeRates[settlementCurrency] / exchangeRates[gameCurrency]) : 1;
      const chipToTargetFiatMultiplier = chipValue * fxRate;

      // 2. Map players to their Fiat balances and regional config
      let playersFiat = nets.map(p => ({
         ...p,
         fiatAmount: p.netChips * chipToTargetFiatMultiplier,
         currency: entries[p.id].currency || gameCurrency,
         isBank: entries[p.id].isBank || false
      }));
      
      if (useBankBuddies) {
          // --- TWO-PHASE BANK BUDDY ALGORITHM ---
          const zones = {};
          playersFiat.forEach(p => {
              if (!zones[p.currency]) zones[p.currency] = { currency: p.currency, players: [], bankBuddy: null, net: 0 };
              zones[p.currency].players.push({...p}); 
              if (p.isBank) zones[p.currency].bankBuddy = p.name;
              zones[p.currency].net += p.fiatAmount;
          });

          const interZoneDebtors = [];
          const interZoneCreditors = [];

          // Separate zones into Macro Debtors & Creditors
          Object.values(zones).forEach(zone => {
              if (zone.bankBuddy) {
                  if (zone.net < -0.01) interZoneDebtors.push({ name: zone.bankBuddy, amount: Math.abs(zone.net) });
                  else if (zone.net > 0.01) interZoneCreditors.push({ name: zone.bankBuddy, amount: zone.net });
              } else {
                  // Fallback: If no bank buddy assigned for this zone, players settle globally as individuals
                  zone.players.forEach(p => {
                      if (p.fiatAmount < -0.01) interZoneDebtors.push({ name: p.name, amount: Math.abs(p.fiatAmount) });
                      else if (p.fiatAmount > 0.01) interZoneCreditors.push({ name: p.name, amount: p.fiatAmount });
                  });
              }
          });

          // PHASE 1: Cross-Border Greedy Settlement
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

              // Adjust the Bank Buddy's personal balance for Phase 2 based on the global payment they just made/received
              Object.values(zones).forEach(z => {
                  if (z.bankBuddy === debtor.name) {
                      const bb = z.players.find(p => p.name === debtor.name);
                      if (bb) bb.fiatAmount += amount; // Paid out of pocket, so the zone owes them more
                  }
                  if (z.bankBuddy === creditor.name) {
                      const bb = z.players.find(p => p.name === creditor.name);
                      if (bb) bb.fiatAmount -= amount; // Received global funds, so they owe the zone more
                  }
              });

              if (debtor.amount < 0.01) d++;
              if (creditor.amount < 0.01) c++;
          }

          // PHASE 2: Local Intra-Zone Greedy Settlement
          Object.values(zones).forEach(zone => {
              if (zone.bankBuddy) { 
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
          // --- STANDARD GREEDY ALGORITHM (Global) ---
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
  }, [entries, chipValue, gameCurrency, settlementCurrency, exchangeRates, useBankBuddies]);

  // Handlers
  const handleEntryChange = (index, field, value) => {
    const newEntries = [...entries];
    newEntries[index][field] = value;
    setEntries(newEntries);
  };
  
  const handleBankChange = (index, isBank, currency) => {
    const newEntries = [...entries];
    if (isBank) {
        // Enforce only one bank buddy per currency region
        newEntries.forEach(e => {
            if ((e.currency || gameCurrency) === currency) e.isBank = false;
        });
    }
    newEntries[index].isBank = isBank;
    setEntries(newEntries);
  };

  const handleAddRow = () => {
    const newEntries = [...entries, { name: '', buyIn: 0, buyOut: 0, stack: 0, currency: 'USD' }];
    setEntries(newEntries);
  };

  const handleRemoveRow = (index) => {
    const newEntries = entries.filter((_, i) => i !== index);
    setEntries(newEntries);
  };

  const handleSaveAndClose = () => {
    onSave({ ...game, date, currency: gameCurrency, chipValue, entries });
    onBack();
  };

  const adjustValue = (index, field, amount) => {
    const currentValue = Number(entries[index][field]) || 0;
    const newValue = Math.max(0, currentValue + amount); 
    handleEntryChange(index, field, newValue);
  };

  const activeCurrenciesInGame = useMemo(() => {
     const set = new Set(entries.filter(e => e.name.trim() !== '').map(e => e.currency || gameCurrency));
     return Array.from(set);
  }, [entries, gameCurrency]);

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300 relative">
      
      {/* Settings Modal Overlay */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
              <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" /> Session Settings
              </h3>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-200 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex border-b border-slate-800 bg-slate-900 shrink-0">
              <button onClick={() => setActiveSettingsTab('general')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeSettingsTab === 'general' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/30' : 'text-slate-500 hover:text-slate-300'}`}>Game Config</button>
              <button onClick={() => setActiveSettingsTab('banks')} className={`flex-1 py-3 text-sm font-medium transition-colors ${activeSettingsTab === 'banks' ? 'text-emerald-400 border-b-2 border-emerald-400 bg-slate-800/30' : 'text-slate-500 hover:text-slate-300'}`}>Bank Buddies</button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {activeSettingsTab === 'general' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Game Date</label>
                    <input 
                      type="date" 
                      value={date} 
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <div className="p-4 rounded-lg bg-slate-950/50 border border-slate-800 space-y-4">
                    <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                      <Coins className="w-4 h-4" /> Chip Economics
                    </h4>
                    
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Native Currency</label>
                      <select 
                        value={gameCurrency}
                        onChange={(e) => setGameCurrency(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 outline-none focus:border-emerald-500 transition-colors"
                      >
                        {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Chip Exchange Ratio</label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input 
                            type="number" 
                            value={ratioChips === 0 ? '' : ratioChips}
                            onChange={(e) => setRatioChips(Number(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg pl-3 pr-8 py-2 outline-none focus:border-emerald-500 transition-colors [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-500 text-sm font-bold">
                            <Coins className="w-4 h-4" />
                          </div>
                        </div>
                        <span className="text-slate-500 font-bold">=</span>
                        <div className="relative flex-1">
                          <input 
                            type="number" 
                            step="0.01"
                            value={ratioFiat === 0 ? '' : ratioFiat}
                            onChange={(e) => setRatioFiat(Number(e.target.value) || 0)}
                            className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg pl-3 pr-10 py-2 outline-none focus:border-emerald-500 transition-colors [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-500 text-sm font-bold">
                            {gameCurrency}
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1.5 text-right">1 🪙 = {chipValue.toFixed(4)} {gameCurrency}</p>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Input Quick-Click Amount (Chips)</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-amber-500/50">
                          <Coins className="w-4 h-4" />
                        </div>
                        <input 
                          type="number" 
                          value={globalIncrement}
                          onChange={(e) => setGlobalIncrement(Number(e.target.value) || 0)}
                          className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg pl-9 pr-3 py-2 outline-none focus:border-emerald-500 transition-colors [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-800">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Poker Now Link</label>
                    <input 
                      type="url"
                      placeholder="https://www.pokernow.club/games/..."
                      value={game.pokerNowUrl || ''}
                      onChange={(e) => onSave({ ...game, pokerNowUrl: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}

              {activeSettingsTab === 'banks' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                   <p className="text-xs text-slate-400 mb-4 bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                     Assign regional currencies and designate a <strong className="text-emerald-400">Bank Buddy</strong>. The algorithm will consolidate cross-border debts so players only transfer money locally.
                   </p>
                   <div className="space-y-2">
                     {entries.filter(e => e.name.trim() !== '').map((entry, idx) => {
                        const trueIdx = entries.indexOf(entry);
                        const pCurrency = entry.currency || gameCurrency;
                        return (
                          <div key={idx} className={`flex items-center justify-between p-3 bg-slate-950/50 border rounded-lg transition-colors ${entry.isBank ? 'border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.1)]' : 'border-slate-800'}`}>
                            <span className="font-semibold text-slate-200 text-sm truncate max-w-[100px]">{entry.name}</span>
                            <div className="flex items-center gap-3">
                              <select
                                value={pCurrency}
                                onChange={(e) => handleEntryChange(trueIdx, 'currency', e.target.value)}
                                className="bg-slate-900 border border-slate-700 text-slate-300 text-xs rounded-md px-2 py-1.5 outline-none focus:border-emerald-500"
                              >
                                {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input 
                                  type="checkbox" 
                                  checked={entry.isBank || false} 
                                  onChange={(e) => handleBankChange(trueIdx, e.target.checked, pCurrency)} 
                                  className="w-3.5 h-3.5 text-emerald-500 rounded bg-slate-900 border-slate-700 focus:ring-emerald-500 focus:ring-offset-slate-950" 
                                />
                                <span className={`text-[10px] uppercase font-bold tracking-wider ${entry.isBank ? 'text-emerald-400' : 'text-slate-500'}`}>Bank</span>
                              </label>
                            </div>
                          </div>
                        )
                     })}
                   </div>
                </div>
              )}
            </div>
            
            <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end shrink-0">
              <button 
                onClick={() => setShowSettings(false)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4"> 
        <div className="flex items-center gap-4">
          <button onClick={handleSaveAndClose} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-100">Session Ledger</h2>
              {/* Poker Now Link & Glow */}
              {game.pokerNowUrl && (
                <a
                  href={game.pokerNowUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`transition-all duration-500 flex items-center justify-center p-1.5 rounded-lg ${
                    game.isActive 
                      ? 'text-emerald-400 bg-emerald-500/10 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]' 
                      : 'text-rose-400 bg-rose-500/10 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                  }`}
                  title={game.isActive ? "Open Poker Now Table (Active)" : "Open Poker Now Table (Closed)"}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                      <path d="M12 12l2.5-3.5A2.5 2.5 0 0 0 12 6a2.5 2.5 0 0 0-2.5 2.5L12 12z"></path>
                    </svg>
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
          {/* Active Session Slider */}
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg">
             <span className={`text-sm font-semibold transition-colors ${game.isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                {game.isActive ? 'Live' : 'Closed'}
             </span>
             <button
                onClick={() => onSave({ ...game, isActive: !game.isActive })}
                className={`w-12 h-6 rounded-full transition-colors relative ${game.isActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${game.isActive ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
          </div>

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-lg transition-colors border ${showSettings ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Ledger Table */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center flex-wrap gap-4">
             <div className="flex gap-6">
               <div className="text-sm">
                 <span className="text-slate-500 block mb-1">Total Buy-ins</span>
                 <span className="font-bold text-lg text-slate-200 flex items-center gap-1.5"><Coins className="w-4 h-4 text-amber-500/70" /> {formatChips(totalBuyIn)}</span>
               </div>
               <div className="text-sm">
                 <span className="text-slate-500 block mb-1">Total Cashed Out</span>
                 <span className={`font-bold text-lg flex items-center gap-1.5 ${isBalanced ? 'text-slate-200' : 'text-rose-400'}`}><Coins className="w-4 h-4 text-amber-500/70" /> {formatChips(totalCashOut)}</span>
               </div>
               <div className="text-sm border-l border-slate-800 pl-6">
                 <span className="text-slate-500 block mb-1">Chips on Table</span>
                 <span className="font-bold text-lg text-amber-400 flex items-center gap-1.5"><Coins className="w-4 h-4" /> {formatChips(chipsOnTable > 0 ? chipsOnTable : 0)}</span>
               </div>
             </div>
             <div>
                {totalBuyIn > 0 && isBalanced ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium border border-emerald-500/20">
                    <CheckCircle2 className="w-4 h-4" /> Ledger Balanced
                  </span>
                ) : totalBuyIn > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 text-sm font-medium border border-rose-500/20">
                    <AlertCircle className="w-4 h-4" /> Unbalanced ({formatChips(Math.abs(totalBuyIn - totalCashOut))} diff)
                  </span>
                ) : null}
             </div>
          </div>
          
          <div className="overflow-x-auto">
            <style>{`
              input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
            `}</style>
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                  <th className="p-3 font-medium min-w-[150px]">Player Name</th>
                  <th className="p-3 font-medium text-center min-w-[140px]" title="Chips Bought In">Buy Ins (🪙)</th>
                  <th className="p-3 font-medium text-center min-w-[140px]" title="Chips removed mid-game">Buy Outs (🪙)</th>
                  <th className="p-3 font-medium text-center min-w-[100px]" title="Chips held at end of game">Current Stack</th>
                  <th className="p-3 font-medium text-right min-w-[80px]">Net Chips</th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {entries.map((entry, index) => {
                  const sessionCashOut = (Number(entry.buyOut) || 0) + (Number(entry.stack) || 0);
                  const net = sessionCashOut - (Number(entry.buyIn) || 0);
                  
                  return (
                    <tr key={index} className="hover:bg-slate-800/20 group">
                      <td className="p-3 min-w-[200px]">
                        <div className="relative flex items-center">
                          <input 
                            type="text" 
                            placeholder="Player name..."
                            value={entry.name}
                            onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-16 py-2 text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-600"
                          />
                          <select
                            value={entry.currency || 'USD'}
                            onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                            className="absolute right-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold px-1.5 py-1 outline-none cursor-pointer appearance-none hover:bg-indigo-500/20 transition-colors uppercase"
                          >
                            {TOP_CURRENCIES.map(c => <option key={c} value={c} className="bg-slate-900 text-slate-200">{c}</option>)}
                          </select>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', -globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry.buyIn === 0 ? '' : entry.buyIn}
                            onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-1 py-2 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', -globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry.buyOut === 0 ? '' : entry.buyOut}
                            onChange={(e) => handleEntryChange(index, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-1 py-2 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-center">
                          <input 
                            type="number" 
                            min="0"
                            value={entry.stack === 0 ? '' : entry.stack}
                            onChange={(e) => handleEntryChange(index, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-2 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </td>
                      <td className={`p-3 text-right font-bold ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {net > 0 ? '+' : ''}{net === 0 ? `0` : formatChips(net)}
                      </td>
                      <td className="p-3 text-right">
                        <button 
                          onClick={() => handleRemoveRow(index)}
                          className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <button 
              onClick={handleAddRow}
              className="text-sm font-medium text-slate-400 hover:text-emerald-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Player Row
            </button>
          </div>
        </div>

        {/* Settlement Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl h-full flex flex-col min-h-[400px]">
            <div className="p-5 border-b border-slate-800 bg-slate-950/50 flex flex-col gap-4">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <h3 className="font-bold text-slate-100 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                    Settlements
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">Cash owed between players.</p>
                </div>
                <select 
                  value={settlementCurrency}
                  onChange={(e) => setSettlementCurrency(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg px-2 py-1 outline-none focus:border-emerald-500 transition-colors"
                >
                  {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              
              <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                  <Landmark className="w-4 h-4 text-emerald-500/70" /> 
                  Route via Bank Buddies
                </span>
                <label className="flex items-center cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" className="sr-only" checked={useBankBuddies} onChange={e => setUseBankBuddies(e.target.checked)} />
                    <div className={`block w-8 h-5 rounded-full transition-colors ${useBankBuddies ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                    <div className={`dot absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${useBankBuddies ? 'transform translate-x-3' : ''}`}></div>
                  </div>
                </label>
              </div>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
              {!isBalanced || totalBuyIn === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-3 py-8">
                  <AlertCircle className="w-10 h-10 text-slate-700" />
                  <p className="text-sm">Ledger must be balanced before settlements can be calculated.</p>
                </div>
              ) : settlements.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-3 py-8">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500/50" />
                  <p className="text-sm">Everyone broke even! No payouts needed.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {settlements.map((tx, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-rose-400 text-sm truncate max-w-[80px]">{tx.from}</span>
                        <ArrowRight className="w-4 h-4 text-slate-600 shrink-0" />
                        <span className="font-semibold text-emerald-400 text-sm truncate max-w-[80px]">{tx.to}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-bold text-slate-200">{formatFiat(tx.amount, settlementCurrency)}</span>
                        {useBankBuddies && tx.type && (
                          <span className={`text-[9px] uppercase font-bold tracking-wider mt-0.5 ${tx.type === 'Cross-Border' ? 'text-amber-500' : 'text-blue-400'}`}>
                             {tx.type}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {exchangeRates && gameCurrency !== settlementCurrency && (
                    <div className="mt-6 pt-4 border-t border-slate-800">
                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5 justify-center">
                        <Globe className="w-3 h-3 text-emerald-500/50" />
                        Live FX: 1 {gameCurrency} = {(exchangeRates[settlementCurrency] / exchangeRates[gameCurrency]).toFixed(4)} {settlementCurrency}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}