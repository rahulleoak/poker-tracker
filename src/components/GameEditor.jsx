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
  UserPlus,
  Check
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { TOP_CURRENCIES, formatFiat, formatChips } from '../utils/formatters';
import { calculateSettlement } from '../utils/settlement';
import { keyOfEntry } from '../utils/bankSettlement';
import { parsePokerNowLogStats } from '../utils/csvParser';
import { mergeSessionEntries } from '../utils/sessionMapper';
import InfoTooltip from './InfoTooltip';
import SessionSettlementPanel from './SessionSettlementPanel';

const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
const norm = (v) => String(v || '').trim().toLowerCase();

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
  const sanitizeEntries = (rawEntries, currency) => {
    const seenBanks = {};
    const safeList = Array.isArray(rawEntries) ? rawEntries : [];
    return safeList.map(entry => {
      const entryCurrency = entry?.currency || currency;
      if (entry?.isBank) {
        if (seenBanks[entryCurrency]) {
          return { ...entry, isBank: false };
        }
        seenBanks[entryCurrency] = true;
      }
      return entry || {};
    });
  };

  // Local state to manage edits without hitting DB on every keystroke
  const [date, setDate] = useState(game?.date || new Date().toISOString().split('T')[0]);
  const [gameCurrency, setGameCurrency] = useState(game?.currency || 'USD');
  const [chipValue, setChipValue] = useState(game?.chipValue || 1);
  const [ratioChips, setRatioChips] = useState(game?.chipValue ? Math.round(1 / game.chipValue) : 100);
  const [ratioFiat, setRatioFiat] = useState(1);
  const [entries, setEntries] = useState(() => {
    if (game?.entries && Array.isArray(game.entries) && game.entries.length > 0) {
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
      if (game.entries && Array.isArray(game.entries) && game.entries.length > 0) {
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
  const safeEntries = useMemo(() => Array.isArray(entries) ? entries : [], [entries]);

  const totalBuyIn = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.buyIn) || 0), 0);
  }, [safeEntries]);

  const totalBuyOut = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.buyOut) || 0), 0);
  }, [safeEntries]);

  const totalStack = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.stack) || 0), 0);
  }, [safeEntries]);

  const totalCashOut = totalBuyOut + totalStack;
  const netDifference = totalCashOut - totalBuyIn;
  const isBalanced = netDifference === 0;

  // Validation
  const validationErrors = useMemo(() => {
    const errors = [];
    const names = safeEntries.map(e => (e?.name || '').trim().toLowerCase()).filter(Boolean);
    const uniqueNames = new Set(names);
    if (names.length !== uniqueNames.size) {
      errors.push("Duplicate player names detected. Please ensure names are unique.");
    }
    const hasNegative = safeEntries.some(e => Number(e?.buyIn) < 0 || Number(e?.buyOut) < 0 || Number(e?.stack) < 0);
    if (hasNegative) {
      errors.push("Chip values cannot be negative.");
    }
    return errors;
  }, [safeEntries]);

  const handleEntryChange = (index, field, value) => {
    setEntries(prev => {
      const next = [...(Array.isArray(prev) ? prev : [])];
      if (!next[index]) return next;
      if (field === 'isBank') {
        const currentCurrency = next[index].currency || gameCurrency;
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
      const next = [...(Array.isArray(prev) ? prev : [])];
      if (!next[index]) return next;
      const current = Number(next[index][field]) || 0;
      next[index] = { ...next[index], [field]: Math.max(0, current + delta) };
      return next;
    });
  };

  const handleAddRow = () => {
    setEntries(prev => [
      ...(Array.isArray(prev) ? prev : []),
      { id: generateId('entry'), name: '', buyIn: 0, buyOut: 0, stack: 0, currency: gameCurrency, isBank: false }
    ]);
  };

  const handleRemoveRow = (index) => {
    if (safeEntries.length <= 1) return;
    setEntries(prev => (Array.isArray(prev) ? prev : []).filter((_, i) => i !== index));
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
        const mergedEntries = mergeSessionEntries(safeEntries, statsMap);
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

  // --- IDENTITY HELPERS ---
  const getLinkedPlayerInfo = (entry) => {
    const sessionName = (entry?.name || '').trim();
    const normSessionName = norm(sessionName);
    const extId = (entry?.externalId || entry?.pokerNowId || '').trim();
    const normExtId = norm(extId);

    const safePlayerLinks = Array.isArray(playerLinks) ? playerLinks : [];
    const safePlayers = Array.isArray(players) ? players : [];

    // 1. Check external ID / PokerNow ID match
    if (normExtId) {
      const link = safePlayerLinks.find(l => {
        const linkExt = norm(l.external_id || l.external_player_id);
        return linkExt === normExtId;
      });
      if (link) {
        const master = safePlayers.find(p => p.id === link.player_id);
        if (master) return { isLinked: true, masterPlayer: master, type: 'externalId' };
      }
    }

    // 2. Check alias / session name match
    if (normSessionName) {
      const link = safePlayerLinks.find(l => {
        const linkAlias = norm(l.external_id || l.external_player_id || l.session_name);
        return linkAlias === normSessionName;
      });
      if (link) {
        const master = safePlayers.find(p => p.id === link.player_id);
        if (master) return { isLinked: true, masterPlayer: master, type: 'alias' };
      }

      // 3. Direct display name match
      const exactMatch = safePlayers.find(p => norm(p.display_name) === normSessionName);
      if (exactMatch) {
        return { isLinked: true, masterPlayer: exactMatch, type: 'exactName' };
      }
    }

    return { isLinked: false, masterPlayer: null, type: null };
  };

  const handleOpenLinkPopover = (index) => {
    const entry = safeEntries[index];
    const linkInfo = getLinkedPlayerInfo(entry);
    setPopoverIndex(index);
    setSelectedMasterPlayerId(linkInfo.masterPlayer?.id || '');
    setNewMasterPlayerName('');
    setIsCreatingNewPlayer(false);
    setPlayerActionError(null);
  };

  const handleSaveLink = async () => {
    if (popoverIndex === null || !safeEntries[popoverIndex]) return;
    const entry = safeEntries[popoverIndex];
    const sessionName = (entry.name || '').trim();
    const extId = (entry.externalId || entry.pokerNowId || '').trim();
    const normExtId = norm(extId);
    const normSessionName = norm(sessionName);

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      let targetPlayerId = selectedMasterPlayerId;
      let targetPlayerName = '';

      if (isCreatingNewPlayer) {
        const trimmedNewName = newMasterPlayerName.trim();
        if (!trimmedNewName) {
          throw new Error("Player name cannot be empty");
        }

        const safePlayersList = Array.isArray(players) ? players : [];
        const existingPlayer = safePlayersList.find(
          p => norm(p.display_name) === norm(trimmedNewName)
        );

        if (existingPlayer) {
          targetPlayerId = existingPlayer.id;
          targetPlayerName = existingPlayer.display_name;
        } else if (supabase) {
          const { data: newP, error: pErr } = await supabase
            .from('players')
            .insert([{ display_name: trimmedNewName }])
            .select()
            .single();

          if (pErr) throw pErr;
          targetPlayerId = newP.id;
          targetPlayerName = newP.display_name;
        } else {
          targetPlayerId = generateId('player');
          targetPlayerName = trimmedNewName;
        }
      } else {
        const safePlayersList = Array.isArray(players) ? players : [];
        const found = safePlayersList.find(p => p.id === targetPlayerId);
        targetPlayerName = found ? found.display_name : '';
      }

      if (!targetPlayerId) {
        throw new Error("Please select or create a master player.");
      }

      // Determine identity tokens to link
      const tokensToLink = [];
      if (extId) tokensToLink.push({ ext: extId, platform: 'pokernow', isExtId: true });
      if (sessionName && (!extId || normExtId !== normSessionName)) {
        tokensToLink.push({ ext: sessionName, platform: 'alias', isExtId: false });
      }

      // 1. Supabase update/insert if connected
      if (supabase) {
        for (const t of tokensToLink) {
          const { data: existingLinks } = await supabase
            .from('player_links')
            .select('id, player_id')
            .or(`external_id.eq.${t.ext},external_player_id.eq.${t.ext},session_name.eq.${t.ext}`);

          if (existingLinks && existingLinks.length > 0) {
            for (const l of existingLinks) {
              await supabase
                .from('player_links')
                .update({ player_id: targetPlayerId })
                .eq('id', l.id);
            }
          } else {
            await supabase
              .from('player_links')
              .insert([{
                player_id: targetPlayerId,
                platform: t.platform,
                external_id: t.ext,
                external_player_id: t.isExtId ? t.ext : null,
                session_name: !t.isExtId ? t.ext : null
              }]);
          }
        }
      }

      // 2. LocalStorage update for offline reliability
      try {
        const localPlayers = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        if (isCreatingNewPlayer && !localPlayers.some(p => p.id === targetPlayerId)) {
          localPlayers.push({ id: targetPlayerId, display_name: targetPlayerName });
          localStorage.setItem('offsuite_players', JSON.stringify(localPlayers));
        }

        const localLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        for (const t of tokensToLink) {
          const idx = localLinks.findIndex(l => 
            norm(l.external_id) === norm(t.ext) || 
            norm(l.external_player_id) === norm(t.ext) || 
            norm(l.session_name) === norm(t.ext)
          );
          if (idx >= 0) {
            localLinks[idx].player_id = targetPlayerId;
          } else {
            localLinks.push({
              id: generateId('link'),
              player_id: targetPlayerId,
              platform: t.platform,
              external_id: t.ext,
              external_player_id: t.isExtId ? t.ext : null,
              session_name: !t.isExtId ? t.ext : null
            });
          }
        }
        localStorage.setItem('offsuite_player_links', JSON.stringify(localLinks));
      } catch (e) {
        console.warn("Could not save to localStorage:", e);
      }

      // 3. Update entry in active state
      setEntries(prev => {
        const next = [...(Array.isArray(prev) ? prev : [])];
        if (next[popoverIndex]) {
          next[popoverIndex] = {
            ...next[popoverIndex],
            playerId: targetPlayerId
          };
        }
        return next;
      });

      // 4. Trigger parent refresh
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
    if (popoverIndex === null || !safeEntries[popoverIndex]) return;
    const entry = safeEntries[popoverIndex];
    const sessionName = (entry.name || '').trim();
    const extId = (entry.externalId || entry.pokerNowId || '').trim();
    const normExtId = norm(extId);
    const normSessionName = norm(sessionName);

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      if (supabase) {
        if (extId) {
          await supabase
            .from('player_links')
            .delete()
            .or(`external_id.eq.${extId},external_player_id.eq.${extId}`);
        }
        if (sessionName) {
          await supabase
            .from('player_links')
            .delete()
            .or(`external_id.eq.${sessionName},session_name.eq.${sessionName}`);
        }
      }

      // Update LocalStorage
      try {
        const localLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        const filteredLinks = localLinks.filter(l => {
          const lExt = norm(l.external_id || l.external_player_id || l.session_name);
          return lExt !== normExtId && lExt !== normSessionName;
        });
        localStorage.setItem('offsuite_player_links', JSON.stringify(filteredLinks));
      } catch (e) {
        console.warn("Could not update local links:", e);
      }

      // Update active entry state
      setEntries(prev => {
        const next = [...(Array.isArray(prev) ? prev : [])];
        if (next[popoverIndex]) {
          const updated = { ...next[popoverIndex] };
          delete updated.playerId;
          next[popoverIndex] = updated;
        }
        return next;
      });

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

  const safePlayers = Array.isArray(players) ? players : [];

  return (
    <div className="space-y-6 font-sans">
      {/* Top Action Bar */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 shadow-xl backdrop-blur-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 bg-black/60 hover:bg-zinc-900 text-zinc-300 border border-white/10 transition-all flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:border-white/30"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2 font-sans tracking-tight">
              Session Telemetry
              <span className="text-xs font-mono font-bold px-2 py-0.5 bg-black border border-white/15 text-emerald-400">
                {date}
              </span>
            </h2>
            <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5 font-mono">
              <span>{safeEntries.length} Players</span>
              <span className="text-zinc-600">•</span>
              <span className="flex items-center gap-1">
                Status: 
                {saveStatus === 'saving' && <span className="text-amber-400 font-bold animate-pulse">Syncing...</span>}
                {saveStatus === 'saved' && <span className="text-emerald-400 font-bold flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3 drop-shadow-[0_0_4px_rgba(34,197,94,0.8)]" /> Synced</span>}
                {saveStatus === 'error' && <span className="text-rose-400 font-bold flex items-center gap-0.5"><AlertCircle className="w-3 h-3 drop-shadow-[0_0_4px_rgba(244,63,94,0.8)]" /> {saveError || 'Sync Fault'}</span>}
                {saveStatus === 'idle' && <span className="text-zinc-500">Live</span>}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Step Increments */}
          <div className="flex items-center bg-black/80 border border-white/10 p-0.5 font-mono text-xs">
            <span className="px-2 text-zinc-500 uppercase tracking-wider text-[10px]">Step:</span>
            {[50, 100, 500].map(inc => (
              <button
                key={inc}
                onClick={() => setGlobalIncrement(inc)}
                className={`px-2 py-1 font-bold transition-all ${
                  globalIncrement === inc 
                    ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_6px_rgba(16,185,129,0.3)]' 
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                ±{inc}
              </button>
            ))}
          </div>

          <label className="p-2 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-200 transition-all cursor-pointer flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:border-cyan-400 hover:text-cyan-300">
            <input 
              type="file" 
              accept=".csv" 
              onChange={handleLogFileUpload} 
              className="hidden" 
              disabled={isParsingLog}
            />
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isParsingLog ? 'Merging...' : 'Merge Log'}</span>
          </label>

          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-200 transition-all flex items-center gap-1.5 text-xs font-mono font-bold uppercase tracking-wider hover:border-white/30"
            title="Economics & Table Settings"
          >
            <Settings className="w-3.5 h-3.5 text-zinc-400" />
            <span className="hidden md:inline">Settings</span>
          </button>

          {onDelete && (
            <button 
              onClick={onDelete}
              className="p-2 bg-rose-950/30 hover:bg-rose-900/50 border border-rose-800/40 text-rose-300 transition-all flex items-center gap-1 text-xs font-mono font-bold uppercase hover:shadow-[0_0_8px_rgba(244,63,94,0.4)]"
              title="Delete Session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Ledger Editor on Left, Unified Settlement Panel on Right */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* Ledger Table */}
        <div className="xl:col-span-8 hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl flex flex-col min-w-0">
          <div className="p-4 border-b border-white/10 bg-black/60 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white flex items-center gap-2 font-sans uppercase tracking-wider text-sm">
                Session Roster & Stacks
                <InfoTooltip text="Total Buy-Ins must match Total Cash-Outs (Buy-Outs + Ending Stacks) for the ledger to balance." />
              </h3>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">Input chip stacks or use rapid steppers.</p>
            </div>

            {/* Zero-Sum Balance Indicator */}
            <div className={`flex items-center gap-2 px-3 py-1.5 border text-xs font-mono font-bold uppercase tracking-wider ${
              isBalanced 
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
                : 'bg-rose-950/40 border-rose-500/40 text-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
            }`}>
              {isBalanced ? (
                <CheckCircle2 className="w-4 h-4 drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
              ) : (
                <AlertCircle className="w-4 h-4 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
              )}
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
                <tr className="border-b border-white/10 bg-black/80 text-zinc-400 font-mono font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-2.5 sm:p-3">Player</th>
                  <th className="p-2 sm:p-3 text-center w-16">FX</th>
                  <th className="p-2 sm:p-3 text-center w-14">Bank</th>
                  <th className="p-2 sm:p-3 text-center">Buy-In</th>
                  <th className="p-2 sm:p-3 text-center">Buy-Out</th>
                  <th className="p-2 sm:p-3 text-center">Stack</th>
                  <th className="p-2.5 sm:p-3 text-right">Net</th>
                  <th className="p-2 sm:p-3 text-right w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-medium">
                {safeEntries.map((entry, index) => {
                  const net = (Number(entry?.buyOut) || 0) + (Number(entry?.stack) || 0) - (Number(entry?.buyIn) || 0);
                  const linkInfo = getLinkedPlayerInfo(entry);
                  const masterName = linkInfo.masterPlayer?.display_name;

                  return (
                    <tr key={entry?.id || index} className="hover:bg-white/[0.03] transition-colors group">
                      <td className="p-2.5 sm:p-3">
                        <div className="flex items-center gap-1.5">
                          <input 
                            type="text" 
                            value={entry?.name || ''}
                            onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                            placeholder="Player name..."
                            className="bg-black border border-white/15 px-2 py-1.5 text-zinc-100 outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)] w-28 sm:w-36 transition-all font-sans font-semibold text-xs sm:text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => handleOpenLinkPopover(index)}
                            className={`p-1.5 border transition-all shrink-0 ${
                              linkInfo.isLinked
                                ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)] hover:bg-emerald-500/25'
                                : 'bg-black/60 border-white/10 text-zinc-500 hover:text-zinc-300 hover:border-white/30'
                            }`}
                            title={linkInfo.isLinked ? `Linked to Master Profile: ${masterName}` : "Link to Master Player Profile"}
                          >
                            <Link className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      <td className="p-2 sm:p-3 text-center">
                        <select 
                          value={entry?.currency || gameCurrency}
                          onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                          className="bg-black border border-white/15 px-1.5 py-1.5 text-zinc-300 text-xs font-mono font-bold outline-none focus:border-cyan-400 transition-colors cursor-pointer"
                        >
                          {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                            <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                          ))}
                        </select>
                      </td>

                      <td className="p-2 sm:p-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleEntryChange(index, 'isBank', !entry?.isBank)}
                          className={`w-5 h-5 mx-auto border transition-all flex items-center justify-center cursor-pointer ${
                            entry?.isBank
                              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                              : 'bg-black/80 border-white/20 text-transparent hover:border-white/40'
                          }`}
                          title={entry?.isBank ? "Designated Bank (Click to toggle off)" : "Click to designate as Bank for this currency"}
                        >
                          <Check className={`w-3.5 h-3.5 stroke-[3] transition-transform ${entry?.isBank ? 'scale-100 text-cyan-400' : 'scale-0'}`} />
                        </button>
                      </td>

                      <td className="p-2 sm:p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', -globalIncrement)}
                            className="p-1 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry?.buyIn === 0 ? '' : (entry?.buyIn ?? '')}
                            onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-14 sm:w-16 bg-black border border-white/15 px-1 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyIn', globalIncrement)}
                            className="p-1 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      <td className="p-2 sm:p-3">
                        <div className="flex items-center justify-center gap-1">
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', -globalIncrement)}
                            className="p-1 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <input 
                            type="number" 
                            min="0"
                            value={entry?.buyOut === 0 ? '' : (entry?.buyOut ?? '')}
                            onChange={(e) => handleEntryChange(index, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-14 sm:w-16 bg-black border border-white/15 px-1 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <button 
                            onClick={() => adjustValue(index, 'buyOut', globalIncrement)}
                            className="p-1 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </td>

                      <td className="p-2 sm:p-3">
                        <div className="flex justify-center">
                          <input 
                            type="number" 
                            min="0"
                            value={entry?.stack === 0 ? '' : (entry?.stack ?? '')}
                            onChange={(e) => handleEntryChange(index, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-16 sm:w-20 bg-black border border-white/15 px-1.5 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </td>

                      <td className={`p-2.5 sm:p-3 text-right font-mono tabular-nums font-bold ${
                        net > 0 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' :
                        net < 0 ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' :
                        'text-zinc-500'
                      }`}>
                        {net > 0 ? '+' : ''}{net === 0 ? `0` : formatChips(net)}
                      </td>

                      <td className="p-2 sm:p-3 text-right">
                        <button 
                          onClick={() => handleRemoveRow(index)}
                          className="text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
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

          <div className="p-4 border-t border-white/10 bg-black/60">
            <button 
              onClick={handleAddRow}
              className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4 text-cyan-400" /> Add Player Row
            </button>
          </div>

          {(validationErrors?.length ?? 0) > 0 && (
            <div className="p-4 bg-rose-950/40 border-t border-rose-900/60 space-y-1">
              {(Array.isArray(validationErrors) ? validationErrors : []).map((err, i) => (
                <p key={i} className="text-rose-400 text-xs font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" /> {err}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Settlement Panel */}
        <div className="xl:col-span-4 min-w-0">
          <SessionSettlementPanel
            entries={safeEntries}
            settlementConfig={{
              chipsPerCad: ratioChips && ratioFiat ? (ratioChips / ratioFiat) : (1 / (chipValue || 1)),
              cadToUsd: exchangeRates?.CAD ? (1 / exchangeRates.CAD) : 0.74,
              countryByKey: (function() {
                const map = {};
                safeEntries.forEach(e => {
                  if (!e) return;
                  const k = keyOfEntry(e);
                  map[k] = (e.currency === 'USD' || e.currency === 'US') ? 'US' : 'CA';
                });
                return map;
              })(),
              bankByCountry: (function() {
                const map = {};
                safeEntries.forEach(e => {
                  if (e?.isBank) {
                    const cCode = (e.currency === 'USD' || e.currency === 'US') ? 'US' : 'CA';
                    map[cCode] = keyOfEntry(e);
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
              const p = safePlayers.find(x => x.id === pid);
              return p ? p.display_name : null;
            }}
            isBalanced={isBalanced}
            totalBuyIn={totalBuyIn}
          />
        </div>

      </div>

      {/* In-Place Player Identity Link Popover Modal */}
      {popoverIndex !== null && safeEntries[popoverIndex] && (() => {
        const targetEntry = safeEntries[popoverIndex];
        const linkInfo = getLinkedPlayerInfo(targetEntry);
        const sessionName = (targetEntry?.name || '').trim();

        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="hud-corner-reticle hud-corner-cyan bg-hud-card border border-white/20 max-w-md w-full p-6 shadow-2xl space-y-4 backdrop-blur-xl font-sans">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Link className="w-4 h-4 text-cyan-400 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                    Player Identity Link
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5 font-sans">
                    Map <span className="text-cyan-400 font-semibold font-mono">{sessionName || 'Unnamed'}</span> to a master profile.
                  </p>
                </div>
                <button 
                  onClick={() => setPopoverIndex(null)}
                  className="p-1 text-zinc-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {playerActionError && (
                <div className="p-3 bg-rose-950/50 border border-rose-800/60 text-rose-400 text-xs font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{playerActionError}</span>
                </div>
              )}

              <div className="space-y-3">
                {!isCreatingNewPlayer ? (
                  <div>
                    <label className="block text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1">Select Existing Master Player</label>
                    <select
                      value={selectedMasterPlayerId}
                      onChange={(e) => setSelectedMasterPlayerId(e.target.value)}
                      className="w-full bg-black border border-white/20 text-zinc-100 px-3 py-2 text-xs font-medium outline-none focus:border-cyan-400 cursor-pointer"
                    >
                      <option value="" className="bg-zinc-950 text-zinc-400">-- Choose Master Player --</option>
                      {safePlayers.map(p => (
                        <option key={p.id} value={p.id} className="bg-zinc-950 text-white">{p.display_name}</option>
                      ))}
                    </select>

                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => { setIsCreatingNewPlayer(true); setNewMasterPlayerName(sessionName); }}
                        className="text-xs font-mono text-cyan-400 hover:text-cyan-300 font-medium inline-flex items-center gap-1"
                      >
                        <UserPlus className="w-3.5 h-3.5" /> Create new master profile
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1">New Master Player Name</label>
                    <input
                      type="text"
                      value={newMasterPlayerName}
                      onChange={(e) => setNewMasterPlayerName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full bg-black border border-white/20 text-zinc-100 px-3 py-2 text-xs outline-none focus:border-cyan-400 font-medium"
                    />

                    <div className="mt-2 text-right">
                      <button
                        type="button"
                        onClick={() => setIsCreatingNewPlayer(false)}
                        className="text-xs font-mono text-zinc-400 hover:text-zinc-200"
                      >
                        Select existing instead
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                {linkInfo.isLinked ? (
                  <button
                    type="button"
                    onClick={handleUnlink}
                    disabled={playerActionLoading}
                    className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-rose-300 text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                  >
                    <Unlink className="w-3.5 h-3.5" /> Unlink
                  </button>
                ) : <div />}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPopoverIndex(null)}
                    className="px-3.5 py-2 bg-black/60 hover:bg-zinc-900 text-zinc-300 border border-white/10 text-xs font-mono font-semibold uppercase tracking-wider transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLink}
                    disabled={playerActionLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(16,185,129,0.4)] disabled:opacity-50"
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="hud-corner-reticle bg-hud-card border border-white/20 max-w-md w-full p-6 shadow-2xl space-y-6 backdrop-blur-xl font-sans">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-400 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                Session Economics Settings
              </h3>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" /> Base Session Currency
                </label>
                <select
                  value={gameCurrency}
                  onChange={(e) => setGameCurrency(e.target.value)}
                  className="w-full bg-black border border-white/20 text-zinc-100 px-3 py-2 text-xs font-mono font-bold outline-none focus:border-cyan-400 cursor-pointer"
                >
                  {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                    <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                  ))}
                </select>
              </div>

              <div className="border-t border-white/10 pt-4">
                <label className="block text-xs font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Coins className="w-3.5 h-3.5 text-amber-400" /> Chip Ratio Definition
                </label>
                <div className="flex items-center gap-2 bg-black/60 p-3 border border-white/10">
                  <div className="flex-1">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Chips</span>
                    <input
                      type="number"
                      min="1"
                      value={ratioChips}
                      onChange={(e) => setRatioChips(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full bg-black border border-white/20 px-2 py-1.5 text-zinc-100 font-mono text-xs outline-none focus:border-cyan-400 text-center"
                    />
                  </div>
                  <span className="text-zinc-500 font-bold font-mono pt-4">=</span>
                  <div className="flex-1">
                    <span className="text-[10px] font-mono text-zinc-500 uppercase block mb-1">Fiat Amount ({gameCurrency})</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={ratioFiat}
                      onChange={(e) => setRatioFiat(Math.max(0.01, Number(e.target.value) || 1))}
                      className="w-full bg-black border border-white/20 px-2 py-1.5 text-zinc-100 font-mono text-xs outline-none focus:border-cyan-400 text-center"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-zinc-400 font-mono mt-2">
                  Current: <span className="text-emerald-400 font-bold">1 Chip = {formatFiat(chipValue, gameCurrency)}</span>
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-mono font-bold uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(6,182,212,0.4)]"
              >
                Apply & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
