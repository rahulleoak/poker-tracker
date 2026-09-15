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
  Layers,
  Activity
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { TOP_CURRENCIES, formatFiat, formatChips } from '../utils/formatters';
import { calculateSettlement } from '../utils/settlement';
import { keyOfEntry } from '../utils/bankSettlement';
import { countryFromCurrency } from '../utils/countries';
import { parsePokerNowLogStats } from '../utils/csvParser';
import { mergeSessionEntries } from '../utils/sessionMapper';
import { parseCumulativeNet, reconcileCumulativeNet } from '../utils/pokernow-utils/parseHandLog';
import { toChartData } from '../utils/chartData';
import { resolveEntryIdentity } from '../utils/adminIdentity';
import InfoTooltip from './InfoTooltip';
import SessionSettlementPanel from './SessionSettlementPanel';
import SessionAnalyticsPanel from './SessionAnalyticsPanel';

const generateId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
const norm = (v) => String(v || '').trim().toLowerCase();

const formatSessionTitleDate = (dateStr) => {
  if (!dateStr) return 'SESSION';
  try {
    const parts = String(dateStr).trim().split(/[-/T ]/);
    if (parts.length >= 3) {
      const year = parts[0].length === 4 ? parts[0] : parts[2];
      const monthIdx = parts[0].length === 4 ? parseInt(parts[1], 10) - 1 : parseInt(parts[0], 10) - 1;
      const day = parts[0].length === 4 ? parseInt(parts[2], 10) : parseInt(parts[1], 10);
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      if (monthIdx >= 0 && monthIdx < 12 && !isNaN(day) && year) {
        return `${months[monthIdx]} ${day} ${year}`;
      }
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
      return `${month} ${d.getUTCDate()} ${d.getUTCFullYear()}`;
    }
    return String(dateStr).toUpperCase();
  } catch {
    return String(dateStr).toUpperCase();
  }
};

export default function GameEditor(props) {
  return <GameEditorInner key={props.game?.id} {...props} />;
}

function GameEditorInner({ 
  game, 
  globalCurrency = 'USD',
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
  const [activeTab, setActiveTab] = useState('roster'); // 'roster' | 'settlement' | 'analytics'
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

  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [saveError, setSaveError] = useState(null);
  const [isParsingLog, setIsParsingLog] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Link to Master Player Popover state
  const [popoverIndex, setPopoverIndex] = useState(null);
  const [selectedMasterPlayerId, setSelectedMasterPlayerId] = useState('');
  const [newMasterPlayerName, setNewMasterPlayerName] = useState('');
  const [isCreatingNewPlayer, setIsCreatingNewPlayer] = useState(false);
  const [playerActionLoading, setPlayerActionLoading] = useState(false);
  const [playerActionError, setPlayerActionError] = useState(null);

  // Dynamic Map of master player profiles keyed by id
  const masterPlayerMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(players) ? players : []).forEach(p => {
      if (p && p.id) map.set(p.id, p);
    });
    return map;
  }, [players]);

  // Sync state if game prop changes
  useEffect(() => {
    if (game) {
      setDate(game.date || new Date().toISOString().split('T')[0]);
      setGameCurrency(game.currency || 'USD');
      setChipValue(game.chipValue || 1);
      setRatioChips(game.chipValue ? Math.round(1 / game.chipValue) : 100);
      setRatioFiat(1);
      if (Array.isArray(game.entries) && game.entries.length > 0) {
        setEntries(sanitizeEntries(game.entries, game.currency || 'USD'));
      }
    }
  }, [game]);

  // Ratio calculations
  useEffect(() => {
    if (ratioChips && ratioFiat && ratioChips > 0 && ratioFiat > 0) {
      const calculatedChipValue = ratioFiat / ratioChips;
      setChipValue(calculatedChipValue);
    }
  }, [ratioChips, ratioFiat]);

  // Auto-save debounce with stable change detection
  const isFirstMount = useRef(true);
  const onSaveRef = useRef(onSave);
  const lastSavedSnapshot = useRef('');

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify({ date, gameCurrency, chipValue, entries });
    if (isFirstMount.current) {
      isFirstMount.current = false;
      lastSavedSnapshot.current = currentSnapshot;
      return;
    }

    if (currentSnapshot === lastSavedSnapshot.current) {
      return;
    }

    setSaveStatus('saving');
    setSaveError(null);

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
        lastSavedSnapshot.current = currentSnapshot;
        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus(prev => (prev === 'saved' ? 'idle' : prev));
        }, 2500);
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus('error');
        setSaveError(err.message || 'Save failed');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [date, gameCurrency, chipValue, entries]);

  // Safe checks on entries list
  const safeEntries = useMemo(() => Array.isArray(entries) ? entries : [], [entries]);

  // Summary Metrics
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

  // Global FX conversion for total money in play
  const fxRate = (c) => (exchangeRates && exchangeRates[c] ? exchangeRates[c] : 1);
  const targetFx = fxRate(globalCurrency || 'USD');

  const totalMoneyInGameFiat = useMemo(() => {
    return safeEntries.reduce((sum, e) => {
      const eCurr = e.currency || gameCurrency || 'USD';
      const eFx = fxRate(eCurr);
      const buyIn = Number(e.buyIn) || 0;
      return sum + (((buyIn * chipValue) / eFx) * targetFx);
    }, 0);
  }, [safeEntries, gameCurrency, chipValue, exchangeRates, globalCurrency, targetFx]);

  // Validation
  const validationErrors = useMemo(() => {
    const errors = [];
    if (!date) errors.push("Session date is required.");
    if (safeEntries.length === 0) errors.push("Session must have at least one player row.");

    const names = new Set();
    safeEntries.forEach((e, idx) => {
      const name = (e?.name || '').trim();
      if (!name) {
        errors.push(`Row ${idx + 1} has an empty player name.`);
      } else {
        const lower = name.toLowerCase();
        if (names.has(lower)) {
          // Warning duplicate names
        }
        names.add(lower);
      }

      if ((Number(e?.buyIn) || 0) < 0) errors.push(`Row ${idx + 1} (${name || 'Unnamed'}) has negative Buy-In.`);
      if ((Number(e?.buyOut) || 0) < 0) errors.push(`Row ${idx + 1} (${name || 'Unnamed'}) has negative Buy-Out.`);
      if ((Number(e?.stack) || 0) < 0) errors.push(`Row ${idx + 1} (${name || 'Unnamed'}) has negative Ending Stack.`);
    });

    if (!isBalanced) {
      errors.push(`Ledger is out of balance by ${Math.abs(netDifference).toFixed(2)} chips.`);
    }

    return errors;
  }, [date, safeEntries, isBalanced, netDifference]);

  // Helper to resolve player link info
  const getLinkedPlayerInfo = (entry) => {
    if (!entry) return { isLinked: false, masterPlayer: null, linkRecord: null, matchedBy: null };

    // Direct manual link on entry
    if (entry.playerId && masterPlayerMap.has(entry.playerId)) {
      return { isLinked: true, masterPlayer: masterPlayerMap.get(entry.playerId), linkRecord: null, matchedBy: 'direct' };
    }

    const normExtId = norm(entry.pokerNowId || entry.externalId || entry.player_external_id || entry.external_player_id);
    const normName = norm(entry.name);

    // 1. Check external ID / PokerNow ID match against player_links
    if (normExtId) {
      const link = (playerLinks || []).find(l => {
        const ext = norm(l.external_id || l.external_player_id);
        return ext && ext === normExtId;
      });
      if (link && masterPlayerMap.has(link.player_id)) {
        return { isLinked: true, masterPlayer: masterPlayerMap.get(link.player_id), linkRecord: link, matchedBy: 'external_id' };
      }
    }

    // 2. Check seat-name / alias match against player_links
    if (normName) {
      const link = (playerLinks || []).find(l => {
        const ext = norm(l.external_id || l.external_player_id);
        const alias = norm(l.session_name);
        return (ext && ext === normName) || (alias && alias === normName);
      });
      if (link && masterPlayerMap.has(link.player_id)) {
        return { isLinked: true, masterPlayer: masterPlayerMap.get(link.player_id), linkRecord: link, matchedBy: 'alias' };
      }

      // 3. Direct display_name match
      const exactPlayer = (players || []).find(p => norm(p.display_name) === normName || norm(p.name) === normName);
      if (exactPlayer) {
        return { isLinked: true, masterPlayer: exactPlayer, linkRecord: null, matchedBy: 'display_name' };
      }
    }

    return { isLinked: false, masterPlayer: null, linkRecord: null, matchedBy: null };
  };

  // --- COMPACTED ROSTER GROUPS ---
  const compactedGroups = useMemo(() => {
    const groups = new Map();

    safeEntries.forEach((entry, index) => {
      const linkInfo = getLinkedPlayerInfo(entry);
      let groupKey;
      let displayName;
      let isLinked = false;
      let masterPlayer = null;

      if (linkInfo.isLinked && linkInfo.masterPlayer) {
        groupKey = `master-${linkInfo.masterPlayer.id}`;
        displayName = linkInfo.masterPlayer.display_name || linkInfo.masterPlayer.name;
        isLinked = true;
        masterPlayer = linkInfo.masterPlayer;
      } else {
        const fallbackName = (entry?.name || '').trim();
        groupKey = fallbackName ? `name-${norm(fallbackName)}` : `entry-${entry?.id || index}`;
        displayName = fallbackName || 'Unnamed Player';
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          displayName,
          isLinked,
          masterPlayer,
          primaryIndex: index,
          memberIndices: [index],
          currency: entry.currency || gameCurrency,
          isBank: Boolean(entry.isBank),
          buyIn: Number(entry.buyIn) || 0,
          buyOut: Number(entry.buyOut) || 0,
          stack: Number(entry.stack) || 0,
          rawAliases: entry.name ? [entry.name] : []
        });
      } else {
        const grp = groups.get(groupKey);
        grp.memberIndices.push(index);
        grp.buyIn += Number(entry.buyIn) || 0;
        grp.buyOut += Number(entry.buyOut) || 0;
        grp.stack += Number(entry.stack) || 0;
        if (entry.isBank) grp.isBank = true;
        if (entry.name && !grp.rawAliases.includes(entry.name)) {
          grp.rawAliases.push(entry.name);
        }
      }
    });

    return Array.from(groups.values()).map(grp => {
      const net = grp.buyOut + grp.stack - grp.buyIn;
      return {
        ...grp,
        net,
        seatCount: grp.memberIndices.length,
        hasMultipleSeats: grp.memberIndices.length > 1
      };
    });
  }, [safeEntries, gameCurrency, players, playerLinks, masterPlayerMap]);

  const toggleGroupExpand = (key) => {
    setExpandedGroupKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Link Management Handlers
  const handleOpenLinkPopover = (index) => {
    const entry = safeEntries[index];
    if (!entry) return;
    const linkInfo = getLinkedPlayerInfo(entry);
    setSelectedMasterPlayerId(linkInfo.masterPlayer?.id || '');
    setNewMasterPlayerName(entry.name || '');
    setIsCreatingNewPlayer(false);
    setPlayerActionError(null);
    setPopoverIndex(index);
  };

  const handleLinkToMaster = async (index, masterId) => {
    const entry = safeEntries[index];
    if (!entry || !masterId) return;

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
      const alias = (entry.name || '').trim();
      const extId = (entry.pokerNowId || entry.externalId || entry.player_external_id || entry.external_player_id || '').trim();

      if (supabase) {
        const linkPayload = {
          player_id: masterId,
          platform: 'pokernow',
          external_id: extId || alias || null,
          external_player_id: extId || alias || null,
          session_name: alias || null
        };

        const { error: upsertErr } = await supabase
          .from('player_links')
          .upsert([linkPayload], { onConflict: 'platform,external_id' });

        if (upsertErr) {
          await supabase.from('player_links').insert([linkPayload]);
        }
      } else {
        const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        const newLinkObj = {
          id: `link-${Date.now()}`,
          player_id: masterId,
          platform: 'pokernow',
          external_id: extId || alias || null,
          external_player_id: extId || alias || null,
          session_name: alias || null
        };
        const existingIdx = currentLinks.findIndex(l => 
          (extId && (l.external_id === extId || l.external_player_id === extId)) ||
          (alias && (l.external_id === alias || l.session_name === alias))
        );
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
      console.error("Link error:", err);
      setPlayerActionError(err.message || "Failed to link player.");
    } finally {
      setPlayerActionLoading(false);
    }
  };

  const handleCreateAndLinkMaster = async (index) => {
    const entry = safeEntries[index];
    const trimmedName = (newMasterPlayerName || entry?.name || '').trim();
    if (!entry || !trimmedName) {
      setPlayerActionError("Profile name is required.");
      return;
    }

    setPlayerActionLoading(true);
    setPlayerActionError(null);

    try {
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

      // Also compute chart_data and attach to game if hand history exists
      const rawParsed = parseCumulativeNet(text);
      if (rawParsed && rawParsed.snapshots?.length > 0) {
        const reconciled = reconcileCumulativeNet(rawParsed);
        const cd = toChartData(reconciled, (key) => {
          const info = resolveEntryIdentity({ name: key, pokerNowId: key }, { players, playerLinks });
          return info?.playerId || null;
        });
        if (game) {
          game.chart_data = cd;
        }
      }
    } catch (err) {
      console.error("Log upload parsing error:", err);
      alert("Failed to parse log file: " + (err.message || "Unknown error"));
    } finally {
      setIsParsingLog(false);
      event.target.value = '';
    }
  };

  const handleEntryChange = (index, field, value) => {
    setEntries(prev => {
      const next = [...prev];
      if (field === 'isBank' && value === true) {
        const targetCurr = next[index]?.currency || gameCurrency;
        next.forEach((e, idx) => {
          if (idx !== index && (e?.currency || gameCurrency) === targetCurr) {
            next[idx] = { ...e, isBank: false };
          }
        });
      }
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleQuickDelta = (index, field, delta) => {
    setEntries(prev => {
      const next = [...prev];
      const currentVal = Number(next[index]?.[field]) || 0;
      const newVal = Math.max(0, currentVal + delta);
      next[index] = { ...next[index], [field]: newVal };
      return next;
    });
  };

  const handleAddRow = () => {
    setEntries(prev => [
      ...prev,
      {
        id: generateId('entry'),
        name: '',
        buyIn: 0,
        buyOut: 0,
        stack: 0,
        currency: gameCurrency,
        isBank: false
      }
    ]);
  };

  const handleDeleteRow = (index) => {
    setEntries(prev => prev.filter((_, idx) => idx !== index));
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
            <div className="flex items-center gap-3">
              <h1 className="text-xl sm:text-2xl font-bold font-mono tracking-tight text-white uppercase">
                {formatSessionTitleDate(date)}
              </h1>
              {saveStatus === 'saving' && (
                <span className="text-[11px] font-mono text-cyan-400/90 flex items-center gap-1.5 animate-pulse bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> Auto-saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 transition-all">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Saved
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="text-[11px] font-mono text-rose-400 flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5">
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

          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
              activeTab === 'analytics'
                ? 'bg-zinc-800 text-amber-400 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Session Analytics & Pulse</span>
            <span className="text-[9px] uppercase font-mono font-bold tracking-widest px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30">
              Data Viz
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
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 shadow-2xl backdrop-blur-xl">
          <div className="p-4 sm:p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white uppercase tracking-wider text-sm font-mono">Session Roster & Stacks</h3>
                <InfoTooltip text="Manage player buy-ins, buy-outs, and live table stacks. Grouped automatically by master player profile." />
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                {compactMode 
                  ? `Compacted view: Showing ${compactedGroups.length} unique player profiles across ${safeEntries.length} session seats.`
                  : `All seats view: Showing ${safeEntries.length} individual session seat rows.`
                }
              </p>
            </div>

            {/* Compact / All Seats Toggle */}
            <div className="flex bg-black/80 border border-white/10 p-0.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setCompactMode(true)}
                className={`px-3 py-1 font-bold transition-all flex items-center gap-1.5 ${
                  compactMode
                    ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Compacted ({compactedGroups.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setCompactMode(false)}
                className={`px-3 py-1 font-bold transition-all flex items-center gap-1.5 ${
                  !compactMode
                    ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>All Seats ({safeEntries.length})</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm font-mono border-collapse">
              <thead>
                <tr className="border-b border-white/10 bg-black/60 text-zinc-400 uppercase text-[10px] tracking-wider">
                  <th className="p-3 sm:p-3.5 font-medium">Player Profile / Seat</th>
                  <th className="p-3 sm:p-3.5 font-medium text-center">Currency</th>
                  <th className="p-3 sm:p-3.5 font-medium text-center">Bank</th>
                  <th className="p-3 sm:p-3.5 font-medium text-center">Buy-In</th>
                  <th className="p-3 sm:p-3.5 font-medium text-center">Buy-Out</th>
                  <th className="p-3 sm:p-3.5 font-medium text-center">Stack</th>
                  <th className="p-3 sm:p-3.5 font-medium text-right">Net</th>
                  <th className="p-3 sm:p-3.5 font-medium text-right w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {compactMode ? (
                  // --- COMPACTED ROSTER VIEW ---
                  compactedGroups.map((grp) => {
                    const primaryIdx = grp.primaryIndex;
                    const isExpanded = expandedGroupKeys.has(grp.key);

                    return (
                      <Fragment key={grp.key}>
                        <tr className="hover:bg-zinc-900/40 transition-colors group">
                          <td className="p-3 sm:p-3.5">
                            <div className="flex items-center gap-2 max-w-sm">
                              {grp.hasMultipleSeats && (
                                <button
                                  type="button"
                                  onClick={() => toggleGroupExpand(grp.key)}
                                  className="p-1 text-zinc-400 hover:text-cyan-400 transition-colors flex items-center gap-1"
                                  title={isExpanded ? "Collapse seat rows" : "Expand seat rows"}
                                >
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                                  <span className="text-[10px] font-mono px-1.5 py-0.2 bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 font-bold">
                                    {grp.seatCount}
                                  </span>
                                </button>
                              )}

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-white text-sm font-sans tracking-tight truncate">
                                    {grp.displayName}
                                  </span>
                                  {grp.isLinked && (
                                    <span className="text-[9px] uppercase font-mono font-bold tracking-widest px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shrink-0">
                                      Linked Profile
                                    </span>
                                  )}
                                </div>
                                {grp.hasMultipleSeats ? (
                                  <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">
                                    Seats: {grp.rawAliases.join(', ')}
                                  </p>
                                ) : (
                                  grp.rawAliases[0] && grp.rawAliases[0] !== grp.displayName && (
                                    <p className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">
                                      Seat: {grp.rawAliases[0]}
                                    </p>
                                  )
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenLinkPopover(primaryIdx)}
                                className={`p-1.5 border transition-all shrink-0 ${
                                  grp.isLinked
                                    ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                                    : 'border-white/10 text-zinc-500 hover:text-white hover:border-white/30 bg-black/60'
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

                          {/* Currency Selection */}
                          <td className="p-3 sm:p-3.5 text-center">
                            <select 
                              value={grp.currency}
                              onChange={(e) => {
                                const newCurr = e.target.value;
                                grp.memberIndices.forEach(idx => handleEntryChange(idx, 'currency', newCurr));
                              }}
                              className="bg-black/80 border border-white/10 px-2 py-1 text-xs text-zinc-200 font-mono outline-none focus:border-cyan-400 transition-colors"
                            >
                              {(Array.isArray(TOP_CURRENCIES) ? TOP_CURRENCIES : ['USD', 'CAD']).map(c => (
                                <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>
                              ))}
                            </select>
                          </td>

                          {/* Bank Designation */}
                          <td className="p-3 sm:p-3.5 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                const nextBankState = !grp.isBank;
                                grp.memberIndices.forEach((idx, i) => {
                                  handleEntryChange(idx, 'isBank', i === 0 ? nextBankState : false);
                                });
                              }}
                              className={`w-5 h-5 mx-auto border transition-all flex items-center justify-center cursor-pointer ${
                                grp.isBank 
                                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.6)]' 
                                  : 'bg-black/80 border-white/20 text-transparent hover:border-white/40'
                              }`}
                              title={grp.isBank ? "Designated Bank (Click to toggle off)" : "Click to designate as Bank for this currency"}
                            >
                              {grp.isBank && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                            </button>
                          </td>

                          {/* Buy-In Input */}
                          <td className="p-3 sm:p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'buyIn', -globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input 
                                type="number" 
                                min="0"
                                value={grp.buyIn}
                                onChange={(e) => handleEntryChange(primaryIdx, 'buyIn', Number(e.target.value) || 0)}
                                className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'buyIn', globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Buy-Out Input */}
                          <td className="p-3 sm:p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'buyOut', -globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input 
                                type="number" 
                                min="0"
                                value={grp.buyOut}
                                onChange={(e) => handleEntryChange(primaryIdx, 'buyOut', Number(e.target.value) || 0)}
                                className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'buyOut', globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Ending Stack Input */}
                          <td className="p-3 sm:p-3.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'stack', -globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input 
                                type="number" 
                                min="0"
                                value={grp.stack}
                                onChange={(e) => handleEntryChange(primaryIdx, 'stack', Number(e.target.value) || 0)}
                                className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => handleQuickDelta(primaryIdx, 'stack', globalIncrement)}
                                className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </td>

                          {/* Net Profit Column */}
                          <td className="p-3 sm:p-3.5 text-right font-mono font-bold">
                            <span className={`tabular-nums ${grp.net > 0 ? 'text-emerald-400' : grp.net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                              {grp.net > 0 ? `+${formatChips(grp.net)}` : formatChips(grp.net)}
                            </span>
                          </td>

                          {/* Delete Row Button */}
                          <td className="p-3 sm:p-3.5 text-right">
                            <button 
                              onClick={() => handleDeleteRow(primaryIdx)}
                              className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
                              title="Delete Player Row"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>

                        {/* Nested Sub-rows for Multi-Seat Aliases */}
                        {isExpanded && grp.memberIndices.map((idx, subIdx) => {
                          const subEntry = safeEntries[idx];
                          const subNet = (Number(subEntry?.buyOut) || 0) + (Number(subEntry?.stack) || 0) - (Number(subEntry?.buyIn) || 0);

                          return (
                            <tr key={`sub-${idx}`} className="bg-zinc-950/60 border-l-2 border-cyan-500/40 text-xs">
                              <td className="p-2.5 pl-8 sm:pl-10">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-zinc-500 font-mono">Seat #{subIdx + 1}:</span>
                                  <input 
                                    type="text" 
                                    value={subEntry?.name || ''}
                                    onChange={(e) => handleEntryChange(idx, 'name', e.target.value)}
                                    placeholder="Seat Alias..."
                                    className="bg-black/60 border border-white/10 px-2 py-1 text-zinc-200 outline-none focus:border-cyan-400 text-xs font-mono w-48"
                                  />
                                </div>
                              </td>
                              <td className="p-2.5 text-center text-zinc-400 font-mono">{subEntry?.currency || gameCurrency}</td>
                              <td className="p-2.5 text-center text-zinc-500 font-mono">{subEntry?.isBank ? 'Bank' : '-'}</td>
                              <td className="p-2.5 text-center text-zinc-300 font-mono">{formatChips(subEntry?.buyIn || 0)}</td>
                              <td className="p-2.5 text-center text-zinc-300 font-mono">{formatChips(subEntry?.buyOut || 0)}</td>
                              <td className="p-2.5 text-center text-zinc-300 font-mono">{formatChips(subEntry?.stack || 0)}</td>
                              <td className="p-2.5 text-right font-mono font-bold">
                                <span className={`tabular-nums ${subNet > 0 ? 'text-emerald-400' : subNet < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                                  {subNet > 0 ? `+${formatChips(subNet)}` : formatChips(subNet)}
                                </span>
                              </td>
                              <td className="p-2.5 text-right">
                                <button 
                                  onClick={() => handleDeleteRow(idx)}
                                  className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
                                  title="Delete Seat Row"
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
                  // --- ALL SEATS VIEW ---
                  safeEntries.map((entry, index) => {
                    const net = (Number(entry?.buyOut) || 0) + (Number(entry?.stack) || 0) - (Number(entry?.buyIn) || 0);
                    const linkInfo = getLinkedPlayerInfo(entry);

                    return (
                      <tr key={entry?.id || index} className="hover:bg-zinc-900/40 transition-colors group">
                        <td className="p-3 sm:p-3.5">
                          <div className="flex items-center gap-2 max-w-sm">
                            <input 
                              type="text" 
                              value={entry?.name || ''}
                              onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                              placeholder="Player seat name..."
                              className="bg-black border border-white/15 px-2.5 py-1.5 text-zinc-100 outline-none focus:border-cyan-400 w-full transition-all font-mono text-xs sm:text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleOpenLinkPopover(index)}
                              className={`p-1.5 border transition-all shrink-0 ${
                                linkInfo.isLinked
                                  ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                                  : 'border-white/10 text-zinc-500 hover:text-white hover:border-white/30 bg-black/60'
                              }`}
                              title={
                                linkInfo.isLinked
                                  ? `Linked Profile: ${linkInfo.masterPlayer?.display_name || linkInfo.masterPlayer?.name}`
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
                            className="bg-black/80 border border-white/10 px-2 py-1 text-xs text-zinc-200 font-mono outline-none focus:border-cyan-400 transition-colors"
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
                            {entry?.isBank && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>
                        </td>

                        <td className="p-3 sm:p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'buyIn', -globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.buyIn ?? 0}
                              onChange={(e) => handleEntryChange(index, 'buyIn', Number(e.target.value) || 0)}
                              className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'buyIn', globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'buyOut', -globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.buyOut ?? 0}
                              onChange={(e) => handleEntryChange(index, 'buyOut', Number(e.target.value) || 0)}
                              className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'buyOut', globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'stack', -globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <input 
                              type="number" 
                              min="0"
                              value={entry?.stack ?? 0}
                              onChange={(e) => handleEntryChange(index, 'stack', Number(e.target.value) || 0)}
                              className="w-20 sm:w-24 bg-black border border-white/15 px-2 py-1 text-center text-zinc-100 font-mono font-semibold outline-none focus:border-cyan-400 text-xs sm:text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(index, 'stack', globalIncrement)}
                              className="w-6 h-6 bg-black/60 hover:bg-zinc-800 text-zinc-400 hover:text-emerald-400 border border-white/10 flex items-center justify-center transition-colors shrink-0"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </td>

                        <td className="p-3 sm:p-3.5 text-right font-mono font-bold">
                          <span className={`tabular-nums ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                            {net > 0 ? `+${formatChips(net)}` : formatChips(net)}
                          </span>
                        </td>

                        <td className="p-3 sm:p-3.5 text-right">
                          <button 
                            onClick={() => handleDeleteRow(index)}
                            className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
                            title="Delete Player Row"
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

          <div className="p-4 border-t border-white/10 bg-black/60 flex flex-wrap items-center justify-between gap-4">
            <button 
              onClick={handleAddRow}
              className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 hover:text-cyan-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4 text-cyan-400" /> Add Player Row
            </button>

            {/* Total Chips & Converted Fiat Telemetry Readout */}
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-zinc-500 uppercase tracking-widest text-[10px] font-bold">Total In Play:</span>
              <span className="text-cyan-400 font-bold tabular-nums">
                {formatChips(totalBuyIn)}
              </span>
              <span className="text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 font-bold tabular-nums text-[11px]">
                [{formatFiat(totalMoneyInGameFiat, globalCurrency || 'USD')}]
              </span>
            </div>
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
              exchangeRates,
              countryByKey: (function() {
                const map = {};
                safeEntries.forEach(e => {
                  if (!e) return;
                  const k = keyOfEntry(e);
                  map[k] = countryFromCurrency(e.currency || gameCurrency);
                });
                return map;
              })(),
              bankByCountry: (function() {
                const map = {};
                safeEntries.forEach(e => {
                  if (e?.isBank) {
                    const cCode = countryFromCurrency(e.currency || gameCurrency);
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

      {/* Session Analytics & Pulse Data Viz View */}
      {activeTab === 'analytics' && (
        <div className="w-full">
          <SessionAnalyticsPanel
            game={game}
            entries={safeEntries}
            players={players}
            playerLinks={playerLinks}
            globalCurrency={globalCurrency}
            exchangeRates={exchangeRates}
            chipValue={chipValue}
            onAttachLog={handleLogFileUpload}
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
