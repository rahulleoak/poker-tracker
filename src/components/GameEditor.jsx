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
import SessionSettlementPanel from './SessionSettlementPanel';

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
  const [date, setDate] = useState(game?.date || new Date().toISOString().split('T')[0]);
  const [gameCurrency, setGameCurrency] = useState(game?.currency || 'USD');
  const [chipValue, setChipValue] = useState(game?.chipValue || 1);
  const [ratioChips, setRatioChips] = useState(game?.chipValue ? Math.round(1 / game.chipValue) : 100);
  const [ratioFiat, setRatioFiat] = useState(1);
  const [useBankBuddies, setUseBankBuddies] = useState(true);
  const [settlementCurrency, setSettlementCurrency] = useState(game?.currency || 'USD');
  const [entries, setEntries] = useState(() => {
    if (game?.entries && game.entries.length > 0) {
      return sanitizeEntries(game.entries, game?.currency || 'USD');
    }
    return [
      { id: generateId('entry'), name: '', buyIn: 0, buyOut: 0, stack: 0, currency: game?.currency || 'USD', isBank: false },
      { id: generateId('entry'), name: '', buyIn: 0, buyOut: 0, stack: 0, currency: game?.currency || 'USD', isBank: false }
    ];
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null);
  const [isParsingLog, setIsParsingLog] = useState(false);
  const [popoverIndex, setPopoverIndex] = useState(null);
  const [selectedMasterPlayerId, setSelectedMasterPlayerId] = useState('');
  const [newMasterPlayerName, setNewMasterPlayerName] = useState('');
  const [isCreatingNewPlayer, setIsCreatingNewPlayer] = useState(false);
  const [playerActionLoading, setPlayerActionLoading] = useState(false);
  const [playerActionError, setPlayerActionError] = useState(null);

  // Sync state if game prop fundamentally changes
  useEffect(() => {
    if (game) {
      setDate(game.date || new Date().toISOString().split('T')[0]);
      setGameCurrency(game.currency || 'USD');
      setChipValue(game.chipValue || 1);
      setRatioChips(game.chipValue ? Math.round(1 / game.chipValue) : 100);
      setRatioFiat(1);
      setSettlementCurrency(game.currency || 'USD');
      if (game.entries && game.entries.length > 0) {
        setEntries(sanitizeEntries(game.entries, game.currency || 'USD'));
      }
    }
  }, [game]);

  // Keep chipValue in sync with ratio inputs
  useEffect(() => {
    if (ratioChips > 0 && ratioFiat > 0) {
      setChipValue(ratioFiat / ratioChips);
    }
  }, [ratioChips, ratioFiat]);

  // Auto-save debounce
  const isFirstMount = useRef(true);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);
    const timer = setTimeout(async () => {
      try {
        const updatedGame = {
          ...game,
          date,
          currency: gameCurrency,
          chipValue,
          entries
        };
        await onSaveRef.current(updatedGame);
        setSaveStatus('saved');
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus('error');
        setSaveError(err.message || 'Failed to save changes');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [date, gameCurrency, chipValue, entries, game]);

  // Calculations
  const totalBuyIn = useMemo(() => {
    return entries.reduce((sum, e) => sum + (Number(e.buyIn) || 0), 0);
  }, [entries]);

  const totalBuyOut = useMemo(() => {
    return entries.reduce((sum, e) => sum + (Number(e.buyOut) || 0), 0);
  }, [entries]);

  const totalStack = useMemo(() => {
    return entries.reduce((sum, e) => sum + (Number(e.stack) || 0), 0);
  }, [entries]);

  const totalCashOut = totalBuyOut + totalStack;
  const netDifference = totalCashOut - totalBuyIn;
  const isBalanced = netDifference === 0;

  // Validation
  const validationErrors = useMemo(() => {
    const errors = [];
    const names = entries.map(e => (e.name || '').trim().toLowerCase()).filter(Boolean);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      errors.push("Duplicate player names detected. Please ensure names are unique.");
    }
    const hasNegative = entries.some(e => e.buyIn < 0 || e.buyOut < 0 || e.stack < 0);
    if (hasNegative) {
      errors.push("Chip values cannot be negative.");
    }
    return errors;
  }, [entries]);

  const handleEntryChange = (index, field, value) => {
    setEntries(prev => {
      const next = [...prev];
      if (field === 'isBank') {
        const currentCurrency = next[index].currency || gameCurrency;
        // If toggling on, uncheck any other bank in the same currency
        if (value) {
          next.forEach((e, idx) => {
            const eCurrency = e.currency || gameCurrency;
            if (idx !== index && eCurrency === currentCurrency) {
              next[idx] = { ...next[idx], isBank: false };
            }
          });
        }
        next[index] = { ...next[index], [field]: value };
      } else if (field === 'currency') {
        // If changing currency on a bank, ensure no collision in new currency
        if (next[index].isBank) {
          next.forEach((e, idx) => {
            const eCurrency = e.currency || gameCurrency;
            if (idx !== index && eCurrency === value && e.isBank) {
              next[idx] = { ...next[idx], isBank: false };
            }
          });
        }
        next[index] = { ...next[index], [field]: value };
      } else {
        next[index] = { ...next[index], [field]: value };
      }
      return next;
    });
  };

  const adjustValue = (index, field, delta) => {
    setEntries(prev => {
      const next = [...prev];
      const current = Number(next[index][field]) || 0;
      next[index] = { ...next[index], [field]: Math.max(0, current + delta) };
      return next;
    });
  };

  const handleAddRow = () => {
    setEntries(prev => [
      ...prev,
      { id: generateId('entry'), name: '', buyIn: 0, buyOut: 0, stack: 0, currency: gameCurrency, isBank: false }
    ]);
  };

  const handleRemoveRow = (index) => {
    if (entries.length <= 1) return;
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleLogFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsingLog(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const statsMap = parsePokerNowLogStats(text);
        const mergedEntries = mergeSessionEntries(entries, statsMap);
        setEntries(mergedEntries);
      } catch (err) {
        console.error("Error parsing log file:", err);
      } finally {
        setIsParsingLog(false);
      }
    };
    reader.readAsText(file);
    if (event.target) event.target.value = null;
  };

  // Identity Helpers
  const getLinkedPlayerInfo = (entry) => {
    const sessionName = (entry?.name || '').trim();
    const extId = entry?.externalId || entry?.pokerNowId || null;

    if (extId) {
      const link = playerLinks.find(l => l.external_player_id === extId);
      if (link) {
        const master = players.find(p => p.id === link.player_id);
        return { isLinked: true, masterPlayer: master, type: 'externalId' };
      }
    }

    if (sessionName) {
      const exactMatch = players.find(p => p.display_name.toLowerCase() === sessionName.toLowerCase());
      if (exactMatch) {
        return { isLinked: true, masterPlayer: exactMatch, type: 'exactName' };
      }
    }

    return { isLinked: false, masterPlayer: null, type: null };
  };

  const handleOpenLinkPopover = (index) => {
    const entry = entries[index];
    const linkInfo = getLinkedPlayerInfo(entry);
    setPopoverIndex(index);
    setSelectedMasterPlayerId(linkInfo.masterPlayer?.id || '');
    setNewMasterPlayerName('');
    setIsCreatingNewPlayer(false);
    setPlayerActionError(null);
  };

  const handleSaveLink = async () => {
    if (popoverIndex === null || !entries[popoverIndex]) return;
    const entry = entries[popoverIndex];
    const sessionName = (entry.name || '').trim();
    const extId = entry.externalId || entry.pokerNowId || null;

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      let targetPlayerId = selectedMasterPlayerId;

      if (isCreatingNewPlayer) {
        const trimmedNewName = newMasterPlayerName.trim();
        if (!trimmedNewName) {
          throw new Error("Player name cannot be empty");
        }

        if (supabase) {
          const { data: newP, error: pErr } = await supabase
            .from('players')
            .insert([{ display_name: trimmedNewName }])
            .select()
            .single();

          if (pErr) throw pErr;
          targetPlayerId = newP.id;
        } else {
          targetPlayerId = generateId('player');
        }
      }

      if (!targetPlayerId) {
        throw new Error("Please select or create a master player.");
      }

      if (extId && supabase) {
        const { error: lErr } = await supabase
          .from('player_links')
          .upsert([{ player_id: targetPlayerId, external_player_id: extId }], { onConflict: 'external_player_id' });
        if (lErr) throw lErr;
      }

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }

      setPopoverIndex(null);
    } catch (err) {
      console.error("Failed to link player:", err);
      setPlayerActionError(err.message || "Failed to link player");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (popoverIndex === null || !entries[popoverIndex]) return;
    const entry = entries[popoverIndex];
    const extId = entry.externalId || entry.pokerNowId || null;

    if (!extId) {
      setPopoverIndex(null);
      return;
    }

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      if (supabase) {
        const { error } = await supabase
          .from('player_links')
          .delete()
          .eq('external_player_id', extId);
        if (error) throw error;
      }

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }

      setPopoverIndex(null);
    } catch (err) {
      console.error("Failed to unlink player:", err);
      setPlayerActionError(err.message || "Failed to unlink player");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border border-slate-800 p-4 rounded-xl shadow-lg">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center gap-1 text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              Session Details
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-emerald-400 border border-slate-700">
                {date}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              <span>{entries.length} Players</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                Status: 
                {saveStatus === 'saving' && <span className="text-amber-400 font-medium animate-pulse">Saving...</span>}
                {saveStatus === 'saved' && <span className="text-emerald-400 font-medium flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> Saved</span>}
                {saveStatus === 'error' && <span className="text-rose-400 font-medium flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> {saveError || 'Save Error'}</span>}
                {saveStatus === 'idle' && <span className="text-slate-400">Up to date</span>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Quick Increment Controls */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs font-semibold text-slate-400">
            <span className="px-2 text-slate-500 uppercase tracking-wider text-[10px]">Step:</span>
            {[50, 100, 500].map(inc => (
              <button
                key={inc}
                onClick={() => setGlobalIncrement(inc)}
                className={`px-2 py-1 rounded transition-colors ${globalIncrement === inc ? 'bg-emerald-600 text-white font-bold' : 'hover:bg-slate-800 text-slate-400'}`}
              >
                ±{inc}
              </button>
            ))}
          </div>

          <label className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-medium">
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleLogFileUpload} 
              className="hidden" 
              disabled={isParsingLog}
            />
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>{isParsingLog ? 'Merging...' : 'Merge Log'}</span>
          </label>

          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
            title="Economics & Table Settings"
          >
            <Settings className="w-4 h-4 text-slate-400" />
            <span className="hidden md:inline">Settings</span>
          </button>

          {onDelete && (
            <button 
              onClick={onDelete}
              className="p-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium"
              title="Delete Session"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Ledger Editor on Left, Unified Settlement Panel on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Ledger Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
          <div className="p-4 border-b border-slate-800 bg-slate-950/50 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                Session Roster & Stacks
                <InfoTooltip text="Total Buy-Ins must match Total Cash-Outs (Buy-Outs + Ending Stacks) for the ledger to balance." />
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Input chip counts or steppers.</p>
            </div>

            {/* Zero-Sum Balance Indicator */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold ${
              isBalanced 
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400' 
                : 'bg-rose-950/40 border-rose-800/60 text-rose-400'
            }`}>
              {isBalanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              <span>
                {isBalanced 
                  ? 'Balanced (±0)' 
                  : `Diff: ${netDifference > 0 ? '+' : ''}${formatChips(netDifference)} chips`}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3">Player</th>
                  <th className="p-3 text-center">Currency</th>
                  <th className="p-3 text-center">Bank</th>
                  <th className="p-3 text-center">Buy-In</th>
                  <th className="p-3 text-center">Buy-Out</th>
                  <th className="p-3 text-center">Stack</th>
                  <th className="p-3 text-right">Net</th>
                  <th className="p-3 text-right w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-medium">
                {entries.map((entry, index) => {
                  const net = (Number(entry.buyOut) || 0) + (Number(entry.stack) || 0) - (Number(entry.buyIn) || 0);
                  const linkInfo = getLinkedPlayerInfo(entry);
                  const masterName = linkInfo.masterPlayer?.display_name;

                  return (
                    <tr key={entry.id || index} className="hover:bg-slate-800/40 transition-colors group">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <input 
                            type="text" 
                            value={entry.name}
                            onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                            placeholder="Player name..."
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 outline-none focus:border-emerald-500 w-32 sm:w-40 transition-all font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => handleOpenLinkPopover(index)}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              linkInfo.isLinked
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                : 'bg-slate-800/50 border-slate-700/50 text-slate-500 hover:text-slate-300'
                            }`}
                            title={linkInfo.isLinked ? `Linked to ${masterName}` : "Link to Master Player Profile"}
                          >
                            <Link className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      <td className="p-3 text-center">
                        <select 
                          value={entry.currency || gameCurrency}
                          onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-300 text-xs font-semibold outline-none focus:border-emerald-500 transition-colors"
                        >
                          {TOP_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>

                      <td className="p-3 text-center">
                        <input 
                          type="checkbox" 
                          checked={Boolean(entry.isBank)}
                          onChange={(e) => handleEntryChange(index, 'isBank', e.target.checked)}
                          className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
                          title="Designate as Bank for this currency"
                        />
                      </td>

                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', -globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry.buyIn === 0 ? '' : entry.buyIn}
                            onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-1 py-1.5 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      <td className="p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', -globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry.buyOut === 0 ? '' : entry.buyOut}
                            onChange={(e) => handleEntryChange(index, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-1 py-1.5 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', globalIncrement)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-md transition-colors shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" />
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
                            className="w-20 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-slate-200 outline-none focus:border-emerald-500 text-center transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
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
                  );
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

          {(validationErrors?.length ?? 0) > 0 && (
            <div className="p-4 bg-rose-950/30 border-t border-rose-900/50">
              {validationErrors.map((err, i) => (
                <p key={i} className="text-rose-400 text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {err}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Settlement Panel */}
        <div className="lg:col-span-1">
          <SessionSettlementPanel
            entries={entries}
            settlementConfig={{
              chipsPerCad: ratioChips && ratioFiat ? (ratioChips / ratioFiat) : (1 / (chipValue || 1)),
              cadToUsd: exchangeRates?.CAD ? (1 / exchangeRates.CAD) : 0.74,
              bankByCountry: (function() {
                const map = {};
                entries.forEach(e => {
                  if (e.isBank && e.currency) {
                    const cCode = e.currency === 'CAD' ? 'CA' : e.currency === 'USD' ? 'US' : 'CA';
                    map[cCode] = e.pokerNowId || e.externalId || e.name;
                  }
                });
                return map;
              })()
            }}
            sessionId={game?.id}
            startDate={date}
            gameCurrency={gameCurrency}
            chipValue={chipValue}
            exchangeRates={exchangeRates}
            nameOf={(pid) => {
              if (!pid) return null;
              const p = players.find(x => x.id === pid);
              return p ? p.display_name : null;
            }}
            isBalanced={isBalanced}
            totalBuyIn={totalBuyIn}
          />
        </div>

      </div>

      {/* In-Place Player Identity Link Popover Modal */}
      {popoverIndex !== null && entries[popoverIndex] && (() => {
        const targetEntry = entries[popoverIndex];
        const linkInfo = getLinkedPlayerInfo(targetEntry);
        const sessionName = (targetEntry.name || '').trim();

        return (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <Link className="w-5 h-5 text-emerald-400" />
                    Player Identity Link
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Map <span className="text-emerald-400 font-semibold">{sessionName || 'Unnamed'}</span> to a master profile.
                  </p>
                </div>
                <button 
                  onClick={() => setPopoverIndex(null)}
                  className="p-1 text-slate-400 hover:text-slate-200 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {playerActionError && (
                <div className="p-3 bg-rose-950/50 border border-rose-900/50 rounded-lg text-rose-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{playerActionError}</span>
                </div>
              )}

              <div className="space-y-3">
                {!isCreatingNewPlayer ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">Select Existing Master Player</label>
                    <select
                      value={selectedMasterPlayerId}
                      onChange={(e) => setSelectedMasterPlayerId(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    >
                      <option value="">-- Choose Master Player --</option>
                      {players.map(p => (
                        <option key={p.id} value={p.id}>{p.display_name}</option>
                      ))}
                    </select>

                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => { setIsCreatingNewPlayer(true); setNewMasterPlayerName(sessionName); }}
                        className="text-xs text-emerald-400 hover:text-emerald-300 font-medium inline-flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Create new master player instead
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1">New Master Player Name</label>
                    <input
                      type="text"
                      value={newMasterPlayerName}
                      onChange={(e) => setNewMasterPlayerName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    />

                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => setIsCreatingNewPlayer(false)}
                        className="text-xs text-slate-400 hover:text-slate-200 font-medium"
                      >
                        Select existing instead
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-slate-800">
                {linkInfo.isLinked ? (
                  <button
                    type="button"
                    onClick={handleUnlink}
                    disabled={playerActionLoading}
                    className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Unlink className="w-4 h-4" /> Unlink
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPopoverIndex(null)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLink}
                    disabled={playerActionLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {playerActionLoading ? 'Saving...' : 'Save Link'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-6">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" />
                Session Settings
              </h3>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Session Date</label>
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
                  <p className="text-[11px] text-slate-500 mt-1">1 Chip = {formatFiat(chipValue, gameCurrency)}</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
