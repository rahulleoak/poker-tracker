import { useState, useMemo, useEffect, Component, useCallback } from "react";
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LayoutDashboard, Globe, History, Users, Landmark } from 'lucide-react';
import { supabase } from './utils/supabase';
import { parsePokerNowCSV } from './utils/csvParser';
import { TOP_CURRENCIES } from './utils/formatters';
import { mapDatabaseSessionsToGames, createDefaultGame, createGameFromCSVEntries, extractPokerNowUrl, findMatchingSession, mergeSessionEntries } from './utils/sessionMapper';
import { loadGamesFromStorage, saveGamesToStorage, mergeRemoteAndLocalGames } from './utils/storage';
import { fetchExchangeRates } from './utils/fx';
import Dashboard from './components/Dashboard';
import GamesList from './components/GamesList';
import GameEditor from './components/GameEditor';
import PlayerProfile from './components/PlayerProfile';
import PlayerManager from './components/PlayerManager';
import AdminPage from './components/AdminPage';
import HomePage from './components/HomePage';
import SessionPage from './components/SessionPage';
import ConfirmationModal from './components/ConfirmationModal';
import SettlementPage from './components/SettlementPage';

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

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppContent />} />
        <Route path="/home" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/session/:sessionId" element={<SessionPage />} />
        <Route path="/settlement" element={<SettlementPage />} />
        <Route path="/settlement/:country" element={<SettlementPage />} />
      </Routes>
    </BrowserRouter>
  );
}

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'games' | 'settlements' | 'players'
  const [games, setGames] = useState([]);
  const [editingGameId, setEditingGameId] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [globalIncrement, setGlobalIncrement] = useState(100);
  const [globalCurrency, setGlobalCurrency] = useState('USD');
  const [exchangeRates, setExchangeRates] = useState({ USD: 1 });
  const [players, setPlayers] = useState([]);
  const [playerLinks, setPlayerLinks] = useState([]);
  const [pendingMergeData, setPendingMergeData] = useState(null);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState(null);

  // --- IDENTITY & PLAYERS FETCH ---
  const fetchPlayersAndLinks = useCallback(async () => {
    if (!supabase) return;
    try {
      const [playersRes, linksRes] = await Promise.all([
        supabase.from('players').select('*').order('display_name'),
        supabase.from('player_links').select('*')
      ]);

      if (playersRes.error) console.error("Error fetching players:", playersRes.error);
      else setPlayers(playersRes.data || []);

      if (linksRes.error) console.error("Error fetching player links:", linksRes.error);
      else setPlayerLinks(linksRes.data || []);
    } catch (err) {
      console.error("Failed to fetch identity data:", err);
    }
  }, []);

  const getPlayerProfile = useCallback((sessionName, externalId) => {
    const trimmedName = (sessionName || '').trim();
    const normName = trimmedName.toLowerCase();
    const normExtId = (externalId || '').trim().toLowerCase();

    // 1. Check external ID / PokerNow ID match
    if (normExtId) {
      const link = playerLinks.find(l => {
        const ext = (l.external_id || l.external_player_id || '').trim().toLowerCase();
        return ext === normExtId;
      });
      if (link) {
        const matched = players.find(p => p.id === link.player_id);
        if (matched) return matched;
      }
    }

    // 2. Check seat-name / alias link match
    if (normName) {
      const link = playerLinks.find(l => {
        const ext = (l.external_id || l.external_player_id || l.session_name || '').trim().toLowerCase();
        return ext === normName;
      });
      if (link) {
        const matched = players.find(p => p.id === link.player_id);
        if (matched) return matched;
      }

      // 3. Direct display_name match with registered player profile
      const exactMatch = players.find(p => (p.display_name || '').trim().toLowerCase() === normName);
      if (exactMatch) return exactMatch;
    }

    return null;
  }, [players, playerLinks]);

  const getPlayerDisplayName = useCallback((sessionName, externalId, requireProfile = false) => {
    const profile = getPlayerProfile(sessionName, externalId);
    if (profile && profile.display_name) {
      return profile.display_name;
    }
    return requireProfile ? null : ((sessionName || '').trim() || 'Unknown Player');
  }, [getPlayerProfile]);

  // --- INITIAL DATA LOAD & SYNC ---
  useEffect(() => {
    fetchExchangeRates().then(rates => {
      if (rates) setExchangeRates(rates);
    });

    fetchPlayersAndLinks();

    async function loadData() {
      let remoteGames = [];
      if (supabase) {
        try {
          const { data: sessionRows, error: sessionError } = await supabase
            .from('sessions')
            .select(`
              id,
              date,
              currency,
              chip_value,
              poker_now_url,
              is_active,
              ledger (
                id,
                player_name,
                buy_in,
                cash_out,
                currency,
                is_bank,
                hands_played,
                vpip_hands,
                pfr_hands,
                three_bet_opps,
                three_bet_hands,
                external_player_id,
                player_external_id,
                player_poker_now_id
              )
            `)
            .order('date', { ascending: false });

          if (sessionError) {
            console.error("Supabase load error:", sessionError);
          } else if (sessionRows) {
            remoteGames = mapDatabaseSessionsToGames(sessionRows);
          }
        } catch (err) {
          console.error("Failed to fetch from Supabase:", err);
        }
      }

      const localGames = loadGamesFromStorage();
      const merged = mergeRemoteAndLocalGames(remoteGames, localGames);
      setGames(merged);
      saveGamesToStorage(merged);
    }

    loadData();
  }, [fetchPlayersAndLinks]);

  useEffect(() => {
    if (games.length > 0) {
      saveGamesToStorage(games);
    }
  }, [games]);

  // --- AGGREGATE DASHBOARD STATS (STRICTLY PROFILE-BASED) ---
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

      const entries = Array.isArray(game.entries) ? game.entries : [];
      const profilesInGame = new Set();

      entries.forEach(entry => {
        if (!entry || !entry.name || entry.name.trim() === '') return;

        // Leaderboard strictly uses master player profiles
        const mappedName = getPlayerDisplayName(entry.name, entry.externalId || entry.pokerNowId, true);
        if (!mappedName) return; // Ignore unregistered/unmapped session names

        if (!stats[mappedName]) {
          stats[mappedName] = {
            name: mappedName,
            buyIn: 0,
            buyOut: 0,
            stack: 0,
            net: 0,
            netFiat: 0,
            buyInFiat: 0,
            cashOutFiat: 0,
            sessions: 0,
            gamesPlayed: 0,
            handsPlayed: 0,
            vpipHands: 0,
            pfrHands: 0,
            threeBetOpps: 0,
            threeBetHands: 0
          };
        }

        const bIn = Number(entry.buyIn) || 0;
        const bOut = Number(entry.buyOut) || 0;
        const stk = Number(entry.stack) || 0;
        const cOut = bOut + stk;
        const netChips = cOut - bIn;

        const buyInFiat = bIn * chipValue * rateToGlobal;
        const cashOutFiat = cOut * chipValue * rateToGlobal;
        const netFiat = netChips * chipValue * rateToGlobal;

        stats[mappedName].buyIn += bIn;
        stats[mappedName].buyOut += bOut;
        stats[mappedName].stack += stk;
        stats[mappedName].net += netChips;
        stats[mappedName].buyInFiat += buyInFiat;
        stats[mappedName].cashOutFiat += cashOutFiat;
        stats[mappedName].netFiat += netFiat;

        if (!profilesInGame.has(mappedName)) {
          profilesInGame.add(mappedName);
          stats[mappedName].sessions += 1;
          stats[mappedName].gamesPlayed += 1;
        }

        stats[mappedName].handsPlayed += Number(entry.handsPlayed) || 0;
        stats[mappedName].vpipHands += Number(entry.vpipHands) || 0;
        stats[mappedName].pfrHands += Number(entry.pfrHands) || 0;
        stats[mappedName].threeBetOpps += Number(entry.threeBetOpps) || 0;
        stats[mappedName].threeBetHands += Number(entry.threeBetHands) || 0;
      });
    });
    return Object.values(stats).sort((a, b) => (b.netFiat || 0) - (a.netFiat || 0));
  }, [games, exchangeRates, globalCurrency, getPlayerDisplayName]);

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

    setGames(prevGames => [newGame, ...prevGames.filter(g => g.id !== newGame.id)]);
    setEditingGameId(newGame.id);
    setSelectedPlayer(null);

    if (supabase) {
      try {
        const sessionPayload = {
          date: newGame.date,
          currency: globalCurrency,
          chip_value: 1,
          is_active: true
        };

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .insert([sessionPayload])
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

          setGames(prevGames => prevGames.map(g => g.id === oldId ? { ...g, id: sessionData.id } : g));
          setEditingGameId(prev => (prev === oldId ? sessionData.id : prev));
        }
      } catch (err) {
        console.error("Failed to sync created session to DB:", err);
      }
    }
  };

  const executeCreateNewGame = async (newGame) => {
    setGames(prevGames => [newGame, ...prevGames.filter(g => g.id !== newGame.id)]);
    setEditingGameId(newGame.id);
    setSelectedPlayer(null);

    if (supabase) {
      try {
        const sessionPayload = {
          date: newGame.date,
          currency: newGame.currency || globalCurrency,
          chip_value: newGame.chipValue || 1,
          poker_now_url: newGame.pokerNowUrl || null,
          is_active: true
        };

        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .insert([sessionPayload])
          .select()
          .single();

        if (sessionError) {
          console.error("Error creating session in Supabase from CSV:", sessionError);
        } else if (sessionData && sessionData.id) {
          const oldId = newGame.id;

          const entriesToInsert = (newGame.entries || []).map(e => ({
            session_id: sessionData.id,
            player_name: e.name,
            buy_in: e.buyIn,
            cash_out: e.buyOut + e.stack,
            currency: e.currency || newGame.currency || globalCurrency,
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

          const { error: ledgerError } = await supabase.from('ledger').insert(entriesToInsert);
          if (ledgerError) {
            console.warn("Error inserting ledger with stats, retrying legacy:", ledgerError);
            const legacyEntries = entriesToInsert.map(e => ({
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

          setGames(prevGames => prevGames.map(g => g.id === oldId ? { ...g, id: sessionData.id } : g));
          setEditingGameId(prev => (prev === oldId ? sessionData.id : prev));
        }
      } catch (err) {
        console.error("Failed to sync new CSV session to DB:", err);
      }
    }
  };

  const executeMergeGame = async (incomingGame, targetSession) => {
    const mergedEntries = mergeSessionEntries(targetSession.entries || [], incomingGame.entries || []);
    const updatedGame = {
      ...targetSession,
      pokerNowUrl: targetSession.pokerNowUrl || incomingGame.pokerNowUrl || null,
      entries: mergedEntries
    };

    setGames(prevGames => prevGames.map(g => g.id === updatedGame.id ? updatedGame : g));
    setEditingGameId(updatedGame.id);
    setSelectedPlayer(null);

    if (supabase) {
      try {
        await supabase.from('sessions')
          .update({ poker_now_url: updatedGame.pokerNowUrl })
          .eq('id', updatedGame.id);

        await supabase.from('ledger').delete().eq('session_id', updatedGame.id);

        const validEntries = mergedEntries
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
            console.warn("Error inserting ledger during merge, retrying legacy:", ledgerError);
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
        console.error("Failed to update merged session in DB:", err);
      }
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
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
        if (newGame.entries) {
          newGame.entries = newGame.entries.map(entry => {
            const profile = getPlayerProfile(entry.name, entry.pokerNowId || entry.externalId);
            if (profile && profile.preferred_currency) {
              return { ...entry, currency: profile.preferred_currency };
            }
            return entry;
          });
        }
        const pokerNowUrl = extractPokerNowUrl(text);
        if (pokerNowUrl) {
          newGame.pokerNowUrl = pokerNowUrl;
        }

        const matchingSession = findMatchingSession(games, newGame);

        if (matchingSession) {
          setPendingMergeData({
            newGame,
            matchingSession
          });
        } else {
          await executeCreateNewGame(newGame);
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
              <span>OffSuite</span>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4">
              <div className="flex items-center gap-1 sm:gap-2">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider hidden md:inline">Dashboard View:</label>
                <select 
                  value={globalCurrency}
                  onChange={(e) => setGlobalCurrency(e.target.value)}
                  className="bg-slate-950 border border-slate-800 text-emerald-400 text-xs sm:text-sm font-bold rounded-lg px-1.5 sm:px-2 py-1 outline-none focus:border-emerald-500 transition-colors"
                >
                  {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
                <button 
                  onClick={() => { setActiveTab('dashboard'); setEditingGameId(null); setSelectedPlayer(null); }}
                  className={`px-3 sm:px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-md text-sm font-medium transition-colors flex items-center justify-center sm:justify-start gap-2 ${
                    activeTab === 'dashboard' && !editingGameId && !selectedPlayer ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="hidden sm:inline">Dashboard</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('games'); setEditingGameId(null); setSelectedPlayer(null); }}
                  className={`px-3 sm:px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-md text-sm font-medium transition-colors flex items-center justify-center sm:justify-start gap-2 ${
                    (activeTab === 'games' || editingGameId) ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <History className="w-4 h-4" />
                  <span className="hidden sm:inline">Sessions</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('settlements'); setEditingGameId(null); setSelectedPlayer(null); }}
                  className={`px-3 sm:px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-md text-sm font-medium transition-colors flex items-center justify-center sm:justify-start gap-2 ${
                    activeTab === 'settlements' && !editingGameId && !selectedPlayer ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Landmark className="w-4 h-4" />
                  <span className="hidden sm:inline">Settlements</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('players'); setEditingGameId(null); setSelectedPlayer(null); }}
                  className={`px-3 sm:px-4 py-2.5 sm:py-2 min-h-[44px] sm:min-h-0 rounded-md text-sm font-medium transition-colors flex items-center justify-center sm:justify-start gap-2 ${
                    activeTab === 'players' ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">Players</span>
                </button>
              </div>
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
              players={players}
              playerLinks={playerLinks}
              onUpdatePlayers={fetchPlayersAndLinks}
              onSave={handleUpdateGame}
              onBack={() => setEditingGameId(null)}
              onDelete={() => setPendingDeleteSessionId(editingGameId)}
            />
          ) : selectedPlayer ? (
            <PlayerProfile 
              playerName={selectedPlayer} 
              games={games} 
              exchangeRates={exchangeRates}
              globalCurrency={globalCurrency}
              getPlayerDisplayName={getPlayerDisplayName}
              onBack={() => setSelectedPlayer(null)} 
            />
          ) : activeTab === 'settlements' ? (
            <SettlementPage embedded={true} />
          ) : activeTab === 'dashboard' ? (
            <Dashboard 
              stats={playerStats} 
              totalSessions={games.length} 
              totalMoney={totalMoneyInPlayFiat} 
              globalCurrency={globalCurrency} 
              onPlayerClick={setSelectedPlayer} 
              games={games}
              exchangeRates={exchangeRates}
              getPlayerDisplayName={getPlayerDisplayName}
            />
          ) : activeTab === 'players' ? (
            <PlayerManager players={players} playerLinks={playerLinks} onUpdate={fetchPlayersAndLinks} />
          ) : (
            <GamesList games={games} onCreate={handleCreateGame} onFileUpload={handleFileUpload} onEdit={setEditingGameId} exchangeRates={exchangeRates} globalCurrency={globalCurrency} />
          )}
        </main>

        <footer className="border-t border-slate-800/60 mt-12 py-6 text-center text-xs text-slate-400">
          <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="flex items-center gap-1.5 font-medium">
              <span>OffSuite</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-500">Cross-border Poker Ledger & Settlements</span>
            </p>
            <p className="text-[11px] text-slate-500">
              Live exchange rates powered by open FX feeds.
            </p>
          </div>
        </footer>

        {/* Merge Confirmation Modal */}
        <ConfirmationModal
          isOpen={Boolean(pendingMergeData)}
          title="Merge Hands Log into Existing Session?"
          message={`A session on ${pendingMergeData?.matchingSession?.date} already exists. Do you want to merge hand stats (VPIP/PFR/3-Bet) into this existing session, or create a new session?`}
          confirmLabel="Merge Hand Stats"
          cancelLabel="Create New Session"
          onConfirm={async () => {
            if (pendingMergeData) {
              await executeMergeGame(pendingMergeData.newGame, pendingMergeData.matchingSession);
              setPendingMergeData(null);
            }
          }}
          onCancel={async () => {
            if (pendingMergeData) {
              await executeCreateNewGame(pendingMergeData.newGame);
              setPendingMergeData(null);
            }
          }}
        />

        {/* Delete Confirmation Modal */}
        <ConfirmationModal
          isOpen={Boolean(pendingDeleteSessionId)}
          title="Delete Poker Session?"
          message="Are you sure you want to delete this session? This action cannot be undone and will permanently remove all chip ledger entries for this game."
          confirmLabel="Delete Session"
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={async () => {
            if (pendingDeleteSessionId) {
              await handleDeleteGame(pendingDeleteSessionId);
              setPendingDeleteSessionId(null);
            }
          }}
          onCancel={() => setPendingDeleteSessionId(null)}
        />
      </div>
    </ErrorBoundary>
  );
}
