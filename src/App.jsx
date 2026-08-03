import { useState, useMemo, useEffect, Component } from "react";
import { LayoutDashboard, Globe, History, Play } from 'lucide-react';
import { supabase } from './utils/supabase';
import { AuthProvider } from './components/AuthContext';
import UserMenu from './components/UserMenu';
import AuthModal from './components/AuthModal';
import { parsePokerNowCSV } from './utils/csvParser';
import { TOP_CURRENCIES } from './utils/formatters';
import { mapDatabaseSessionsToGames, createDefaultGame, createGameFromCSVEntries } from './utils/sessionMapper';
import { loadGamesFromStorage, saveGamesToStorage, mergeRemoteAndLocalGames } from './utils/storage';
import Dashboard from './components/Dashboard';
import GamesList from './components/GamesList';
import GameEditor from './components/GameEditor';
import PlayerProfile from './components/PlayerProfile';
import HandReplayer from './components/HandReplayer';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-200 p-6">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md w-full shadow-2xl text-center space-y-4">
            <h2 className="text-xl font-bold text-rose-400">Something Went Wrong</h2>
            <p className="text-sm text-slate-400">
              An unexpected error occurred while rendering. Click below to recover.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg text-sm transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppContent() {
  const [games, setGames] = useState(() => loadGamesFromStorage());
  const [activeTab, setActiveTab] = useState('dashboard');
  const [editingGameId, setEditingGameId] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  
  // FX Rates & Global Config
  const [exchangeRates, setExchangeRates] = useState({ USD: 1 });
  const [globalCurrency, setGlobalCurrency] = useState('USD');
  const [globalIncrement, setGlobalIncrement] = useState(100);

  // Automatically persist all game creations, edits, CSV imports, and deletions to localStorage
  useEffect(() => {
    saveGamesToStorage(games);
  }, [games]);

  const fetchGames = async () => {
    if (!supabase) {
      return;
    }

    try {
      // 1. Try querying with all columns via ledger(*)
      let { data, error } = await supabase
        .from('sessions')
        .select(`
          id,
          date,
          currency,
          chip_value,
          poker_now_url,
          is_active,
          ledger ( * )
        `)
        .order('date', { ascending: false });

      // 2. If selecting ledger(*) fails, fallback to basic columns
      if (error) {
        console.warn("Primary fetch error, attempting fallback query:", error);
        const fallback = await supabase
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

        if (fallback.error) {
          console.error("Fallback fetch also failed:", fallback.error);
          return;
        }
        data = fallback.data;
      }

      if (Array.isArray(data)) {
        const remoteGames = mapDatabaseSessionsToGames(data);
        setGames(prevGames => mergeRemoteAndLocalGames(remoteGames, prevGames));
      }
    } catch (err) {
      console.error("Unexpected error fetching games:", err);
    }
  };

  // --- FETCH DATA & FX RATES ---
  useEffect(() => {
    // 1. Fetch live exchange rates with offline fallback
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => {
        if (data && data.rates) {
          setExchangeRates(data.rates);
        }
      })
      .catch(err => console.error("Failed to fetch FX rates, using fallback:", err));

    // 2. Fetch games from DB in background
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGames();
  }, []);

  // --- DERIVED STATS (ALL-TIME FIAT) ---
  const playerStats = useMemo(() => {
    const stats = {};
    const safeGames = Array.isArray(games) ? games : [];

    safeGames.forEach(game => {
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
        const name = entry.name.trim();
        if (!name) return;

        if (!stats[name]) {
          stats[name] = { 
            name, 
            buyInFiat: 0, 
            cashOutFiat: 0, 
            gamesPlayed: 0, 
            netFiat: 0,
            handsPlayed: 0,
            vpipHands: 0,
            pfrHands: 0,
            threeBetOpps: 0,
            threeBetHands: 0
          };
        }
        const buyIn = Number(entry.buyIn) || 0;
        const buyOut = Number(entry.buyOut) || 0;
        const stack = Number(entry.stack) || 0;
        const totalCashOutChips = buyOut + stack;
        
        stats[name].buyInFiat += (buyIn * chipToFiatMultiplier);
        stats[name].cashOutFiat += (totalCashOutChips * chipToFiatMultiplier);
        stats[name].netFiat += ((totalCashOutChips - buyIn) * chipToFiatMultiplier);
        stats[name].gamesPlayed += 1;

        stats[name].handsPlayed += Number(entry.handsPlayed) || 0;
        stats[name].vpipHands += Number(entry.vpipHands) || 0;
        stats[name].pfrHands += Number(entry.pfrHands) || 0;
        stats[name].threeBetOpps += Number(entry.threeBetOpps) || 0;
        stats[name].threeBetHands += Number(entry.threeBetHands) || 0;
      });
    });
    return Object.values(stats).sort((a, b) => (b.netFiat || 0) - (a.netFiat || 0));
  }, [games, exchangeRates, globalCurrency]);

  const totalMoneyInPlayFiat = useMemo(() => {
    const safeGames = Array.isArray(games) ? games : [];
    return safeGames.reduce((sum, game) => {
      if (!game) return sum;
      const gameCurrency = game.currency || 'USD';
      const chipValue = Number(game.chipValue) || 1;
      const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
        ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
        : 1;
      const entries = Array.isArray(game.entries) ? game.entries : [];
      const gameBuyInFiat = entries.reduce((s, e) => s + (Number(e?.buyIn) || 0), 0) * chipValue * rateToGlobal;
      return sum + gameBuyInFiat;
    }, 0);
  }, [games, exchangeRates, globalCurrency]);

  // --- HANDLERS ---
  const handleCreateGame = async () => {
    const newGame = createDefaultGame(globalCurrency);

    // Immediately update local state so editingGameId resolves to a valid game
    setGames(prevGames => [newGame, ...prevGames.filter(g => g.id !== newGame.id)]);
    setEditingGameId(newGame.id);
    setSelectedPlayer(null);

    if (supabase) {
      try {
        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .insert([{ date: newGame.date, currency: globalCurrency, chip_value: 1, is_active: true }])
          .select()
          .single();

        if (sessionError) {
          console.error("Error creating session in Supabase:", sessionError);
        } else if (sessionData && sessionData.id) {
          const oldId = newGame.id;

          const initialEntries = newGame.entries.map(e => ({
            session_id: sessionData.id,
            player_name: e.name,
            buy_in: e.buyIn,
            cash_out: e.buyOut + e.stack,
            currency: globalCurrency,
            is_bank: false,
            external_player_id: e.externalId || e.pokerNowId || null,
            player_external_id: e.externalId || e.pokerNowId || null,
            player_poker_now_id: e.pokerNowId || e.externalId || null
          }));

          await supabase.from('ledger').insert(initialEntries);

          // Update game ID in local state if it changed from generated UUID
          setGames(prevGames => prevGames.map(g => g.id === oldId ? { ...g, id: sessionData.id } : g));
          setEditingGameId(prev => (prev === oldId ? sessionData.id : prev));
        }
      } catch (err) {
        console.error("Failed to sync created session to DB:", err);
      }
    }
  };

  const handleFileUpload = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const parsedEntries = parsePokerNowCSV(text);
        
        const date = file.lastModified 
          ? new Date(file.lastModified).toISOString().split('T')[0] 
          : new Date().toISOString().split('T')[0];
        
        const newGame = createGameFromCSVEntries(parsedEntries, globalCurrency, date);

        // Immediately update local state so editingGameId resolves to a valid game
        setGames(prevGames => [newGame, ...prevGames.filter(g => g.id !== newGame.id)]);
        setEditingGameId(newGame.id);
        setSelectedPlayer(null);

        if (supabase) {
          try {
            const { data: sessionData, error: sessionError } = await supabase
              .from('sessions')
              .insert([{ date: newGame.date, currency: globalCurrency, chip_value: 1, is_active: false }])
              .select()
              .single();
              
            if (sessionError) {
              console.error("Error creating uploaded session in DB:", sessionError);
            } else if (sessionData && sessionData.id) {
              const oldId = newGame.id;

              const dbEntriesWithStats = newGame.entries.map(entry => ({
                session_id: sessionData.id,
                player_name: entry.name,
                buy_in: entry.buyIn,
                cash_out: entry.buyOut + entry.stack,
                currency: globalCurrency,
                is_bank: false,
                hands_played: entry.handsPlayed,
                vpip_hands: entry.vpipHands,
                pfr_hands: entry.pfrHands,
                three_bet_opps: entry.threeBetOpps,
                three_bet_hands: entry.threeBetHands,
                external_player_id: entry.externalId || entry.pokerNowId || null,
                player_external_id: entry.externalId || entry.pokerNowId || null,
                player_poker_now_id: entry.pokerNowId || entry.externalId || null
              }));

              const { error: ledgerError } = await supabase.from('ledger').insert(dbEntriesWithStats);
              if (ledgerError) {
                console.warn("Ledger insert with stats failed, attempting legacy insert:", ledgerError);
                const legacyEntries = dbEntriesWithStats.map(e => ({
                  session_id: e.session_id,
                  player_name: e.player_name,
                  buy_in: e.buy_in,
                  cash_out: e.cash_out,
                  currency: e.currency,
                  is_bank: e.is_bank,
                  external_player_id: e.external_player_id,
                  player_external_id: e.player_external_id,
                  player_poker_now_id: e.player_poker_now_id
                }));
                await supabase.from('ledger').insert(legacyEntries);
              }

              // Update game ID in local state if changed
              setGames(prevGames => prevGames.map(g => g.id === oldId ? { ...g, id: sessionData.id } : g));
              setEditingGameId(prev => (prev === oldId ? sessionData.id : prev));
            }
          } catch (dbErr) {
            console.error("Failed to sync uploaded session to DB:", dbErr);
          }
        }
      } catch (err) {
        console.error("Error parsing/processing CSV file:", err);
      }
    };

    reader.readAsText(file);
    if (event.target) event.target.value = null;
  };

  const handleUpdateGame = async (updatedGame) => {
    if (!updatedGame || !updatedGame.id) return;
    setGames(prevGames => prevGames.map(g => g.id === updatedGame.id ? updatedGame : g));

    if (!supabase) return;

    try {
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
      
      const entries = Array.isArray(updatedGame.entries) ? updatedGame.entries : [];
      const validEntries = entries
        .filter(e => e && ((e.name || '').trim() !== '' || e.buyIn > 0 || e.buyOut > 0 || e.stack > 0))
        .map(e => ({
          session_id: updatedGame.id,
          player_name: (e.name || '').trim() || 'Unknown Player',
          buy_in: Number(e.buyIn) || 0,
          cash_out: (Number(e.buyOut) || 0) + (Number(e.stack) || 0),
          currency: e.currency || updatedGame.currency || 'USD',
          is_bank: Boolean(e.isBank),
          hands_played: Number(e.handsPlayed) || 0,
          vpip_hands: Number(e.vpipHands) || 0,
          pfr_hands: Number(e.pfrHands) || 0,
          three_bet_opps: Number(e.threeBetOpps) || 0,
          three_bet_hands: Number(e.threeBetHands) || 0,
          external_player_id: e.externalId || e.pokerNowId || null,
          player_external_id: e.externalId || e.pokerNowId || null,
          player_poker_now_id: e.pokerNowId || e.externalId || null
        }));

      if (validEntries.length > 0) {
        const { error: ledgerError } = await supabase.from('ledger').insert(validEntries);
        if (ledgerError) {
          console.warn("Ledger update with stats failed, attempting legacy update:", ledgerError);
          const legacyEntries = validEntries.map(e => ({
            session_id: e.session_id,
            player_name: e.player_name,
            buy_in: e.buy_in,
            cash_out: e.cash_out,
            currency: e.currency,
            is_bank: e.is_bank,
            external_player_id: e.external_player_id,
            player_external_id: e.player_external_id,
            player_poker_now_id: e.player_poker_now_id
          }));
          await supabase.from('ledger').insert(legacyEntries);
        }
      }
    } catch (err) {
      console.error("Error updating game in DB:", err);
    }
  };

  const handleDeleteGame = async (id) => {
    if (!id) return;
    setGames(prevGames => prevGames.filter(g => g.id !== id));
    if (editingGameId === id) setEditingGameId(null);

    if (!supabase) return;
    try {
      await supabase.from('sessions').delete().eq('id', id);
    } catch (err) {
      console.error("Error deleting session from DB:", err);
    }
  };

  const activeEditingGame = editingGameId ? games.find(g => g && g.id === editingGameId) : null;

  return (
    <ErrorBoundary>
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
                <button 
                  onClick={() => { setActiveTab('replayer'); setEditingGameId(null); setSelectedPlayer(null); }}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                    activeTab === 'replayer' && !editingGameId && !selectedPlayer ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Play className="w-4 h-4" />
                  <span className="hidden sm:inline">Hand Replayer</span>
                </button>
              </div>

              <UserMenu onOpenAuthModal={() => setAuthModalOpen(true)} />
            </div>
          </div>
        </nav>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {editingGameId ? (
            <GameEditor 
              game={activeEditingGame} 
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
          ) : activeTab === 'replayer' ? (
            <HandReplayer />
          ) : (
            <GamesList games={games} onCreate={handleCreateGame} onFileUpload={handleFileUpload} onEdit={setEditingGameId} exchangeRates={exchangeRates} globalCurrency={globalCurrency} />
          )}
        </main>
        <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
      </div>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
