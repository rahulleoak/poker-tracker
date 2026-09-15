import { useState, useEffect, useMemo, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom';
import { 
  Users, 
  History, 
  LayoutDashboard, 
  Landmark, 
  Globe, 
  AlertTriangle
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import GamesList from './components/GamesList';
import GameEditor from './components/GameEditor';
import PlayerManager from './components/PlayerManager';
import PlayerProfile from './components/PlayerProfile';
import ConfirmationModal from './components/ConfirmationModal';
import SettlementPage from './components/SettlementPage';
import HomePage from './components/HomePage';
import AdminPage from './components/AdminPage';
import SessionPage from './components/SessionPage';
import { supabase } from './utils/supabase';
import { parsePokerNowCSV } from './utils/csvParser';
import { extractPokerNowUrl, findMatchingSession, mergeSessionEntries, mapDatabaseSessionsToGames, createDefaultGame, createGameFromCSVEntries } from './utils/sessionMapper';
import { TOP_CURRENCIES, formatFiat } from './utils/formatters';
import { loadGamesFromStorage, saveGamesToStorage, mergeRemoteAndLocalGames } from './utils/storage';

export default function App() {
  const [games, setGames] = useState(() => loadGamesFromStorage());
  const [globalIncrement, setGlobalIncrement] = useState(50);
  const [exchangeRates, setExchangeRates] = useState({ USD: 1, CAD: 1.35 });
  const [globalCurrency, setGlobalCurrency] = useState('USD');
  const [players, setPlayers] = useState(() => {
    try {
      const raw = localStorage.getItem('offsuite_players');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [playerLinks, setPlayerLinks] = useState(() => {
    try {
      const raw = localStorage.getItem('offsuite_player_links');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [pendingMergeData, setPendingMergeData] = useState(null);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Active tab detection
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';
  const isSessions = location.pathname.startsWith('/sessions');
  const isSettlements = location.pathname.startsWith('/settlement');
  const isPlayers = location.pathname.startsWith('/players');

  // 1. Fetch Exchange Rates
  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/USD')
      .then(res => res.json())
      .then(data => {
        if (data && data.rates) {
          setExchangeRates(data.rates);
        }
      })
      .catch(err => console.warn('Could not fetch exchange rates:', err));
  }, []);

  // 2. Fetch Players & Links from DB / Local Storage
  const fetchPlayersAndLinks = useCallback(async () => {
    if (supabase) {
      try {
        const [playersRes, linksRes] = await Promise.all([
          supabase.from('players').select('*'),
          supabase.from('player_links').select('*')
        ]);

        if (playersRes.data && Array.isArray(playersRes.data)) {
          setPlayers(playersRes.data);
          try {
            localStorage.setItem('offsuite_players', JSON.stringify(playersRes.data));
          } catch (e) {
            console.warn(e);
          }
        }
        if (linksRes.data && Array.isArray(linksRes.data)) {
          setPlayerLinks(linksRes.data);
          try {
            localStorage.setItem('offsuite_player_links', JSON.stringify(linksRes.data));
          } catch (e) {
            console.warn(e);
          }
        }
      } catch (err) {
        console.warn('Error fetching players/links from DB:', err);
      }
    } else {
      try {
        const localPlayers = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        const localLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        setPlayers(localPlayers);
        setPlayerLinks(localLinks);
      } catch (e) {
        console.warn('Error loading local players/links:', e);
      }
    }
  }, []);

  useEffect(() => {
    fetchPlayersAndLinks();
  }, [fetchPlayersAndLinks]);

  // 3. Fetch Sessions from DB & Merge with Local Storage
  useEffect(() => {
    async function loadSessionsFromDB() {
      if (!supabase) return;
      try {
        const { data: dbSessions, error } = await supabase
          .from('sessions')
          .select(`
            id,
            date,
            currency,
            chip_value,
            poker_now_url,
            is_active,
            ledger (
              player_name,
              player_external_id,
              external_player_id,
              player_poker_now_id,
              buy_in,
              cash_out,
              currency,
              is_bank,
              hands_played,
              vpip_hands,
              pfr_hands,
              three_bet_opps,
              three_bet_hands
            )
          `)
          .order('date', { ascending: false });

        if (error) {
          console.warn("Failed to fetch sessions from DB:", error);
          return;
        }

        if (dbSessions && dbSessions.length > 0) {
          const mappedDbGames = mapDatabaseSessionsToGames(dbSessions);
          const currentLocalGames = loadGamesFromStorage();
          const merged = mergeRemoteAndLocalGames(currentLocalGames, mappedDbGames);
          setGames(merged);
          saveGamesToStorage(merged);
        }
      } catch (err) {
        console.warn("DB session loading error:", err);
      }
    }

    loadSessionsFromDB();
  }, []);

  // 4. Persistence to Local Storage on Change
  useEffect(() => {
    saveGamesToStorage(games);
  }, [games]);

  // Helper to resolve player profile & display name via identity links
  const getPlayerProfile = useCallback((sessionName, externalId) => {
    const trimmedName = (sessionName || '').trim();
    const normName = trimmedName.toLowerCase();
    const normExtId = (externalId || '').trim().toLowerCase();

    // 1. Check external ID / PokerNow ID match against player_links
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

      // 3. Direct display_name match with registered master player profile
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

  // Aggregate Stats across games (STRICTLY PROFILE-BASED)
  const playerStats = useMemo(() => {
    const stats = {};
    const safeGames = Array.isArray(games) ? games : [];
    const fxRate = (c) => (exchangeRates && exchangeRates[c] ? exchangeRates[c] : 1);
    const targetFx = fxRate(globalCurrency);

    safeGames.filter(Boolean).forEach(game => {
      const gChipVal = Number(game.chipValue) || 1;
      const gCurr = game.currency || 'USD';
      const gFx = fxRate(gCurr);

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
            buyInChips: 0,
            cashOutChips: 0,
            netChips: 0,
            buyInFiat: 0,
            cashOutFiat: 0,
            netFiat: 0,
            sessions: 0,
            gamesPlayed: 0,
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
        const cashOut = buyOut + stack;
        const netChips = cashOut - buyIn;

        const entryCurr = entry.currency || gCurr;
        const entryFx = fxRate(entryCurr);

        // Convert to selected global currency
        const buyInFiat = ((buyIn * gChipVal) / entryFx) * targetFx;
        const cashOutFiat = ((cashOut * gChipVal) / entryFx) * targetFx;
        const netFiat = ((netChips * gChipVal) / entryFx) * targetFx;

        stats[mappedName].buyInChips += buyIn;
        stats[mappedName].cashOutChips += cashOut;
        stats[mappedName].netChips += netChips;
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

    return Object.values(stats).sort((a, b) => b.netFiat - a.netFiat);
  }, [games, globalCurrency, exchangeRates, getPlayerDisplayName]);

  // Overall metrics
  const totalMoneyInPlayFiat = useMemo(() => {
    const fxRate = (c) => (exchangeRates && exchangeRates[c] ? exchangeRates[c] : 1);
    const targetFx = fxRate(globalCurrency);

    return (Array.isArray(games) ? games : []).filter(Boolean).reduce((sum, game) => {
      const gChipVal = Number(game.chipValue) || 1;
      const gCurr = game.currency || 'USD';
      const gFx = fxRate(gCurr);

      const gameBuyInFiat = (game.entries || []).reduce((gSum, e) => {
        const eCurr = e.currency || gCurr;
        const eFx = fxRate(eCurr);
        const buyIn = Number(e.buyIn) || 0;
        return gSum + (((buyIn * gChipVal) / eFx) * targetFx);
      }, 0);

      return sum + gameBuyInFiat;
    }, 0);
  }, [games, globalCurrency, exchangeRates]);

  // CRUD Session Handlers
  const executeCreateNewGame = async (newGame) => {
    setGames(prevGames => [newGame, ...prevGames]);
    navigate(`/sessions/${newGame.id}`);

    if (supabase) {
      try {
        const { error: sessionError } = await supabase.from('sessions').insert([{
          id: newGame.id,
          date: newGame.date,
          currency: newGame.currency,
          chip_value: newGame.chipValue,
          poker_now_url: newGame.pokerNowUrl || null,
          is_active: newGame.isActive
        }]);

        if (sessionError) {
          console.warn("Failed to create session row in DB:", sessionError);
          return;
        }

        const ledgerRows = (newGame.entries || [])
          .filter(e => e && ((e.name || '').trim() !== '' || e.buyIn > 0 || e.buyOut > 0 || e.stack > 0))
          .map(e => ({
            session_id: newGame.id,
            player_name: (e.name || '').trim() || 'Unknown Player',
            buy_in: Number(e.buyIn) || 0,
            cash_out: (Number(e.buyOut) || 0) + (Number(e.stack) || 0),
            currency: e.currency || newGame.currency || 'USD',
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

        if (ledgerRows.length > 0) {
          const { error: ledgerError } = await supabase.from('ledger').insert(ledgerRows);
          if (ledgerError) {
            console.warn("Ledger insert with stats failed, attempting legacy schema insert:", ledgerError);
            const legacyRows = ledgerRows.map(e => ({
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
            await supabase.from('ledger').insert(legacyRows);
          }
        }
      } catch (err) {
        console.error("Error creating session in DB:", err);
      }
    }
  };

  const handleCreateGame = async () => {
    const newGame = createDefaultGame(globalCurrency);
    await executeCreateNewGame(newGame);
  };

  const executeMergeGame = async (newGame, existingGame) => {
    const mergedEntries = mergeSessionEntries(existingGame.entries || [], newGame.entries || []);
    const updatedGame = {
      ...existingGame,
      entries: mergedEntries,
      pokerNowUrl: existingGame.pokerNowUrl || newGame.pokerNowUrl
    };

    setGames(prevGames => prevGames.map(g => g.id === existingGame.id ? updatedGame : g));
    navigate(`/sessions/${existingGame.id}`);

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
        console.error("Error updating merged session in DB:", err);
      }
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== 'string') return;

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
    navigate('/sessions');

    if (!supabase) return;
    try {
      await supabase.from('sessions').delete().eq('id', id);
    } catch (err) {
      console.error("Error deleting session from DB:", err);
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Top HUD Glass Navbar */}
      <nav className="bg-black/80 border-b border-white/10 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div 
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2.5 text-emerald-400 font-bold text-lg tracking-tight cursor-pointer hover:opacity-90 transition-opacity group"
          >
            <div className="flex items-center justify-center w-8 h-8 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 group-hover:shadow-[0_0_12px_rgba(16,185,129,0.5)] transition-all">
              <Globe className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            </div>
            <span className="font-bold tracking-tight text-white font-sans">Off<span className="text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]">Suite</span></span>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Currency Toggle */}
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] font-mono font-medium text-zinc-500 uppercase tracking-wider hidden md:inline">FX:</label>
              <select 
                value={globalCurrency}
                onChange={(e) => setGlobalCurrency(e.target.value)}
                className="bg-black/90 border border-white/20 text-emerald-400 font-mono text-xs sm:text-sm font-bold px-2 py-1 outline-none focus:border-emerald-400 focus:shadow-[0_0_8px_rgba(34,197,94,0.5)] transition-all cursor-pointer"
              >
                {TOP_CURRENCIES.map(c => <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>)}
              </select>
            </div>

            {/* Route Tabs */}
            <div className="flex gap-1 bg-black/60 border border-white/10 p-1">
              <button 
                onClick={() => navigate('/dashboard')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all flex items-center justify-center sm:justify-start gap-2 ${ 
                  isDashboard ? 'bg-zinc-800 text-white font-bold border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline font-sans">Dashboard</span>
              </button>
              <button 
                onClick={() => navigate('/sessions')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all flex items-center justify-center sm:justify-start gap-2 ${
                  isSessions ? 'bg-zinc-800 text-white font-bold border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <History className="w-4 h-4" />
                <span className="hidden sm:inline font-sans">Sessions</span>
              </button>
              <button 
                onClick={() => navigate('/settlements')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all flex items-center justify-center sm:justify-start gap-2 ${
                  isSettlements ? 'bg-zinc-800 text-white font-bold border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Landmark className="w-4 h-4" />
                <span className="hidden sm:inline font-sans">Settlements</span>
              </button>
              <button 
                onClick={() => navigate('/players')}
                className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all flex items-center justify-center sm:justify-start gap-2 ${
                  isPlayers ? 'bg-zinc-800 text-white font-bold border border-white/20 shadow-[0_0_8px_rgba(255,255,255,0.15)]' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                }`}
              >
                <Users className="w-4 h-4" />
                <span className="hidden sm:inline font-sans">Players</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Routed Page Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={
            <Dashboard 
              stats={playerStats} 
              totalSessions={games.length} 
              totalMoney={totalMoneyInPlayFiat} 
              globalCurrency={globalCurrency} 
              onPlayerClick={(name) => navigate(`/players/${encodeURIComponent(name)}`)} 
              games={games}
              exchangeRates={exchangeRates}
              getPlayerDisplayName={getPlayerDisplayName}
            />
          } />
          <Route path="/dashboard" element={
            <Dashboard 
              stats={playerStats} 
              totalSessions={games.length} 
              totalMoney={totalMoneyInPlayFiat} 
              globalCurrency={globalCurrency} 
              onPlayerClick={(name) => navigate(`/players/${encodeURIComponent(name)}`)} 
              games={games}
              exchangeRates={exchangeRates}
              getPlayerDisplayName={getPlayerDisplayName}
            />
          } />
          <Route path="/sessions" element={
            <GamesList 
              games={games} 
              onCreate={handleCreateGame} 
              onFileUpload={handleFileUpload} 
              onEdit={(id) => navigate(`/sessions/${id}`)} 
              exchangeRates={exchangeRates} 
              globalCurrency={globalCurrency} 
            />
          } />
          <Route path="/sessions/:sessionId" element={
            <SessionEditorRoute
              games={games}
              globalCurrency={globalCurrency}
              globalIncrement={globalIncrement}
              setGlobalIncrement={setGlobalIncrement}
              exchangeRates={exchangeRates}
              players={players}
              playerLinks={playerLinks}
              onUpdatePlayers={fetchPlayersAndLinks}
              onSave={handleUpdateGame}
              onBack={() => navigate('/sessions')}
              onDelete={(id) => setPendingDeleteSessionId(id)}
            />
          } />
          <Route path="/settlements" element={<SettlementPage embedded={true} />} />
          <Route path="/settlements/:country" element={<SettlementPage embedded={true} />} />
          <Route path="/settlement" element={<SettlementPage embedded={true} />} />
          <Route path="/settlement/:country" element={<SettlementPage embedded={true} />} />
          <Route path="/players" element={
            <PlayerManager players={players} playerLinks={playerLinks} onUpdate={fetchPlayersAndLinks} />
          } />
          <Route path="/players/:playerName" element={
            <PlayerProfileRoute
              games={games}
              exchangeRates={exchangeRates}
              globalCurrency={globalCurrency}
              getPlayerDisplayName={getPlayerDisplayName}
              onBack={() => navigate(-1)}
            />
          } />
          <Route path="/home" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin/session/:sessionId" element={<SessionPage />} />
        </Routes>
      </main>

      {/* Footer HUD Readout */}
      <footer className="border-t border-white/10 mt-12 py-6 text-center text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="flex items-center gap-2 font-medium">
            <span className="text-zinc-300 font-sans font-bold">OffSuite</span>
            <span className="text-zinc-700 font-mono">::</span>
            <span className="text-zinc-400 font-sans">Cross-border Poker Ledger & Settlements Engine</span>
          </p>
          <p className="text-[11px] text-zinc-500 font-mono">
            Live exchange rates synced via open FX telemetry feeds.
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
  );
}

function SessionEditorRoute({ games, globalCurrency, globalIncrement, setGlobalIncrement, exchangeRates, players, playerLinks, onUpdatePlayers, onSave, onBack, onDelete }) {
  const { sessionId } = useParams();
  const game = games.find(g => g && g.id === sessionId);

  if (!game) {
    return (
      <div className="hud-corner-reticle bg-hud-card border border-white/10 p-12 text-center text-zinc-400 space-y-4 max-w-lg mx-auto shadow-2xl backdrop-blur-xl">
        <p className="text-lg font-bold text-white font-sans">Session Not Found</p>
        <p className="text-xs text-zinc-500 font-mono">The specified session UUID does not exist or was deleted.</p>
        <button 
          onClick={onBack} 
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-mono uppercase text-xs font-bold transition-all shadow-[0_0_10px_rgba(16,185,129,0.4)]"
        >
          Return to Sessions
        </button>
      </div>
    );
  }

  return (
    <GameEditor 
      game={game} 
      globalCurrency={globalCurrency}
      globalIncrement={globalIncrement}
      setGlobalIncrement={setGlobalIncrement}
      exchangeRates={exchangeRates}
      players={players}
      playerLinks={playerLinks}
      onUpdatePlayers={onUpdatePlayers}
      onSave={onSave}
      onBack={onBack}
      onDelete={() => onDelete(sessionId)}
    />
  );
}

function PlayerProfileRoute({ games, exchangeRates, globalCurrency, getPlayerDisplayName, onBack }) {
  const { playerName } = useParams();
  const decodedName = playerName ? decodeURIComponent(playerName) : '';

  return (
    <PlayerProfile 
      playerName={decodedName}
      games={games}
      exchangeRates={exchangeRates}
      globalCurrency={globalCurrency}
      getPlayerDisplayName={getPlayerDisplayName}
      onBack={onBack}
    />
  );
}
