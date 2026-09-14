import React, { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { 
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
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
  Check,
  Users,
  Layers
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
  const [activeTab, setActiveTab] = useState('roster'); // 'roster' | 'settlement'
  const [compactMode, setCompactMode] = useState(true);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState(() => new Set());

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
    const timer = setTimeout(async () => {
      try {
        if (onSaveRef.current) {
          await onSaveRef.current({
            ...game,
            date,
            currency: gameCurrency,
            chipValue,
            entries
          });
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus('error');
        setSaveError(err.message || 'Save failed');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [date, gameCurrency, chipValue, entries, game]);

  // Safe checks on entries list
  const safeEntries = useMemo(() => Array.isArray(entries) ? entries : [], [entries]);

  // Totals & Balancing calculations
  const totalBuyIn = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.buyIn) || 0), 0);
  }, [safeEntries]);

  const totalBuyOut = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.buyOut) || 0), 0);
  }, [safeEntries]);

  const totalStack = useMemo(() => {
    return safeEntries.reduce((sum, e) => sum + (Number(e?.stack) || 0), 0);
  }, [safeEntries]);

  const totalOut = totalBuyOut + totalStack;
  const netDifference = totalBuyIn - totalOut;
  const isBalanced = Math.abs(netDifference) < 0.001;

  // Validation
  const validationErrors = useMemo(() => {
    const errors = [];
    if (!date) errors.push("Session date is required.");
    if (!safeEntries.length) errors.push("At least one player entry is required.");
    
    safeEntries.forEach((entry, idx) => {
      if (!entry?.name?.trim()) {
        errors.push(`Row ${idx + 1}: Player name is required.`);
      }
    });

    return errors;
  }, [date, safeEntries]);

  // Handlers
  const handleEntryChange = (index, field, value) => {
    setEntries(prev => {
      const next = [...prev];
      if (!next[index]) return prev;

      if (field === 'isBank' && value === true) {
        const currentCurrency = next[index].currency || gameCurrency;
        // Unset bank for all other entries with same currency
        next.forEach((e, i) => {
          if (i !== index && (e?.currency || gameCurrency) === currentCurrency) {
            next[i] = { ...next[i], isBank: false };
          }
        });
      }

      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const adjustValue = (index, field, delta) => {
    setEntries(prev => {
      const next = [...prev];
      if (!next[index]) return prev;
      const current = Number(next[index][field]) || 0;
      const updated = Math.max(0, current + delta);
      next[index] = { ...next[index], [field]: updated };
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
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleRemoveGroup = (memberIndices) => {
    const set = new Set(memberIndices);
    setEntries(prev => prev.filter((_, i) => !set.has(i)));
  };

  // --- IDENTITY GRAPH LOOKUPS ---
  const masterPlayerMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(players) ? players : []).forEach(p => {
      if (p && p.id) map.set(p.id, p);
    });
    return map;
  }, [players]);

  const getLinkedPlayerInfo = (entry) => {
    if (!entry) return { isLinked: false, masterPlayer: null, linkRecord: null, matchedBy: null };
    
    // 0. Direct playerId on entry
    const directId = entry.playerId || entry.player_id;
    if (directId && masterPlayerMap.has(directId)) {
      return { isLinked: true, masterPlayer: masterPlayerMap.get(directId), linkRecord: null, matchedBy: 'direct' };
    }

    const normExtId = norm(entry.pokerNowId || entry.externalId || entry.player_external_id || entry.external_player_id);
    const normName = norm(entry.name);

    // 1. Match via external_id in playerLinks
    if (normExtId) {
      const link = (playerLinks || []).find(l => {
        const ext = norm(l.external_id || l.external_player_id);
        return ext === normExtId;
      });
      if (link && masterPlayerMap.has(link.player_id)) {
        return { isLinked: true, masterPlayer: masterPlayerMap.get(link.player_id), linkRecord: link, matchedBy: 'extId' };
      }
    }

    // 2. Match via session alias in playerLinks
    if (normName) {
      const link = (playerLinks || []).find(l => {
        const ext = norm(l.external_id || l.external_player_id || l.session_name);
        return ext === normName;
      });
      if (link && masterPlayerMap.has(link.player_id)) {
        return { isLinked: true, masterPlayer: masterPlayerMap.get(link.player_id), linkRecord: link, matchedBy: 'alias' };
      }

      // 3. Direct display_name match with registered master player profile (auto self-link)
      const exactMatch = (Array.isArray(players) ? players : []).find(
        p => p && (norm(p.display_name) === normName || norm(p.name) === normName)
      );
      if (exactMatch) {
        return { isLinked: true, masterPlayer: exactMatch, linkRecord: null, matchedBy: 'name' };
      }
    }

    return { isLinked: false, masterPlayer: null, linkRecord: null, matchedBy: null };
  };

  // Group entries by Master Player Profile (for compacted view)
  const compactedGroups = useMemo(() => {
    const groupsMap = new Map();

    safeEntries.forEach((entry, originalIndex) => {
      const linkInfo = getLinkedPlayerInfo(entry);
      let groupKey;
      let displayName;
      let isLinked = false;
      let masterPlayer = null;

      if (linkInfo.isLinked && linkInfo.masterPlayer) {
        groupKey = `player:${linkInfo.masterPlayer.id}`;
        displayName = linkInfo.masterPlayer.display_name || linkInfo.masterPlayer.name;
        isLinked = true;
        masterPlayer = linkInfo.masterPlayer;
      } else {
        groupKey = `unlinked:${entry?.id || originalIndex}:${(entry?.name || '').trim()}`;
        displayName = (entry?.name || '').trim() || 'Unnamed';
        isLinked = false;
        masterPlayer = null;
      }

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          key: groupKey,
          displayName,
          isLinked,
          masterPlayer,
          currency: entry?.currency || gameCurrency,
          isBank: Boolean(entry?.isBank),
          memberIndices: [originalIndex],
          memberEntries: [entry],
          matchedBy: linkInfo.matchedBy
        });
      } else {
        const grp = groupsMap.get(groupKey);
        grp.memberIndices.push(originalIndex);
        grp.memberEntries.push(entry);
        if (entry?.isBank) grp.isBank = true;
      }
    });

    return Array.from(groupsMap.values()).map(grp => {
      const totalBuyIn = grp.memberEntries.reduce((s, e) => s + (Number(e?.buyIn) || 0), 0);
      const totalBuyOut = grp.memberEntries.reduce((s, e) => s + (Number(e?.buyOut) || 0), 0);
      const totalStack = grp.memberEntries.reduce((s, e) => s + (Number(e?.stack) || 0), 0);
      const net = totalBuyOut + totalStack - totalBuyIn;

      return {
        ...grp,
        buyIn: totalBuyIn,
        buyOut: totalBuyOut,
        stack: totalStack,
        net,
        hasMultipleSeats: grp.memberEntries.length > 1,
        seatCount: grp.memberEntries.length
      };
    });
  }, [safeEntries, gameCurrency, players, playerLinks, masterPlayerMap]);

  const toggleGroupExpand = (groupKey) => {
    setExpandedGroupKeys(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const handleOpenLinkPopover = (index) => {
    setPopoverIndex(index);
    const entry = safeEntries[index];
    const info = getLinkedPlayerInfo(entry);
    setSelectedMasterPlayerId(info.masterPlayer?.id || '');
    setNewMasterPlayerName('');
    setIsCreatingNewPlayer(false);
    setPlayerActionError(null);
  };

  const handleLinkToMaster = async (index, masterId) => {
    const entry = safeEntries[index];
    if (!entry || !masterId) return;

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      const alias = (entry.name || '').trim();
      const extId = (entry.pokerNowId || entry.externalId || entry.player_external_id || entry.external_player_id || '').trim();
      const primaryKey = extId || alias;

      if (supabase) {
        // Check if there is an existing link matching either external_id or session_name
        const existingLink = (playerLinks || []).find(l => {
          const lExt = norm(l.external_id || l.external_player_id);
          const lAlias = norm(l.session_name);
          return (extId && lExt === norm(extId)) || (alias && (lExt === norm(alias) || lAlias === norm(alias)));
        });

        if (existingLink) {
          const { error: updErr } = await supabase
            .from('player_links')
            .update({ 
              player_id: masterId,
              external_id: primaryKey,
              session_name: alias || null,
              platform: extId ? 'pokernow' : 'alias'
            })
            .eq('id', existingLink.id);

          if (updErr) throw updErr;
        } else {
          const { error: insErr } = await supabase
            .from('player_links')
            .insert([{
              player_id: masterId,
              external_id: primaryKey,
              session_name: alias || null,
              platform: extId ? 'pokernow' : 'alias'
            }]);

          if (insErr) throw insErr;
        }
      } else {
        // Local storage fallback
        const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        const existingIdx = currentLinks.findIndex(l => {
          const lExt = norm(l.external_id || l.external_player_id);
          const lAlias = norm(l.session_name);
          return (extId && lExt === norm(extId)) || (alias && (lExt === norm(alias) || lAlias === norm(alias)));
        });

        const newLinkObj = {
          id: existingIdx >= 0 ? currentLinks[existingIdx].id : `local-link-${Date.now()}`,
          player_id: masterId,
          external_id: primaryKey,
          session_name: alias || null,
          platform: extId ? 'pokernow' : 'alias'
        };

        if (existingIdx >= 0) {
          currentLinks[existingIdx] = newLinkObj;
        } else {
          currentLinks.push(newLinkObj);
        }
        localStorage.setItem('offsuite_player_links', JSON.stringify(currentLinks));
      }

      handleEntryChange(index, 'playerId', masterId);

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }

      setPopoverIndex(null);
    } catch (err) {
      console.error("Link player error:", err);
      setPlayerActionError(err.message || "Failed to link player.");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  const handleCreateAndLinkMaster = async (index) => {
    const entry = safeEntries[index];
    if (!entry || !newMasterPlayerName.trim()) return;

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      const trimmedName = newMasterPlayerName.trim();
      let createdPlayerId = null;

      if (supabase) {
        const { data: newPlayer, error: createErr } = await supabase
          .from('players')
          .insert({
            display_name: trimmedName,
            preferred_currency: entry.currency || gameCurrency || 'USD'
          })
          .select()
          .single();

        if (createErr) throw createErr;
        createdPlayerId = newPlayer.id;
      } else {
        const currentPlayers = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        const newPlayerObj = {
          id: `player-${Date.now()}`,
          name: trimmedName,
          display_name: trimmedName,
          country: entry.currency === 'CAD' ? 'CA' : 'US',
          preferred_currency: entry.currency || gameCurrency || 'USD',
          created_at: new Date().toISOString()
        };
        currentPlayers.push(newPlayerObj);
        localStorage.setItem('offsuite_players', JSON.stringify(currentPlayers));
        createdPlayerId = newPlayerObj.id;
      }

      await handleLinkToMaster(index, createdPlayerId);
    } catch (err) {
      console.error("Create and link player error:", err);
      setPlayerActionError(err.message || "Failed to create player.");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  const handleUnlinkMaster = async (index) => {
    const entry = safeEntries[index];
    if (!entry) return;

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      const alias = (entry.name || '').trim();
      const extId = (entry.pokerNowId || entry.externalId || entry.player_external_id || entry.external_player_id || '').trim();

      if (supabase) {
        const link = (playerLinks || []).find(l => {
          const lExt = norm(l.external_id || l.external_player_id);
          const lAlias = norm(l.session_name);
          return (extId && lExt === norm(extId)) || (alias && (lExt === norm(alias) || lAlias === norm(alias)));
        });

        if (link) {
          const { error: delErr } = await supabase
            .from('player_links')
            .delete()
            .eq('id', link.id);
          if (delErr) throw delErr;
        }
      } else {
        const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        const filtered = currentLinks.filter(l => {
          const lExt = norm(l.external_id || l.external_player_id);
          const lAlias = norm(l.session_name);
          return !((extId && lExt === norm(extId)) || (alias && (lExt === norm(alias) || lAlias === norm(alias))));
        });
        localStorage.setItem('offsuite_player_links', JSON.stringify(filtered));
      }

      handleEntryChange(index, 'playerId', null);

      if (onUpdatePlayers) {
        await onUpdatePlayers();
      }

      setPopoverIndex(null);
    } catch (err) {
      console.error("Unlink error:", err);
      setPlayerActionError(err.message || "Failed to unlink player.");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  const handleLogFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsingLog(true);
    try {
      const text = await file.text();
      const parsedStats = parsePokerNowLogStats(text);

      const parsedEntries = Object.values(parsedStats).map(p => ({
        id: generateId('entry'),
        name: p.name,
        pokerNowId: p.pokerNowId,
        externalId: p.externalId,
        buyIn: 0,
        buyOut: 0,
        stack: 0,
        handsPlayed: p.handsPlayed,
        vpipHands: p.vpipHands,
        pfrHands: p.pfrHands,
        threeBetOpps: p.threeBetOpps,
        threeBetHands: p.threeBetHands,
        currency: gameCurrency,
        isBank: false
      }));

      const merged = mergeSessionEntries(safeEntries, parsedEntries);
      setEntries(sanitizeEntries(merged, gameCurrency));
    } catch (err) {
      console.error("Log upload parsing error:", err);
      alert("Failed to parse log file: " + (err.message || "Unknown error"));
    } finally {
      setIsParsingLog(false);
      event.target.value = '';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 font-sans">
      {/* Top Header Card */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 sm:p-5 shadow-2xl backdrop-blur-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white transition-all flex items-center gap-1 text-xs font-mono font-bold uppercase tracking-wider hover:border-cyan-400"
              title="Return to sessions view"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
          )}

          <div>
            <div className="flex items-center gap-2">
              <input 
                type="date" 
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-black/80 border border-white/15 px-2.5 py-1 text-xs text-zinc-100 font-mono font-bold outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)] transition-all cursor-pointer"
              />
              {saveStatus === 'saving' && (
                <span className="text-[11px] font-mono text-cyan-400 flex items-center gap-1 animate-pulse">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Auto-saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-[11px] font-mono text-rose-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {saveError || 'Save Error'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
              Live session matrix & ledger synchronizer
            </p>
          </div>
        </div>

        {/* Global Rapid Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Stepper Delta Selector */}
          <div className="flex bg-black/80 border border-white/10 p-0.5 text-xs font-mono">
            <span className="px-2 py-1 text-zinc-500 uppercase tracking-widest text-[10px] self-center">Step</span>
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

      {/* View Switcher HUD Tabs */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3 gap-4 flex-wrap">
        <div className="flex bg-black/80 border border-white/10 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('roster')}
            className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'roster'
                ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Session Roster & Stacks</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-black/60 border border-white/10 text-zinc-400">
              {compactedGroups.length} Profiles ({safeEntries.length} Seats)
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settlement')}
            className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'settlement'
                ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/40 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" />
            <span>Settlement Checklist</span>
            <span className="text-[9px] uppercase font-mono font-bold tracking-widest px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              Live
            </span>
          </button>
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

      {/* Main Content Area */}
      {activeTab === 'roster' && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl flex flex-col min-w-0">
          <div className="p-4 border-b border-white/10 bg-black/60 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-bold text-white flex items-center gap-2 font-sans uppercase tracking-wider text-sm">
                Session Roster & Stacks
                <InfoTooltip text="Total Buy-Ins must match Total Cash-Outs (Buy-Outs + Ending Stacks) for the ledger to balance." />
              </h3>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">
                {compactMode 
                  ? `Compacted view: Showing ${compactedGroups.length} unique player profiles across ${safeEntries.length} session seats.`
                  : `Expanded view: Showing all ${safeEntries.length} individual session seats.`}
              </p>
            </div>

            {/* View Density Toggle */}
            <div className="flex items-center gap-1.5 bg-black/80 border border-white/10 p-1 text-xs font-mono">
              <button
                type="button"
                onClick={() => setCompactMode(true)}
                className={`px-3 py-1 font-bold transition-all flex items-center gap-1.5 ${
                  compactMode
                    ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Consolidate duplicate session seats by player profile"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>Compacted ({compactedGroups.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setCompactMode(false)}
                className={`px-3 py-1 font-bold transition-all flex items-center gap-1.5 ${
                  !compactMode
                    ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/40 shadow-[0_0_6px_rgba(6,182,212,0.3)]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Display all raw session seats without grouping"
              >
                <Users className="w-3.5 h-3.5 text-cyan-400" />
                <span>All Seats ({safeEntries.length})</span>
              </button>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-black/80 text-zinc-400 font-mono font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3 sm:p-3.5">Player Profile / Seat</th>
                  <th className="p-3 sm:p-3.5 text-center w-24">Currency</th>
                  <th className="p-3 sm:p-3.5 text-center w-20">Bank</th>
                  <th className="p-3 sm:p-3.5 text-center">Buy-In</th>
                  <th className="p-3 sm:p-3.5 text-center">Buy-Out</th>
                  <th className="p-3 sm:p-3.5 text-center">Stack</th>
                  <th className="p-3 sm:p-3.5 text-right w-28">Net</th>
                  <th className="p-3 sm:p-3.5 text-right w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-medium">
                {compactMode ? (
                  // --- COMPACTED VIEW (GROUPED BY PLAYER PROFILE) ---
                  compactedGroups.map((grp) => {
                    const primaryIdx = grp.memberIndices[0];
                    const isExpanded = expandedGroupKeys.has(grp.key);

                    return (
                      <Fragment key={grp.key}>
                        <tr className="hover:bg-white/[0.03] transition-colors group bg-black/20">
                          <td className="p-3 sm:p-3.5">
                            <div className="flex items-center gap-2 max-w-sm">
                              {grp.hasMultipleSeats ? (
                                <button
                                  type="button"
                                  onClick={() => toggleGroupExpand(grp.key)}
                                  className="p-1 hover:bg-zinc-800 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 transition-all shrink-0 font-mono text-[10px] font-bold uppercase tracking-wider px-1.5"
                                  title={isExpanded ? "Collapse session seat aliases" : "Expand session seat aliases"}
                                >
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  <span>{grp.seatCount} seats</span>
                                </button>
                              ) : null}

                              {grp.isLinked ? (
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-sans font-bold text-white text-sm truncate">
                                      {grp.displayName}
                                    </span>
                                    <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 border border-emerald-500/30 shrink-0">
                                      {grp.hasMultipleSeats ? 'Consolidated Profile' : 'Linked Profile'}
                                    </span>
                                  </div>
                                  {!grp.hasMultipleSeats && safeEntries[primaryIdx]?.name && safeEntries[primaryIdx]?.name.trim().toLowerCase() !== grp.displayName.trim().toLowerCase() && (
                                    <span className="text-[10px] font-mono text-zinc-500 block truncate mt-0.5">
                                      Seat: {safeEntries[primaryIdx]?.name}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <input 
                                  type="text" 
                                  value={safeEntries[primaryIdx]?.name || ''}
                                  onChange={(e) => handleEntryChange(primaryIdx, 'name', e.target.value)}
                                  placeholder="Player name..."
                                  className="bg-black border border-white/15 px-3 py-1.5 text-zinc-100 outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)] w-full transition-all font-sans font-semibold text-xs sm:text-sm"
                                />
                              )}

                              <button
                                type="button"
                                onClick={() => handleOpenLinkPopover(primaryIdx)}
                                className={`p-1.5 border transition-all shrink-0 ${
                                  grp.isLinked
                                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)] hover:bg-emerald-500/25'
                                    : 'bg-black/60 border-white/10 text-zinc-500 hover:text-zinc-300 hover:border-white/30'
                                }`}
                                title={
                                  grp.isLinked
                                    ? `Linked Profile: ${grp.displayName}`
                                    : "Link to Master Player Profile"
                                }
                              >
                                <Link className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>

                          <td className="p-3 sm:p-3.5 text-center">
                            <select 
                              value={grp.currency || gameCurrency}
                              onChange={(e) => {
                                const newCurr = e.target.value;
                                grp.memberIndices.forEach(idx => handleEntryChange(idx, 'currency', newCurr));
                              }}
                              className="bg-black border border-white/15 px-2.5 py-1.5 text-zinc-300 text-xs font-mono font-bold outline-none focus:border-cyan-400 transition-colors cursor-pointer"
                            >
                              {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                                <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                              ))}
                            </select>
                          </td>

                          <td className="p-3 sm:p-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleEntryChange(primaryIdx, 'isBank', !grp.isBank)}
                              className={`w-5 h-5 mx-auto border transition-all flex items-center justify-center cursor-pointer ${
                                grp.isBank
                                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.6)]'
                                  : 'bg-black/80 border-white/20 text-transparent hover:border-white/40'
                              }`}
                              title={grp.isBank ? "Designated Bank (Click to toggle off)" : "Click to designate as Bank for this currency"}
                            >
                              <Check className={`w-3.5 h-3.5 stroke-[3] transition-transform ${grp.isBank ? 'scale-100 text-cyan-400' : 'scale-0'}`} />
                            </button>
                          </td>

                          <td className="p-3 sm:p-3.5">
                            {!grp.hasMultipleSeats ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => adjustValue(primaryIdx, 'buyIn', -globalIncrement)}
                                  className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input 
                                  type="number" 
                                  min="0"
                                  value={safeEntries[primaryIdx]?.buyIn === 0 ? '' : (safeEntries[primaryIdx]?.buyIn ?? '')}
                                  onChange={(e) => handleEntryChange(primaryIdx, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                                  className="w-16 sm:w-20 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button 
                                  onClick={() => adjustValue(primaryIdx, 'buyIn', globalIncrement)}
                                  className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="text-center font-mono font-bold text-zinc-200 tabular-nums">
                                {formatChips(grp.buyIn)}
                              </div>
                            )}
                          </td>

                          <td className="p-3 sm:p-3.5">
                            {!grp.hasMultipleSeats ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button 
                                  onClick={() => adjustValue(primaryIdx, 'buyOut', -globalIncrement)}
                                  className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input 
                                  type="number" 
                                  min="0"
                                  value={safeEntries[primaryIdx]?.buyOut === 0 ? '' : (safeEntries[primaryIdx]?.buyOut ?? '')}
                                  onChange={(e) => handleEntryChange(primaryIdx, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                                  className="w-16 sm:w-20 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                                />
                                <button 
                                  onClick={() => adjustValue(primaryIdx, 'buyOut', globalIncrement)}
                                  className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="text-center font-mono font-bold text-zinc-200 tabular-nums">
                                {formatChips(grp.buyOut)}
                              </div>
                            )}
                          </td>

                          <td className="p-3 sm:p-3.5">
                            {!grp.hasMultipleSeats ? (
                              <div className="flex justify-center">
                                <input 
                                  type="number" 
                                  min="0"
                                  value={safeEntries[primaryIdx]?.stack === 0 ? '' : (safeEntries[primaryIdx]?.stack ?? '')}
                                  onChange={(e) => handleEntryChange(primaryIdx, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                                  className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                                />
                              </div>
                            ) : (
                              <div className="text-center font-mono font-bold text-zinc-200 tabular-nums">
                                {formatChips(grp.stack)}
                              </div>
                            )}
                          </td>

                          <td className={`p-3 sm:p-3.5 text-right font-mono tabular-nums font-bold ${
                            grp.net > 0 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' :
                            grp.net < 0 ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' :
                            'text-zinc-500'
                          }`}>
                            {grp.net > 0 ? '+' : ''}{grp.net === 0 ? `0` : formatChips(grp.net)}
                          </td>

                          <td className="p-3 sm:p-3.5 text-right">
                            <button 
                              onClick={() => {
                                if (grp.hasMultipleSeats) {
                                  if (window.confirm(`Delete all ${grp.seatCount} seats for ${grp.displayName}?`)) {
                                    handleRemoveGroup(grp.memberIndices);
                                  }
                                } else {
                                  handleRemoveRow(primaryIdx);
                                }
                              }}
                              className="text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                              title={grp.hasMultipleSeats ? `Remove all ${grp.seatCount} seats` : "Remove row"}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>

                        {/* SUB-ROWS FOR MULTI-SEAT DRILL-DOWN */}
                        {grp.hasMultipleSeats && isExpanded && grp.memberIndices.map((origIdx) => {
                          const subEntry = safeEntries[origIdx];
                          const subNet = (Number(subEntry?.buyOut) || 0) + (Number(subEntry?.stack) || 0) - (Number(subEntry?.buyIn) || 0);

                          return (
                            <tr key={`sub-${grp.key}-${subEntry?.id || origIdx}`} className="bg-zinc-950/80 hover:bg-zinc-900/80 transition-colors border-l-2 border-emerald-500/40">
                              <td className="p-2 sm:p-2.5 pl-8 sm:pl-10">
                                <div className="flex items-center gap-2 max-w-sm">
                                  <span className="text-zinc-500 font-mono text-xs">↳</span>
                                  <input 
                                    type="text" 
                                    value={subEntry?.name || ''}
                                    onChange={(e) => handleEntryChange(origIdx, 'name', e.target.value)}
                                    placeholder="Seat alias..."
                                    className="bg-black/90 border border-white/10 px-2.5 py-1 text-zinc-200 outline-none focus:border-cyan-400 w-full transition-all font-mono text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleOpenLinkPopover(origIdx)}
                                    className="p-1 border border-white/10 text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/40 bg-black/60 transition-all shrink-0"
                                    title="View/Change Seat Identity Link"
                                  >
                                    <Link className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>

                              <td className="p-2 sm:p-2.5 text-center">
                                <span className="text-xs font-mono text-zinc-500">
                                  {subEntry?.currency || grp.currency}
                                </span>
                              </td>

                              <td className="p-2 sm:p-2.5 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleEntryChange(origIdx, 'isBank', !subEntry?.isBank)}
                                  className={`w-4 h-4 mx-auto border transition-all flex items-center justify-center cursor-pointer ${
                                    subEntry?.isBank
                                      ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                                      : 'bg-black/80 border-white/10 text-transparent hover:border-white/30'
                                  }`}
                                >
                                  <Check className={`w-3 h-3 stroke-[3] transition-transform ${subEntry?.isBank ? 'scale-100 text-cyan-400' : 'scale-0'}`} />
                                </button>
                              </td>

                              <td className="p-2 sm:p-2.5">
                                <div className="flex items-center justify-center gap-1">
                                  <button 
                                    onClick={() => adjustValue(origIdx, 'buyIn', -globalIncrement)}
                                    className="p-1 bg-black/60 hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                  >
                                    <Minus className="w-2.5 h-2.5" />
                                  </button>
                                  <input 
                                    type="number" 
                                    min="0"
                                    value={subEntry?.buyIn === 0 ? '' : (subEntry?.buyIn ?? '')}
                                    onChange={(e) => handleEntryChange(origIdx, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-16 bg-black border border-white/15 px-1.5 py-1 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs"
                                  />
                                  <button 
                                    onClick={() => adjustValue(origIdx, 'buyIn', globalIncrement)}
                                    className="p-1 bg-black/60 hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </td>

                              <td className="p-2 sm:p-2.5">
                                <div className="flex items-center justify-center gap-1">
                                  <button 
                                    onClick={() => adjustValue(origIdx, 'buyOut', -globalIncrement)}
                                    className="p-1 bg-black/60 hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                  >
                                    <Minus className="w-2.5 h-2.5" />
                                  </button>
                                  <input 
                                    type="number" 
                                    min="0"
                                    value={subEntry?.buyOut === 0 ? '' : (subEntry?.buyOut ?? '')}
                                    onChange={(e) => handleEntryChange(origIdx, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-16 bg-black border border-white/15 px-1.5 py-1 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs"
                                  />
                                  <button 
                                    onClick={() => adjustValue(origIdx, 'buyOut', globalIncrement)}
                                    className="p-1 bg-black/60 hover:bg-zinc-800 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                                  >
                                    <Plus className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </td>

                              <td className="p-2 sm:p-2.5">
                                <div className="flex justify-center">
                                  <input 
                                    type="number" 
                                    min="0"
                                    value={subEntry?.stack === 0 ? '' : (subEntry?.stack ?? '')}
                                    onChange={(e) => handleEntryChange(origIdx, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-20 bg-black border border-white/15 px-1.5 py-1 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs"
                                  />
                                </div>
                              </td>

                              <td className={`p-2 sm:p-2.5 text-right font-mono tabular-nums text-xs ${
                                subNet > 0 ? 'text-emerald-400/90' :
                                subNet < 0 ? 'text-rose-400/90' :
                                'text-zinc-500'
                              }`}>
                                {subNet > 0 ? '+' : ''}{subNet === 0 ? `0` : formatChips(subNet)}
                              </td>

                              <td className="p-2 sm:p-2.5 text-right">
                                <button 
                                  onClick={() => handleRemoveRow(origIdx)}
                                  className="text-zinc-600 hover:text-rose-400 transition-colors p-1"
                                  title="Delete seat"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })
                ) : (
                  // --- EXPANDED ALL SEATS VIEW ---
                  safeEntries.map((entry, index) => {
                    const net = (Number(entry?.buyOut) || 0) + (Number(entry?.stack) || 0) - (Number(entry?.buyIn) || 0);
                    const linkInfo = getLinkedPlayerInfo(entry);
                    const masterName = linkInfo.masterPlayer?.display_name || linkInfo.masterPlayer?.name;

                    return (
                      <tr key={entry?.id || index} className="hover:bg-white/[0.03] transition-colors group">
                        <td className="p-3 sm:p-3.5">
                          <div className="flex items-center gap-2 max-w-sm">
                            <input 
                              type="text" 
                              value={entry?.name || ''}
                              onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                              placeholder="Player name..."
                              className="bg-black border border-white/15 px-3 py-1.5 text-zinc-100 outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)] w-full transition-all font-sans font-semibold text-xs sm:text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleOpenLinkPopover(index)}
                              className={`p-1.5 border transition-all shrink-0 ${
                                linkInfo.isLinked
                                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)] hover:bg-emerald-500/25'
                                  : 'bg-black/60 border-white/10 text-zinc-500 hover:text-zinc-300 hover:border-white/30'
                              }`}
                              title={
                                linkInfo.isLinked
                                  ? (linkInfo.matchedBy === 'name'
                                      ? `Auto-matched by profile name: ${masterName}`
                                      : `Linked to Master Profile: ${masterName}`)
                                  : "Link to Master Player Profile"
                              }
                            >
                              <Link className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5 text-center">
                          <select 
                            value={entry?.currency || gameCurrency}
                            onChange={(e) => handleEntryChange(index, 'currency', e.target.value)}
                            className="bg-black border border-white/15 px-2.5 py-1.5 text-zinc-300 text-xs font-mono font-bold outline-none focus:border-cyan-400 transition-colors cursor-pointer"
                          >
                            {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                              <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                            ))}
                          </select>
                        </td>

                        <td className="p-3 sm:p-3.5 text-center">
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

                        <td className="p-3 sm:p-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => adjustValue(index, 'buyIn', -globalIncrement)}
                              className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.buyIn === 0 ? '' : (entry?.buyIn ?? '')}
                              onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                              className="w-16 sm:w-20 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button 
                              onClick={() => adjustValue(index, 'buyIn', globalIncrement)}
                              className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <button 
                              onClick={() => adjustValue(index, 'buyOut', -globalIncrement)}
                              className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.buyOut === 0 ? '' : (entry?.buyOut ?? '')}
                              onChange={(e) => handleEntryChange(index, 'buyOut', e.target.value === '' ? 0 : Number(e.target.value))}
                              className="w-16 sm:w-20 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button 
                              onClick={() => adjustValue(index, 'buyOut', globalIncrement)}
                              className="p-1.5 bg-black/60 hover:bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white transition-colors shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5">
                          <div className="flex justify-center">
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.stack === 0 ? '' : (entry?.stack ?? '')}
                              onChange={(e) => handleEntryChange(index, 'stack', e.target.value === '' ? 0 : Number(e.target.value))}
                              className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1.5 text-zinc-100 font-mono tabular-nums outline-none focus:border-emerald-400 text-center text-xs sm:text-sm transition-all [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none"
                            />
                          </div>
                        </td>

                        <td className={`p-3 sm:p-3.5 text-right font-mono tabular-nums font-bold ${
                          net > 0 ? 'text-emerald-400 drop-shadow-[0_0_6px_rgba(34,197,94,0.6)]' :
                          net < 0 ? 'text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.6)]' :
                          'text-zinc-500'
                        }`}>
                          {net > 0 ? '+' : ''}{net === 0 ? `0` : formatChips(net)}
                        </td>

                        <td className="p-3 sm:p-3.5 text-right">
                          <button 
                            onClick={() => handleRemoveRow(index)}
                            className="text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-white/10 bg-black/60 flex items-center justify-between">
            <button 
              onClick={handleAddRow}
              className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4 text-cyan-400" /> Add Player Row
            </button>

            <button
              onClick={() => setActiveTab('settlement')}
              className="text-xs font-mono font-bold uppercase tracking-wider text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 transition-colors"
            >
              View Settlement Checklist <ArrowRight className="w-3.5 h-3.5" />
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
      )}

      {/* Settlement Checklist View */}
      {activeTab === 'settlement' && (
        <div className="w-full">
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
            nameOf={(pId) => {
              const p = masterPlayerMap.get(pId);
              return p ? (p.display_name || p.name) : null;
            }}
            isBalanced={isBalanced}
            totalBuyIn={totalBuyIn}
          />
        </div>
      )}

      {/* Link to Master Profile Popover Modal */}
      {popoverIndex !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="hud-corner-reticle bg-hud-card/95 border border-cyan-500/40 w-full max-w-md p-6 shadow-2xl space-y-4 font-sans text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Link className="w-4 h-4 text-cyan-400" />
                <h4 className="font-bold text-white uppercase tracking-wider text-sm font-mono">Link Session Identity</h4>
              </div>
              <button
                onClick={() => setPopoverIndex(null)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black/60 border border-white/10 p-3 space-y-1 font-mono">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest block">Current Session Entry</span>
              <div className="text-zinc-200 font-bold text-sm">
                {safeEntries[popoverIndex]?.name || 'Unnamed Entry'}
              </div>
              {(safeEntries[popoverIndex]?.pokerNowId || safeEntries[popoverIndex]?.externalId) && (
                <div className="text-zinc-500 text-[11px]">
                  PokerNow ID: <span className="text-cyan-400">{safeEntries[popoverIndex]?.pokerNowId || safeEntries[popoverIndex]?.externalId}</span>
                </div>
              )}
            </div>

            {playerActionError && (
              <div className="p-2.5 bg-rose-950/60 border border-rose-900/80 text-rose-400 font-mono text-[11px] flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{playerActionError}</span>
              </div>
            )}

            {/* Link Mode Switcher */}
            <div className="space-y-3">
              {!isCreatingNewPlayer ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-zinc-400 font-mono uppercase tracking-wider text-[10px] mb-1">
                      Select Master Player Profile
                    </label>
                    <select
                      value={selectedMasterPlayerId}
                      onChange={(e) => setSelectedMasterPlayerId(e.target.value)}
                      className="w-full bg-black border border-white/15 px-3 py-2 text-zinc-100 font-sans font-medium outline-none focus:border-cyan-400 transition-colors text-xs"
                    >
                      <option value="">-- Select Profile --</option>
                      {(Array.isArray(players) ? players : []).map(p => (
                        <option key={p.id} value={p.id} className="bg-zinc-950 text-white">
                          {p.display_name || p.name} ({p.country || 'CA'} · {p.preferred_currency || 'CAD'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewPlayer(true)}
                      className="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1 transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Create New Profile
                    </button>

                    <div className="flex items-center gap-2">
                      {getLinkedPlayerInfo(safeEntries[popoverIndex]).isLinked && (
                        <button
                          type="button"
                          disabled={playerActionLoading}
                          onClick={() => handleUnlinkMaster(popoverIndex)}
                          className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/40 text-rose-300 font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-40 flex items-center gap-1"
                        >
                          <Unlink className="w-3.5 h-3.5" /> Unlink
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={!selectedMasterPlayerId || playerActionLoading}
                        onClick={() => handleLinkToMaster(popoverIndex, selectedMasterPlayerId)}
                        className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                      >
                        {playerActionLoading ? 'Linking...' : 'Save Link'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-zinc-400 font-mono uppercase tracking-wider text-[10px] mb-1">
                      New Master Player Display Name
                    </label>
                    <input
                      type="text"
                      value={newMasterPlayerName}
                      onChange={(e) => setNewMasterPlayerName(e.target.value)}
                      placeholder="e.g. Rahul"
                      className="w-full bg-black border border-white/15 px-3 py-2 text-zinc-100 font-sans font-medium outline-none focus:border-cyan-400 transition-colors text-xs"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCreatingNewPlayer(false)}
                      className="text-zinc-400 hover:text-zinc-200 font-mono text-[11px] transition-colors"
                    >
                      Back to select
                    </button>

                    <button
                      type="button"
                      disabled={!newMasterPlayerName.trim() || playerActionLoading}
                      onClick={() => handleCreateAndLinkMaster(popoverIndex)}
                      className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-40 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                    >
                      {playerActionLoading ? 'Creating...' : 'Create & Link'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="hud-corner-reticle bg-hud-card/95 border border-white/20 w-full max-w-md p-6 shadow-2xl space-y-4 font-sans text-xs">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-zinc-400" />
                <h4 className="font-bold text-white uppercase tracking-wider text-sm font-mono">Session Settings</h4>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 font-mono">
              <div>
                <label className="block text-zinc-400 uppercase tracking-wider text-[10px] mb-1.5">Table Currency</label>
                <select 
                  value={gameCurrency}
                  onChange={(e) => {
                    const newCurr = e.target.value;
                    setGameCurrency(newCurr);
                    setEntries(prev => prev.map(entry => ({
                      ...entry,
                      currency: entry.currency || newCurr
                    })));
                  }}
                  className="w-full bg-black border border-white/15 px-3 py-2 text-zinc-100 font-bold outline-none focus:border-cyan-400 transition-colors"
                >
                  {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                    <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 uppercase tracking-wider text-[10px] mb-1.5">Chip Economics (Ratio)</label>
                <div className="flex items-center gap-2 bg-black border border-white/15 p-2">
                  <input 
                    type="number"
                    min="1"
                    value={ratioChips}
                    onChange={(e) => setRatioChips(Number(e.target.value) || 1)}
                    className="w-20 bg-zinc-900 border border-white/10 px-2 py-1 text-center font-bold text-zinc-100 outline-none focus:border-emerald-400"
                  />
                  <span className="text-zinc-500 text-[11px]">Chips =</span>
                  <span className="text-zinc-400 text-xs font-bold">$</span>
                  <input 
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={ratioFiat}
                    onChange={(e) => setRatioFiat(Number(e.target.value) || 1)}
                    className="w-16 bg-zinc-900 border border-white/10 px-2 py-1 text-center font-bold text-zinc-100 outline-none focus:border-emerald-400"
                  />
                  <span className="text-zinc-400 text-xs font-bold">{gameCurrency}</span>
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  1 Chip = ${(chipValue).toFixed(4)} {gameCurrency}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-white/10 flex justify-end">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white font-mono font-bold uppercase tracking-wider transition-colors"
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
