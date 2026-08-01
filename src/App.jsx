import { useState, useMemo, useEffect } from "react";

import { LayoutDashboard, Coins, Globe, History } from 'lucide-react';
import { supabase } from './utils/supabase';
import { parsePokerNowCSV } from './utils/csvParser';
import { TOP_CURRENCIES } from './utils/formatters';
import Dashboard from './components/Dashboard';
import GamesList from './components/GamesList';
import GameEditor from './components/GameEditor';
import PlayerProfile from './components/PlayerProfile';

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

  const fetchGames = async () => {
    setIsLoading(true);
    if (!supabase) {
      setIsLoading(false);
      return;
    }
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGames();
  }, []);

  // --- DERIVED STATS (ALL-TIME FIAT) ---
  const playerStats = useMemo(() => {
    const stats = {};
    games.forEach(game => {
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
    if (!supabase) return;
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
    if (!supabase) return;
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
    if (!supabase) return;

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
    if (!supabase) return;
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
