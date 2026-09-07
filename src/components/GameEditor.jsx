import { useState, useMemo, useEffect, useRef } from "react";
import { 
  ChevronLeft, 
  Settings, 
  X, 
  Coins, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Minus, 
  Plus, 
  ArrowRight, 
  Landmark, 
  Globe, 
  DollarSign,
  Link,
  Unlink,
  UserPlus
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { TOP_CURRENCIES, formatFiat, formatChips } from '../utils/formatters';
import { calculateSettlement } from '../utils/settlement';
import { parsePokerNowLogStats } from '../utils/csvParser';
import { mergeSessionEntries } from '../utils/sessionMapper';
import InfoTooltip from './InfoTooltip';

const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

export default function GameEditor(props) {
  return <GameEditorInner key={props.game?.id} {...props} />;
}

function GameEditorInner({ 
  game, 
  globalIncrement = 100, 
  setGlobalIncrement, 
  exchangeRates, 
  players = [], 
  playerLinks = [], 
  onUpdatePlayers, 
  onSave, 
  onBack, 
  onDelete 
}) {
  // --- RESET STATE WHEN GAME PROP CHANGES ---
  const sanitizeEntries = (entries, currency) => {
    const seenBanks = {};
    return entries.map(entry => {
      const entryCurrency = entry.currency || currency;
      if (entry.isBank) {
        if (seenBanks[entryCurrency]) {
          return { ...entry, isBank: false };
        }
        seenBanks[entryCurrency] = true;
      }
      return entry;
    });
  };

  // Local state to manage edits without hitting DB on every keystroke
  const [date, setDate] = useState(() => game?.date || new Date().toISOString().split('T')[0]);
  const [gameCurrency, setGameCurrency] = useState(() => game?.currency || 'USD');
  const [isActive, setIsActive] = useState(() => game?.isActive !== false);
  const [pokerNowUrl, setPokerNowUrl] = useState(() => game?.pokerNowUrl || '');
  const [entries, setEntries] = useState(() => sanitizeEntries(Array.isArray(game?.entries) ? game.entries : [], game.currency || 'USD'));
  
  const [ratioChips, setRatioChips] = useState(() => {
    const chipVal = Number(game?.chipValue) || 1;
    if (chipVal === 1) return 1;
    if (chipVal > 0) {
      const inv = 1 / chipVal;
      if (Math.abs(inv - Math.round(inv)) < 0.001) return Math.round(inv);
    }
    return 1000;
  });
  
  const [ratioFiat, setRatioFiat] = useState(() => {
    const chipVal = Number(game?.chipValue) || 1;
    if (chipVal === 1) return 1;
    if (chipVal > 0) {
      const inv = 1 / chipVal;
      if (Math.abs(inv - Math.round(inv)) < 0.001) return 1;
    }
    return Number((chipVal * 1000).toFixed(2));
  });

  const chipValue = ratioChips > 0 ? ratioFiat / ratioChips : 0;

  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('general');
  const [settlementCurrency, setSettlementCurrency] = useState(() => game?.currency || 'USD');
  const [useBankBuddies, setUseBankBuddies] = useState(false);
  const [bankSettlementMode, setBankSettlementMode] = useState('strict');
  const [uploadSuccess, setUploadSuccess] = useState(null);

  // In-place identity linking popover state
  const [popoverIndex, setPopoverIndex] = useState(null);
  const [popoverPlayerId, setPopoverPlayerId] = useState('');
  const [popoverNewName, setPopoverNewName] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState(null);

  // --- AUTO-SAVE EFFECT ---
  const isMounted = useRef(false);
  const onSaveRef = useRef(onSave);
  const gameRef = useRef(game);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    if (!gameRef.current) return;
    const timer = setTimeout(() => {
      if (onSaveRef.current) {
        onSaveRef.current({
          ...gameRef.current,
          date,
          currency: gameCurrency,
          chipValue,
          isActive,
          pokerNowUrl,
          entries
        });
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [date, gameCurrency, chipValue, isActive, pokerNowUrl, entries]);

  // Derived calculations for the current session via extracted utility function
  const { totalBuyIn, totalCashOut, isBalanced, settlements, chipsOnTable, validationErrors } = useMemo(() => {
    return calculateSettlement({
      entries,
      chipValue,
      gameCurrency,
      settlementCurrency,
      exchangeRates,
      useBankBuddies,
      bankSettlementMode
    });
  }, [entries, chipValue, gameCurrency, settlementCurrency, exchangeRates, useBankBuddies, bankSettlementMode]);

  // Identity Linking Helpers
  const getLinkedPlayerInfo = (entry) => {
    if (!entry) return null;
    const sessionName = (entry.name || '').trim();
    const extId = (entry.externalId || entry.pokerNowId || '').trim();
    if (!sessionName && !extId) return null;

    const normName = sessionName.toLowerCase();
    const normExt = extId.toLowerCase();

    const foundLink = playerLinks.find(l => {
      const ext = (l.external_id || '').trim().toLowerCase();
      return (normExt && ext === normExt) || (normName && ext === normName);
    });

    if (foundLink) {
      const player = players.find(p => p.id === foundLink.player_id);
      return { player: player || null, link: foundLink, isDirectLink: true };
    }

    if (normName) {
      const directPlayer = players.find(p => (p.display_name || '').trim().toLowerCase() === normName);
      if (directPlayer) {
        return { player: directPlayer, link: null, isDirectLink: false };
      }
    }

    return null;
  };

  const isEntryLinked = (entry) => {
    return Boolean(getLinkedPlayerInfo(entry));
  };

  const handleOpenLinkPopover = (i, entry) => {
    setPopoverIndex(i);
    setPopoverPlayerId('');
    setPopoverNewName((entry?.name || '').trim());
    setLinkError(null);
  };

  const handleLinkToExistingPlayer = async (targetEntry, playerId) => {
    if (!targetEntry || !playerId) return;
    setLinkLoading(true);
    setLinkError(null);

    const sessionName = (targetEntry.name || '').trim();
    const extId = (targetEntry.externalId || targetEntry.pokerNowId || '').trim();
    const linkValues = Array.from(new Set([sessionName, extId].filter(Boolean)));

    try {
      if (supabase) {
        for (const val of linkValues) {
          const exists = playerLinks.some(l => 
            l.player_id === playerId && (l.external_id || '').trim().toLowerCase() === val.toLowerCase()
          );
          if (!exists) {
            const platform = (extId && val === extId) ? 'pokernow' : 'alias';
            const { error } = await supabase.from('player_links').insert([{
              player_id: playerId,
              platform,
              external_id: val
            }]);
            if (error) throw error;
          }
        }
      }

      const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
      let updatedLinks = [...currentLinks];
      for (const val of linkValues) {
        const exists = updatedLinks.some(l => 
          l.player_id === playerId && (l.external_id || '').trim().toLowerCase() === val.toLowerCase()
        );
        if (!exists) {
          const platform = (extId && val === extId) ? 'pokernow' : 'alias';
          updatedLinks.push({
            id: generateId('local-link'),
            player_id: playerId,
            platform,
            external_id: val
          });
        }
      }
      localStorage.setItem('offsuite_player_links', JSON.stringify(updatedLinks));

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }
      setPopoverIndex(null);
    } catch (err) {
      console.error("Error linking player identity:", err);
      setLinkError(err.message || "Failed to link identity");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleCreateAndLinkPlayer = async (targetEntry, newPlayerDisplayName) => {
    const displayName = (newPlayerDisplayName || '').trim();
    if (!targetEntry || !displayName) return;
    setLinkLoading(true);
    setLinkError(null);

    try {
      let createdPlayerId = null;

      if (supabase) {
        const { data, error } = await supabase
          .from('players')
          .insert([{ display_name: displayName }])
          .select()
          .single();

        if (error) throw error;
        if (data && data.id) {
          createdPlayerId = data.id;
        }
      }

      if (!createdPlayerId) {
        createdPlayerId = `local-player-${Date.now()}`;
        const newLocalPlayer = { id: createdPlayerId, display_name: displayName, created_at: new Date().toISOString() };
        const currentPlayers = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        localStorage.setItem('offsuite_players', JSON.stringify([...currentPlayers, newLocalPlayer]));
      }

      const sessionName = (targetEntry.name || '').trim();
      const extId = (targetEntry.externalId || targetEntry.pokerNowId || '').trim();
      const linkValues = Array.from(new Set([sessionName, extId].filter(Boolean)));

      if (supabase) {
        for (const val of linkValues) {
          const platform = (extId && val === extId) ? 'pokernow' : 'alias';
          await supabase.from('player_links').insert([{
            player_id: createdPlayerId,
            platform,
            external_id: val
          }]);
        }
      }

      const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
      let updatedLinks = [...currentLinks];
      for (const val of linkValues) {
        const platform = (extId && val === extId) ? 'pokernow' : 'alias';
        updatedLinks.push({
          id: generateId('local-link'),
          player_id: createdPlayerId,
          platform,
          external_id: val
        });
      }
      localStorage.setItem('offsuite_player_links', JSON.stringify(updatedLinks));

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }
      setPopoverIndex(null);
    } catch (err) {
      console.error("Error creating and linking player:", err);
      setLinkError(err.message || "Failed to create player identity");
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlinkPlayer = async (linkId) => {
    if (!linkId) return;
    setLinkLoading(true);
    try {
      if (supabase) {
        await supabase.from('player_links').delete().eq('id', linkId);
      }
      const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]').filter(l => l.id !== linkId);
      localStorage.setItem('offsuite_player_links', JSON.stringify(currentLinks));

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }
    } catch (err) {
      console.error("Error unlinking identity:", err);
    } finally {
      setLinkLoading(false);
    }
  };

  if (!game) {
    return (
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl text-center space-y-4">
        <h3 className="text-xl font-bold text-slate-200">Session Not Found</h3>
        <p className="text-sm text-slate-400">The requested poker session could not be found or loaded.</p>
        <button 
          onClick={onBack}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Return to Sessions List
        </button>
      </div>
    );
  }

  // Handlers
  const handleEntryChange = (index, field, value) => {
    const newEntries = [...entries];
    if (newEntries[index]) {
      // If we are changing currency, and they are a bank, we must un-bank them
      // because they can only be a bank for their current currency.
      if (field === 'currency' && newEntries[index].isBank) {
        newEntries[index] = { ...newEntries[index], isBank: false };
      }
      newEntries[index] = { ...newEntries[index], [field]: value };
      setEntries(newEntries);
    }
  };

  const handleBankChange = (index, isBank, currency) => {
    const newEntries = [...entries];
    if (isBank) {
        newEntries.forEach((e, i) => {
            if ((e.currency || gameCurrency) === currency && newEntries[i]) {
              newEntries[i] = { ...newEntries[i], isBank: false };
            }
        });
    }
    if (newEntries[index]) {
      newEntries[index] = { ...newEntries[index], isBank };
      setEntries(newEntries);
    }
  };

  const handleAddRow = () => {
    setEntries([...entries, { 
      name: '', 
      buyIn: 0, 
      buyOut: 0, 
      stack: 0, 
      currency: gameCurrency, 
      isBank: false,
      handsPlayed: 0,
      vpipHands: 0,
      pfrHands: 0,
      threeBetOpps: 0,
      threeBetHands: 0
    }]);
  };

  const handleHandLogUpload = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const stats = parsePokerNowLogStats(text);
        
        const handMatches = text.match(/-- starting hand #\d+/gi);
        const totalHands = handMatches ? handMatches.length : Object.values(stats).reduce((max, s) => Math.max(max, s.handsPlayed || 0), 0);

        const incomingStatsEntries = Object.values(stats).map(s => ({
          name: s.name,
          externalId: s.externalId || null,
          pokerNowId: s.pokerNowId || null,
          buyIn: 0,
          buyOut: 0,
          stack: 0,
          currency: gameCurrency,
          isBank: false,
          handsPlayed: s.handsPlayed || 0,
          vpipHands: s.vpipHands || 0,
          pfrHands: s.pfrHands || 0,
          threeBetOpps: s.threeBetOpps || 0,
          threeBetHands: s.threeBetHands || 0
        }));

        const updatedEntries = mergeSessionEntries(entries, incomingStatsEntries);

        setEntries(updatedEntries);
        setUploadSuccess(`Successfully parsed and accumulated stats for ${totalHands} hands (${Object.keys(stats).length} players). Cumulative stats updated.`);
      } catch (err) {
        console.error("Failed to parse hand log file:", err);
        alert("Failed to parse hand history log file.");
      }
    };
    reader.readAsText(file);
    if (event.target) event.target.value = null;
  };

  const handleRemoveRow = (index) => {
    setEntries(entries.filter((_, i) => i !== index));
  };

  const handleBack = () => {
    // Force one final save
    if (onSaveRef.current) {
      onSaveRef.current({
        ...game, date, currency: gameCurrency, chipValue, isActive, pokerNowUrl, entries
      });
    }
    onBack();
  };

  const adjustValue = (index, field, amount) => {
    if (!entries[index]) return;
    const currentValue = Number(entries[index][field]) || 0;
    const newValue = Math.max(0, currentValue + (Number(amount) || 0)); 
    handleEntryChange(index, field, newValue);
  };

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
                          onChange={(e) => setGlobalIncrement && setGlobalIncrement(Number(e.target.value) || 0)}
                          className="w-full bg-slate-900 border border-slate-700 text-slate-200 rounded-lg pl-9 pr-3 py-2 outline-none focus:border-emerald-500 transition-colors [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t border-slate-800 space-y-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Poker Now Link</label>
                    <input 
                      type="url"
                      placeholder="https://www.pokernow.club/games/..."
                      value={pokerNowUrl}
                      onChange={(e) => setPokerNowUrl(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-200 text-sm outline-none focus:border-emerald-500"
                    />

                    <div className="pt-2">
                      <label className="block text-xs font-medium text-slate-500 mb-1">Attach Hand History Log File (.csv, .txt)</label>
                      <input 
                        type="file"
                        accept=".csv,.txt"
                        onChange={handleHandLogUpload}
                        className="w-full bg-slate-950 border border-slate-700 text-slate-300 text-xs rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer"
                      />
                      {uploadSuccess && (
                        <div className="mt-2.5 p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-lg flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span>{uploadSuccess}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {activeSettingsTab === 'banks' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                   <p className="text-xs text-slate-400 mb-4 bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                     Assign regional currencies and designate a <strong className="text-emerald-400">Bank Buddy</strong>. The algorithm will consolidate cross-border debts so players only transfer money locally.
                   </p>
                   
                   <div className="flex items-center justify-between p-3 bg-slate-950/50 border border-slate-800 rounded-lg mb-4">
                     <span className="text-xs font-medium text-slate-400">Settlement Mode</span>
                     <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
                       <button
                         onClick={() => setBankSettlementMode('strict')}
                         className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${bankSettlementMode === 'strict' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                       >
                         Strict
                       </button>
                       <button
                         onClick={() => setBankSettlementMode('international-only')}
                         className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${bankSettlementMode === 'international-only' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                       >
                         Intl. Only
                       </button>
                     </div>
                   </div>

                   <div className="space-y-2">
                     {entries.filter(e => e && (e.name || '').trim() !== '').map((entry, idx) => {
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

      {/* Main Single Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between items-start sm:items-center gap-4"> 
        <div className="flex items-center gap-4">
          <button onClick={handleBack} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors text-slate-300">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-100">Session Ledger</h2>
              {/* Poker Now Link & Glow */}
              {pokerNowUrl && (
                <a
                  href={pokerNowUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`transition-all duration-500 flex items-center justify-center p-1.5 rounded-lg ${
                    isActive 
                      ? 'text-emerald-400 bg-emerald-500/10 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]' 
                      : 'text-rose-400 bg-rose-500/10 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                  }`}
                  title={isActive ? "Open Poker Now Table (Active)" : "Open Poker Now Table (Closed)"}
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

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {/* Active Session Slider */}
          <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg">
             <span className={`text-sm font-semibold transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                {isActive ? 'Live' : 'Closed'}
             </span>
             <button
                onClick={() => setIsActive(!isActive)}
                className={`w-12 h-6 rounded-full transition-colors relative ${isActive ? 'bg-emerald-500' : 'bg-rose-500'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${isActive ? 'translate-x-7' : 'translate-x-1'}`} />
              </button>
          </div>

          <button 
            onClick={() => setShowSettings(!showSettings)}
            className={`p-2.5 rounded-lg transition-colors border ${showSettings ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}
            title="Settings"
          >
            <Settings className="w-5 h-5" />
          </button>

          <button 
            onClick={onDelete}
            className="p-2.5 bg-slate-800 hover:bg-rose-500/20 border border-slate-700 hover:border-rose-500/50 rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
            title="Delete Session"
          >
            <Trash2 className="w-5 h-5" />
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
          
          <style>{`
            input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
          `}</style>

          {/* Mobile Card View (< sm) */}
          <div className="block sm:hidden divide-y divide-slate-800">
            {entries.map((entry, index) => {
              if (!entry) return null;
              const sessionCashOut = (Number(entry.buyOut) || 0) + (Number(entry.stack) || 0);
              const net = sessionCashOut - (Number(entry.buyIn) || 0);
              const isLinked = isEntryLinked(entry);

              return (
                <div key={index} className="p-4 space-y-3 bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenLinkPopover(index, entry)}
                      className={`p-2 rounded-lg transition-all shrink-0 ${
                        isLinked 
                          ? 'text-emerald-400 bg-emerald-500/10 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)] border border-emerald-500/30' 
                          : 'text-slate-500 hover:text-slate-300 bg-slate-950 border border-slate-800'
                      }`}
                      title={isLinked ? 'Mapped to player profile (click to view/edit link)' : 'Link player to master profile'}
                    >
                      <Link className="w-4 h-4" />
                    </button>

                    <div className="relative flex-1">
                      <input 
                        type="text" 
                        placeholder="Player name..."
                        value={entry.name || ''}
                        onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-16 py-2.5 text-slate-200 outline-none focus:border-emerald-500 text-sm"
                      />
                      <select
                        value={entry.currency || 'USD'}
                        onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold px-1.5 py-1.5 outline-none uppercase"
                      >
                        {TOP_CURRENCIES.map(c => <option key={c} value={c} className="bg-slate-900 text-slate-200">{c}</option>)}
                      </select>
                    </div>
                    <button 
                      onClick={() => handleRemoveRow(index)}
                      className="p-2.5 bg-slate-800/80 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                      title="Delete Player"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 space-y-1">
                      <span className="text-slate-500 block">Buy-In (🪙)</span>
                      <div className="flex items-center justify-between gap-1">
                        <button 
                          onClick={() => adjustValue(index, 'buyIn', -globalIncrement)}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input 
                          type="number" 
                          min="0"
                          value={entry.buyIn === 0 ? '' : entry.buyIn}
                          onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-16 bg-slate-900 border border-slate-800 rounded-lg py-1.5 text-slate-200 text-center outline-none focus:border-emerald-500 [-moz-appearance:_textfield]"
                        />
                        <button 
                          onClick={() => adjustValue(index, 'buyIn', globalIncrement)}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 space-y-1">
                      <span className="text-slate-500 block">Buy-Out (🪙)</span>
                      <div className="flex items-center justify-between gap-1">
                        <button 
                          onClick={() => adjustValue(index, 'buyOut', -globalIncrement)}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                        <input 
                          type="number" 
                          min="0"
                          value={entry.buyOut === 0 ? '' : entry.buyOut}
                          onChange={(e) => handleEntryChange(index, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-16 bg-slate-900 border border-slate-800 rounded-lg py-1.5 text-slate-200 text-center outline-none focus:border-emerald-500 [-moz-appearance:_textfield]"
                        />
                        <button 
                          onClick={() => adjustValue(index, 'buyOut', globalIncrement)}
                          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">Current Stack:</span>
                      <input 
                        type="number" 
                        min="0"
                        value={entry.stack === 0 ? '' : entry.stack}
                        onChange={(e) => handleEntryChange(index, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 text-center outline-none focus:border-emerald-500 [-moz-appearance:_textfield]"
                      />
                    </div>
                    <div className="text-right">
                      <span className="text-slate-500 block text-[10px]">Net Chips</span>
                      <span className={`font-bold text-sm ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {net > 0 ? '+' : ''}{net === 0 ? `0` : formatChips(net)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table View (sm:block) */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-800">
                  <th className="p-3 font-medium min-w-[150px]"><InfoTooltip label="Player Name" content="Participant name or nickname in the poker session." /></th>
                  <th className="p-3 font-medium text-center min-w-[140px]"><InfoTooltip label="Buy Ins (🪙)" content="Total chips purchased by the player to enter or reload during the game." /></th>
                  <th className="p-3 font-medium text-center min-w-[140px]"><InfoTooltip label="Buy Outs (🪙)" content="Chips cashed out or removed by the player mid-game before session end." /></th>
                  <th className="p-3 font-medium text-center min-w-[100px]"><InfoTooltip label="Current Stack" content="Chips held by the player at the conclusion of the session." /></th>
                  <th className="p-3 font-medium text-right min-w-[80px]"><InfoTooltip label="Net Chips" content="Total chips won or lost (Cash Out + Stack minus Buy Ins)." /></th>
                  <th className="p-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {entries.map((entry, index) => {
                  if (!entry) return null;
                  const sessionCashOut = (Number(entry.buyOut) || 0) + (Number(entry.stack) || 0);
                  const net = sessionCashOut - (Number(entry.buyIn) || 0);
                  const isLinked = isEntryLinked(entry);
                  
                  return (
                    <tr key={index} className="hover:bg-slate-800/20 group">
                      <td className="p-3 min-w-[220px]">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenLinkPopover(index, entry)}
                            className={`p-1.5 rounded-lg transition-all shrink-0 ${
                              isLinked 
                                ? 'text-emerald-400 bg-emerald-500/10 drop-shadow-[0_0_8px_rgba(16,185,129,0.8)] border border-emerald-500/30' 
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800 border border-transparent'
                            }`}
                            title={isLinked ? 'Mapped to player profile (click to view/edit link)' : 'Link player to master profile'}
                          >
                            <Link className="w-4 h-4" />
                          </button>

                          <div className="relative flex-1">
                            <input 
                              type="text" 
                              placeholder="Player name..."
                              value={entry.name || ''}
                              onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-16 py-2 text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-600"
                            />
                            <select
                              value={entry.currency || 'USD'}
                              onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded text-[10px] font-bold px-1.5 py-1 outline-none cursor-pointer appearance-none hover:bg-indigo-500/20 transition-colors uppercase"
                            >
                              {TOP_CURRENCIES.map(c => <option key={c} value={c} className="bg-slate-900 text-slate-200">{c}</option>)}
                            </select>
                          </div>
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
          {validationErrors.length > 0 && (
            <div className="p-4 bg-rose-950/30 border-t border-rose-900/50">
                {validationErrors.map((err, i) => <p key={i} className="text-rose-400 text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {err}</p>)}
            </div>
          )}
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
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg gap-3">
                      <div className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
                        <span className="font-semibold text-rose-400 text-sm truncate block" title={tx.from}>{tx.from}</span>
                        <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 text-slate-600 shrink-0" />
                        <span className="font-semibold text-emerald-400 text-sm truncate block" title={tx.to}>{tx.to}</span>
                      </div>
                      <div className="flex flex-col items-end shrink-0 pl-2">
                        <span className="font-bold text-slate-200 text-sm">{formatFiat(tx.amount, settlementCurrency)}</span>
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
                        Live FX: 1 {gameCurrency} = {((exchangeRates[settlementCurrency] || 1) / (exchangeRates[gameCurrency] || 1)).toFixed(4)} {settlementCurrency}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
      {/* In-Place Player Identity Link Popover Modal */}
      {popoverIndex !== null && entries[popoverIndex] && (() => {
        const targetEntry = entries[popoverIndex];
        const linkInfo = getLinkedPlayerInfo(targetEntry);
        const sessionName = (targetEntry.name || '').trim();

        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
              
              {/* Popover Header */}
              <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                <div>
                  <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
                    <Link className="w-5 h-5 text-emerald-400" />
                    Link Player Identity
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Session name: <span className="font-semibold text-slate-200">{sessionName || 'Unassigned'}</span>
                  </p>
                </div>
                <button 
                  onClick={() => setPopoverIndex(null)} 
                  disabled={linkLoading}
                  className="text-slate-400 hover:text-slate-200 p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Popover Body */}
              <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                {linkError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs rounded-xl">
                    {linkError}
                  </div>
                )}

                {/* Current Link Status Banner */}
                {linkInfo ? (
                  <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className="text-[10px] uppercase font-bold text-emerald-400 tracking-wider">Mapped Profile</span>
                      <p className="font-bold text-slate-100 text-sm">
                        {linkInfo.player ? linkInfo.player.display_name : sessionName}
                      </p>
                    </div>
                    {linkInfo.link && (
                      <button
                        onClick={() => handleUnlinkPlayer(linkInfo.link.id)}
                        disabled={linkLoading}
                        className="px-2.5 py-1 text-xs bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-400 border border-slate-700 rounded-lg transition-colors flex items-center gap-1 shrink-0"
                        title="Unlink identity"
                      >
                        <Unlink className="w-3.5 h-3.5" /> Unlink
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-xs text-slate-400">
                    This ledger entry is currently unlinked to any master profile. Link it below so session stats aggregate accurately.
                  </div>
                )}

                {/* Option 1: Link to Existing Player */}
                <div className="space-y-3 pt-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Link className="w-4 h-4 text-emerald-400" />
                    Select Existing Profile
                  </h4>
                  <div className="flex gap-2">
                    <select
                      value={popoverPlayerId}
                      onChange={(e) => setPopoverPlayerId(e.target.value)}
                      disabled={linkLoading || players.length === 0}
                      className="flex-1 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500 transition-colors font-medium disabled:opacity-50"
                    >
                      <option value="">-- Choose Profile --</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id}>{p.display_name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleLinkToExistingPlayer(targetEntry, popoverPlayerId)}
                      disabled={linkLoading || !popoverPlayerId}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all shrink-0"
                    >
                      {linkLoading ? 'Saving...' : 'Link'}
                    </button>
                  </div>
                  {players.length === 0 && (
                    <p className="text-[11px] text-slate-500 italic">No existing master profiles found.</p>
                  )}
                </div>

                <div className="relative flex py-1 items-center">
                  <div className="flex-grow border-t border-slate-800"></div>
                  <span className="flex-shrink mx-3 text-slate-600 text-[10px] uppercase font-bold tracking-wider">or</span>
                  <div className="flex-grow border-t border-slate-800"></div>
                </div>

                {/* Option 2: Create New Profile & Link */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-emerald-400" />
                    Create New Profile & Link
                  </h4>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Master Profile Name..."
                      value={popoverNewName}
                      onChange={(e) => setPopoverNewName(e.target.value)}
                      disabled={linkLoading}
                      className="flex-1 bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 rounded-xl px-3 py-2 text-sm outline-none focus:border-emerald-500 transition-colors"
                    />
                    <button
                      onClick={() => handleCreateAndLinkPlayer(targetEntry, popoverNewName)}
                      disabled={linkLoading || !popoverNewName.trim()}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all shrink-0"
                    >
                      {linkLoading ? 'Creating...' : 'Create & Link'}
                    </button>
                  </div>
                </div>

              </div>

              {/* Popover Footer */}
              <div className="p-4 border-t border-slate-800 bg-slate-900 flex justify-end">
                <button 
                  onClick={() => setPopoverIndex(null)}
                  disabled={linkLoading}
                  className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
}
