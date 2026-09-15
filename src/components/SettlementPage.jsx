import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Landmark,
  CheckCircle2,
  Users,
  ArrowRight,
  RotateCcw,
  Search,
  ChevronDown,
  ChevronUp,
  Check
} from 'lucide-react';
import { useIdentityGraph, makeNameResolver } from '../hooks/useIdentityGraph';
import { sessionApi } from '../utils/sessionApi';
import { buildCountrySettlement, legsFromSession } from '../utils/settlementLedger';
import { country, COUNTRIES } from '../utils/countries';
import { loadGamesFromStorage } from '../utils/storage';
import { ErrorBoundary } from './ErrorBoundary';

const money = (n, currency = 'CAD') => `$${Math.abs(Number(n) || 0).toFixed(2)} ${currency}`;

const fmtDate = (d) => {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return String(d);
  }
};

const ago = (iso) => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function SettlementPage({ embedded = false }) {
  return (
    <ErrorBoundary>
      <SettlementPageContent embedded={embedded} />
    </ErrorBoundary>
  );
}

function SettlementPageContent({ embedded = false }) {
  const { country: routeCountry } = useParams();
  const navigate = useNavigate();

  const [activeCountry, setActiveCountry] = useState(() => {
    return (routeCountry || 'CA').toUpperCase();
  });

  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [legs, setLegs] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [undoToast, setUndoToast] = useState(null);

  const { players, resolve } = useIdentityGraph();

  const nameOf = useMemo(() => {
    if (typeof resolve === 'function') return resolve;
    return makeNameResolver(players);
  }, [resolve, players]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setCountryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (routeCountry) {
      const code = routeCountry.toUpperCase();
      if (code !== activeCountry) {
        setActiveCountry(code);
      }
    }
  }, [routeCountry, activeCountry]);

  const handleCountrySelect = (code) => {
    setActiveCountry(code);
    if (!embedded) {
      navigate(`/settlements/${code.toLowerCase()}`);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await sessionApi.ensureLegs().catch((err) => console.warn('ensureLegs notice:', err));
      const [legsRes, marksRes] = await Promise.all([
        sessionApi.listLegs(),
        sessionApi.listMarks()
      ]);

      let finalLegs = Array.isArray(legsRes) ? legsRes : [];
      // Fallback: derive legs from stored sessions if admin_session_legs has no records yet
      if (finalLegs.length === 0) {
        try {
          const storedGames = loadGamesFromStorage();
          if (Array.isArray(storedGames) && storedGames.length > 0) {
            finalLegs = storedGames.flatMap(legsFromSession);
          }
        } catch (e) {
          console.warn('Fallback games load error:', e);
        }
      }

      setLegs(finalLegs);
      setMarks(Array.isArray(marksRes) ? marksRes : []);
    } catch (err) {
      console.error('Failed to load settlement data:', err);
      setError(err.message || 'Failed to load ledger data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeCountriesList = useMemo(() => {
    const presentCodes = new Set(['CA', 'US']);
    (legs || []).forEach((l) => {
      if (l?.country) presentCodes.add(l.country.toUpperCase());
      if (l?.counter_country) presentCodes.add(l.counter_country.toUpperCase());
    });
    (players || []).forEach((p) => {
      if (p?.country) presentCodes.add(p.country.toUpperCase());
    });
    if (activeCountry) presentCodes.add(activeCountry.toUpperCase());

    return Array.from(presentCodes).map((cCode) => country(cCode));
  }, [legs, players, activeCountry]);

  const currentCountryConfig = useMemo(
    () => country(activeCountry),
    [activeCountry]
  );

  const countryData = useMemo(() => {
    return buildCountrySettlement({
      legs,
      marks,
      countryCode: activeCountry,
      nameOf
    });
  }, [activeCountry, legs, marks, nameOf]);

  const trackedSessionCount = useMemo(() => {
    const sessionIds = new Set(legs.map((l) => l.session_id || l.sessionId).filter(Boolean));
    return sessionIds.size;
  }, [legs]);

  const markIdsMap = useMemo(() => {
    const map = new Map();
    marks.forEach((m) => {
      if (m && m.session_id && m.leg_id) {
        map.set(`${m.session_id}:${m.leg_id}`, m.id);
      }
    });
    return map;
  }, [marks]);

  const showUndo = (ids, label) => {
    setUndoToast({ ids, label });
    setTimeout(() => {
      setUndoToast((cur) => (cur && cur.ids === ids ? null : cur));
    }, 8000);
  };

  const handleUndo = async (ids) => {
    if (!ids || ids.length === 0 || busy) return;
    setBusy(true);
    try {
      await sessionApi.undoMarks(ids);
      setMarks((prev) => prev.filter((m) => !ids.includes(m.id)));
      setUndoToast(null);
    } catch (err) {
      console.error('Undo failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleSettlePlayer = async (player) => {
    if (busy || !player || !player.lines) return;
    const openLines = player.lines.filter((l) => !l.settled);
    if (openLines.length === 0) return;

    setBusy(true);
    const payloads = openLines.map((line) => ({
      session_id: line.sessionId,
      leg_id: line.legId,
      scope: 'player',
      country: activeCountry,
      party_key: player.playerId || player.partyKey || player.key,
      party_name: player.name,
      counterparty_key: line.bankPartyKey || line.bankKey || null,
      counterparty_name: line.bankName || null,
      direction: line.direction,
      amount_cad: line.amountCad,
      amount_local: line.amountLocal,
      currency: line.currency || currentCountryConfig.currency,
      session_date: line.date || null
    }));

    try {
      const inserted = await sessionApi.addMarks(payloads);
      if (inserted && inserted.length > 0) {
        setMarks((prev) => [...prev, ...inserted]);
        showUndo(
          inserted.map((m) => m.id),
          `Settled ${inserted.length} session${inserted.length === 1 ? '' : 's'} for ${player.name}`
        );
      }
    } catch (err) {
      console.error('Failed to settle player:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleToggleLine = async (isSettled, sessionId, legId, buildPayload) => {
    if (busy) return;
    const key = `${sessionId}:${legId}`;
    const markId = markIdsMap.get(key);

    setBusy(true);
    try {
      if (isSettled && markId) {
        await sessionApi.undoMarks([markId]);
        setMarks((prev) => prev.filter((m) => m.id !== markId));
      } else {
        const payload = typeof buildPayload === 'function' ? buildPayload() : buildPayload;
        if (payload) {
          const inserted = await sessionApi.addMarks([payload]);
          if (inserted && inserted.length > 0) {
            setMarks((prev) => [...prev, ...inserted]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to toggle line settlement:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleSettleBankLine = async (b) => {
    if (busy) return;
    setBusy(true);
    try {
      const payload = {
        session_id: b.sessionId,
        leg_id: b.legId,
        scope: 'bank',
        country: activeCountry,
        party_key: b.fromPartyKey || b.fromKey || b.from,
        party_name: b.from,
        counterparty_key: b.toPartyKey || b.toKey || b.to,
        counterparty_name: b.to,
        direction: 'bank',
        amount_cad: b.amountCad,
        amount_local: b.amountLocal ?? b.amountCad,
        currency: 'CAD',
        session_date: b.date || null
      };
      const inserted = await sessionApi.addMarks([payload]);
      if (inserted && inserted.length > 0) {
        setMarks((prev) => [...prev, ...inserted]);
        showUndo(inserted.map((m) => m.id), `Settled bank transfer: ${b.from} → ${b.to}`);
      }
    } catch (err) {
      console.error('Failed to settle bank line:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header Card */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-6 shadow-xl backdrop-blur-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold tracking-wider text-emerald-400 uppercase bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5">
                Financial Clearing
              </span>
              <span className="text-xs text-zinc-500 font-mono">
                {trackedSessionCount} sessions tracked
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight mt-1">
              Cross-Border Settlement Desk
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-mono">
              Net balance rollup by regional banker & player clearing state.
            </p>
          </div>

          {/* Regional Ledger Dropdown Selector */}
          <div className="relative self-start md:self-auto" ref={dropdownRef}>
            <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
              <Landmark className="w-3 h-3 text-emerald-400" />
              <span>Regional Ledger</span>
            </div>
            <button
              type="button"
              onClick={() => setCountryDropdownOpen((prev) => !prev)}
              className="bg-black/90 hover:bg-zinc-900/90 border border-white/20 hover:border-emerald-500/50 text-white font-mono text-xs sm:text-sm font-bold px-3 py-2 flex items-center justify-between gap-3 min-w-[220px] transition-all shadow-lg focus:outline-none focus:border-emerald-400 focus:shadow-[0_0_10px_rgba(16,185,129,0.3)]"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="text-base leading-none">{currentCountryConfig.flag}</span>
                <span className="font-sans font-bold text-zinc-100 truncate">{currentCountryConfig.name}</span>
                <span className="text-emerald-400 text-xs font-mono">({currentCountryConfig.currency})</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-200 shrink-0 ${countryDropdownOpen ? 'rotate-180 text-emerald-400' : ''}`} />
            </button>

            {countryDropdownOpen && (
              <div className="absolute right-0 mt-1.5 w-64 bg-zinc-950/95 border border-white/20 shadow-2xl backdrop-blur-xl z-50 divide-y divide-white/5 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-3 py-2 text-[10px] font-mono text-zinc-500 uppercase tracking-widest bg-black/60">
                  Select Active Bank Ledger
                </div>
                <div className="max-h-60 overflow-y-auto py-1">
                  {activeCountriesList.map((c) => {
                    const isSelected = c.code === activeCountry;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => {
                          handleCountrySelect(c.code);
                          setCountryDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left text-xs font-mono flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/15 text-emerald-300 font-bold'
                            : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-base">{c.flag}</span>
                          <span className="font-sans truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-zinc-400 font-bold px-1.5 py-0.5 bg-black/60 border border-white/10">
                            {c.currency}
                          </span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Search Input */}
        <div className="mt-6 relative">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by player name or alias..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-black/80 border border-white/15 pl-9 pr-4 py-2 text-xs text-zinc-200 outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)] transition-all font-mono"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-12 text-center text-zinc-500 font-mono text-xs uppercase tracking-wider">
          Aggregating ledger settlement state...
        </div>
      ) : error ? (
        <div className="hud-corner-reticle bg-hud-card/90 border border-rose-900/50 p-8 text-center text-rose-400 font-mono text-xs">
          {error}
        </div>
      ) : countryData ? (
        <CountrySettlementView
          data={countryData}
          currency={currentCountryConfig.currency}
          countryName={currentCountryConfig.name}
          countryCode={activeCountry}
          search={search}
          busy={busy}
          resolve={nameOf}
          onSettlePlayer={handleSettlePlayer}
          onToggleLine={handleToggleLine}
          onSettleBankLine={handleSettleBankLine}
          onUndoIds={handleUndo}
        />
      ) : null}

      {/* Undo Toast */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 bg-black/95 border border-emerald-500/50 text-white px-4 py-3 shadow-2xl flex items-center gap-3 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 backdrop-blur-md">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-mono font-medium">{undoToast.label}</span>
          <button
            onClick={() => handleUndo(undoToast.ids)}
            disabled={busy}
            className="ml-2 text-xs font-mono font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 underline underline-offset-4 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}

function CountrySettlementView({
  data,
  currency,
  countryName,
  countryCode,
  search,
  busy,
  resolve,
  onSettlePlayer,
  onToggleLine,
  onSettleBankLine,
  onUndoIds
}) {
  const [expandedParties, setExpandedParties] = useState(() => new Set());

  const toggleParty = (k) => {
    setExpandedParties((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const { summary, players, bankTransfers, recentActivity } = data || {};

  const filteredPlayers = useMemo(() => {
    if (!players || !Array.isArray(players)) return [];
    if (!search || !search.trim()) return players;
    const q = search.trim().toLowerCase();
    return players.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.partyKey && p.partyKey.toLowerCase().includes(q)) ||
        (p.lines && p.lines.some((l) => l.sessionDate && l.sessionDate.includes(q)))
    );
  }, [players, search]);

  const settledPlayers = filteredPlayers.filter((p) => p.settled);
  const openPlayers = filteredPlayers.filter((p) => !p.settled);

  return (
    <div className="space-y-6">
      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-lg backdrop-blur-xl">
          <span className="text-[11px] text-zinc-500 uppercase tracking-widest block font-bold">
            Active Standing Banker
          </span>
          <div className="text-xl font-bold text-white mt-1.5 flex items-center gap-2">
            <Landmark className="w-5 h-5 text-emerald-400" />
            <span className="font-sans">{summary?.bankName || 'No standing bank'}</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            {countryName} ({countryCode})
          </p>
        </div>

        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-lg backdrop-blur-xl">
          <span className="text-[11px] text-zinc-500 uppercase tracking-widest block font-bold">
            Ledger Balance
          </span>
          <div className={`text-xl font-bold mt-1.5 ${
            (summary?.bankNetLocal || 0) > 0.005 ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
            (summary?.bankNetLocal || 0) < -0.005 ? 'text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.5)]' :
            'text-zinc-400'
          }`}>
            {(summary?.bankNetLocal || 0) > 0.005 ? '+' : ''}
            {money(summary?.bankNetLocal || 0, currency)}
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Net position of regional bank
          </p>
        </div>

        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-lg backdrop-blur-xl">
          <span className="text-[11px] text-zinc-500 uppercase tracking-widest block font-bold">
            Outstanding Action
          </span>
          <div className="text-xl font-bold text-cyan-400 mt-1.5 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">
            {openPlayers.length} / {filteredPlayers.length} Players
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Awaiting clearing verification
          </p>
        </div>
      </div>

      {/* Main Players Ledger Table */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl">
        <div className="p-4 border-b border-white/10 bg-black/60 flex items-center justify-between">
          <h3 className="font-bold text-white text-xs uppercase tracking-wider font-mono flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-400" />
            Player Clearing Positions
          </h3>
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
            {filteredPlayers.length} total players
          </span>
        </div>

        {filteredPlayers.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 font-mono text-xs uppercase tracking-wider">
            No player ledger entries found for {countryName}.
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filteredPlayers.map((player) => {
              const isExpanded = expandedParties.has(player.partyKey);
              const openCount = player.lines.filter((l) => !l.settled).length;
              const owesBank = player.netLocal < -0.005;
              const bankOwes = player.netLocal > 0.005;

              return (
                <div key={player.partyKey} className="transition-colors hover:bg-white/[0.02]">
                  <div className="p-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        onClick={() => toggleParty(player.partyKey)}
                        className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm tracking-tight">
                            {player.name}
                          </span>
                          {player.settled ? (
                            <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                              Settled
                            </span>
                          ) : (
                            <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              {openCount} Open
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                          {player.lines.length} session leg{player.lines.length === 1 ? '' : 's'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right font-mono">
                        <div className={`text-sm font-bold ${
                          bankOwes ? 'text-emerald-400' : owesBank ? 'text-rose-400' : 'text-zinc-400'
                        }`}>
                          {bankOwes ? 'Bank Owes ' : owesBank ? 'Owes Bank ' : 'Settled '}
                          {money(player.netLocal, currency)}
                        </div>
                      </div>

                      {!player.settled && (
                        <button
                          onClick={() => onSettlePlayer(player)}
                          disabled={busy}
                          className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-mono font-bold uppercase tracking-wider transition-all disabled:opacity-50 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
                        >
                          Settle All ({openCount})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded Session Line Items */}
                  {isExpanded && (
                    <div className="bg-black/60 border-t border-white/5 p-4 space-y-2">
                      <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest mb-2">
                        Individual Session Ledger Lines
                      </div>
                      <div className="divide-y divide-white/5">
                        {player.lines.map((line) => (
                          <div
                            key={line.legId}
                            className="py-2 flex items-center justify-between text-xs font-mono gap-4"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <button
                                onClick={() =>
                                  onToggleLine(
                                    line.settled,
                                    line.sessionId,
                                    line.legId,
                                    () => ({
                                      session_id: line.sessionId,
                                      leg_id: line.legId,
                                      scope: 'player',
                                      country: countryCode,
                                      party_key: player.playerId || player.partyKey || player.key,
                                      party_name: player.name,
                                      counterparty_key: line.bankPartyKey || line.bankKey || null,
                                      counterparty_name: line.bankName || null,
                                      direction: line.direction,
                                      amount_cad: line.amountCad,
                                      amount_local: line.amountLocal,
                                      currency: line.currency || currency,
                                      session_date: line.date || null
                                    })
                                  )
                                }
                                disabled={busy}
                                className={`w-4 h-4 border transition-all flex items-center justify-center ${
                                  line.settled
                                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                                    : 'bg-black/60 border-white/20 text-transparent hover:border-white/40'
                                }`}
                              >
                                <Check className={`w-3 h-3 stroke-[3] ${line.settled ? 'scale-100' : 'scale-0'}`} />
                              </button>
                              <span className="text-zinc-400">
                                {fmtDate(line.sessionDate || line.date)}
                              </span>
                              <span className="text-zinc-300 truncate">
                                {line.direction === 'from_bank'
                                  ? `Received from ${line.bankName || 'Bank'}`
                                  : `Sent to ${line.bankName || 'Bank'}`}
                              </span>
                            </div>

                            <div className={`font-bold tabular-nums ${
                              line.direction === 'from_bank' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              {line.direction === 'from_bank' ? '+' : '-'}
                              {money(line.amountLocal, line.currency || currency)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Inter-Bank Transfers Table (if present) */}
      {bankTransfers && bankTransfers.length > 0 && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl">
          <div className="p-4 border-b border-white/10 bg-black/60 flex items-center justify-between">
            <h3 className="font-bold text-white text-xs uppercase tracking-wider font-mono flex items-center gap-2">
              <Landmark className="w-4 h-4 text-emerald-400" />
              Inter-Bank Balancing Transfers
            </h3>
          </div>
          <div className="divide-y divide-white/5 p-4">
            {bankTransfers.map((b) => (
              <div key={b.legId} className="py-2.5 flex items-center justify-between text-xs font-mono gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onSettleBankLine(b)}
                    disabled={busy || b.settled}
                    className={`w-4 h-4 border transition-all flex items-center justify-center ${
                      b.settled
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                        : 'bg-black/60 border-white/20 text-transparent hover:border-white/40'
                    }`}
                  >
                    <Check className={`w-3 h-3 stroke-[3] ${b.settled ? 'scale-100' : 'scale-0'}`} />
                  </button>
                  <span className="text-zinc-300 font-bold">{b.from}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-zinc-300 font-bold">{b.to}</span>
                </div>
                <div className="font-bold text-emerald-400">
                  {money(b.amountLocal || b.amountCad, 'CAD')}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
