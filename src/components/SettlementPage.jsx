import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Landmark,
  CheckCircle2,
  Users,
  ArrowRight,
  RotateCcw,
  Search,
  ExternalLink,
  Coins,
  ChevronDown,
  ChevronUp,
  ArrowLeft
} from 'lucide-react';
import { useIdentityGraph } from '../hooks/useIdentityGraph';
import { sessionApi } from '../utils/sessionApi';
import { buildCountrySettlement } from '../utils/settlementLedger';

const COUNTRIES = [
  { code: 'CA', name: 'Canada', currency: 'CAD', flag: '🇨🇦' },
  { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' }
];

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
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

function makeNameResolver(players = []) {
  const map = new Map();
  for (const p of players) {
    map.set(p.id, p.display_name);
  }
  return (key) => {
    if (!key) return null;
    return map.get(key) || null;
  };
}

export default function SettlementPage({ embedded = false }) {
  const { country: countryParam } = useParams();
  const navigate = useNavigate();

  const [selectedCountry, setSelectedCountry] = useState(() => {
    if (!countryParam) return 'ALL';
    const found = COUNTRIES.find((c) => c.code.toLowerCase() === countryParam.toLowerCase());
    return found ? found.code : 'ALL';
  });

  useEffect(() => {
    if (countryParam) {
      const found = COUNTRIES.find((c) => c.code.toLowerCase() === countryParam.toLowerCase());
      if (found) setSelectedCountry(found.code);
    }
  }, [countryParam]);

  const { players } = useIdentityGraph();
  const nameOf = useMemo(() => makeNameResolver(players), [players]);

  const [legs, setLegs] = useState([]);
  const [marks, setMarks] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [busy, setBusy] = useState(false);
  const [undoState, setUndoState] = useState(null); // { ids: [], label }
  const [searchQuery, setSearchQuery] = useState('');

  const loadMarks = useCallback(() => {
    return sessionApi.listMarks().then((m) => setMarks(Array.isArray(m) ? m : []));
  }, []);

  const loadAll = useCallback(() => {
    setState('loading');
    sessionApi
      .ensureLegs()
      .catch((err) => console.warn('ensureLegs failed:', err))
      .then(() => Promise.all([sessionApi.listLegs(), sessionApi.listMarks()]))
      .then(([l, m]) => {
        setLegs(Array.isArray(l) ? l : []);
        setMarks(Array.isArray(m) ? m : []);
        setState('ready');
      })
      .catch((err) => {
        console.error('Failed to load settlement data:', err);
        setState('error');
      });
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!undoState) return undefined;
    const t = setTimeout(() => setUndoState(null), 9000);
    return () => clearTimeout(t);
  }, [undoState]);

  const settleRows = useCallback(
    async (rows, label) => {
      if (!rows.length || busy) return;
      setBusy(true);
      try {
        const inserted = await sessionApi.addMarks(rows);
        await loadMarks();
        const ids = (inserted || []).map((r) => r.id).filter(Boolean);
        if (ids.length) setUndoState({ ids, label });
      } catch (err) {
        console.error('Failed to settle:', err);
        window.alert(err.message || 'Failed to record settlement.');
      } finally {
        setBusy(false);
      }
    },
    [busy, loadMarks]
  );

  const undoMarkIds = useCallback(
    async (ids) => {
      if (!ids?.length || busy) return;
      setBusy(true);
      try {
        await sessionApi.undoMarks(ids);
        await loadMarks();
        setUndoState((u) => (u && u.ids.every((id) => ids.includes(id)) ? null : u));
      } catch (err) {
        console.error('Failed to undo:', err);
        window.alert(err.message || 'Failed to undo.');
      } finally {
        setBusy(false);
      }
    },
    [busy, loadMarks]
  );

  const perCountry = useMemo(
    () =>
      COUNTRIES.map((c) =>
        buildCountrySettlement({ legs, marks, countryCode: c.code, nameOf })
      ),
    [legs, marks, nameOf]
  );

  const currentCountryData = useMemo(() => {
    if (selectedCountry === 'ALL') return null;
    return perCountry.find((c) => c.countryCode === selectedCountry) || null;
  }, [selectedCountry, perCountry]);

  // Global aggregate metrics across all regions
  const globalMetrics = useMemo(() => {
    let totalCollect = 0;
    let totalPay = 0;
    let totalOutstandingPlayers = 0;

    perCountry.forEach((c) => {
      totalCollect += c.collectLocal || 0;
      totalPay += c.payLocal || 0;
      totalOutstandingPlayers += c.outstandingPlayerCount || 0;
    });

    return { totalCollect, totalPay, totalOutstandingPlayers };
  }, [perCountry]);

  const handleCountryTabChange = (code) => {
    setSelectedCountry(code);
    if (!embedded) {
      if (code === 'ALL') {
        navigate('/settlement');
      } else {
        navigate(`/settlement/${code.toLowerCase()}`);
      }
    }
  };

  const content = (
    <div className="space-y-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          {!embedded && (
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors mb-1.5"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" /> Back to Dashboard
            </Link>
          )}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            <h1 className="text-xl font-bold text-white uppercase tracking-tight flex items-center gap-2">
              Cross-Session Settlement Hub
            </h1>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">
            Aggregate outstanding balances across all historical sessions with one-click bulk settlement
          </p>
        </div>

        {/* Region Switcher Tabs */}
        <div className="flex bg-black/80 border border-white/10 p-0.5 shrink-0 self-start sm:self-auto font-mono">
          <button
            onClick={() => handleCountryTabChange('ALL')}
            className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
              selectedCountry === 'ALL'
                ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>🌐 All Regions</span>
          </button>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              onClick={() => handleCountryTabChange(c.code)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                selectedCountry === c.code
                  ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>{c.flag}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {state === 'loading' && (
        <div className="hud-corner-reticle bg-hud-card border border-white/10 p-12 text-center text-zinc-400 backdrop-blur-xl">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3 shadow-[0_0_10px_rgba(16,185,129,0.5)]"></div>
          <p className="text-xs font-mono uppercase tracking-wider text-zinc-400">Computing settlement matrix telemetry…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="hud-corner-reticle hud-corner-rose bg-hud-card border border-rose-500/30 p-6 text-center text-rose-400 backdrop-blur-xl">
          <p className="text-xs font-mono uppercase tracking-wider">Telemetry feed interrupted.</p>
          <button
            onClick={loadAll}
            className="mt-3 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-mono font-bold uppercase tracking-wider shadow-[0_0_10px_rgba(244,63,94,0.4)]"
          >
            Retry Connection
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="hud-corner-reticle hud-corner-emerald bg-hud-card/90 border border-white/10 p-4 space-y-1 backdrop-blur-xl">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest block">
                Total Receivables
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.7)]">
                  {selectedCountry === 'ALL'
                    ? `$${globalMetrics.totalCollect.toFixed(2)} CAD`
                    : money(currentCountryData?.collectLocal || 0, currentCountryData?.currency)}
                </span>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono block">Owed to bank by players</span>
            </div>

            <div className="hud-corner-reticle hud-corner-rose bg-hud-card/90 border border-white/10 p-4 space-y-1 backdrop-blur-xl">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest block">
                Total Payables
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.7)]">
                  {selectedCountry === 'ALL'
                    ? `$${globalMetrics.totalPay.toFixed(2)} CAD`
                    : money(currentCountryData?.payLocal || 0, currentCountryData?.currency)}
                </span>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono block">Bank owes winning players</span>
            </div>

            <div className="hud-corner-reticle hud-corner-cyan bg-hud-card/90 border border-white/10 p-4 space-y-1 backdrop-blur-xl">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase tracking-widest block">
                Outstanding Players
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono tabular-nums text-white">
                  {selectedCountry === 'ALL'
                    ? globalMetrics.totalOutstandingPlayers
                    : currentCountryData?.outstandingPlayerCount || 0}
                </span>
                <span className="text-xs font-mono text-zinc-500">pending</span>
              </div>
              <span className="text-[11px] text-zinc-500 font-mono block">Across all recorded games</span>
            </div>
          </div>

          {/* Search / Filter Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter players by master identity or session alias..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/80 border border-white/15 pl-10 pr-4 py-2.5 text-xs text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.3)] transition-all font-sans"
            />
          </div>

          {/* Render All Regions or Single Region */}
          {selectedCountry === 'ALL' ? (
            <div className="space-y-6">
              {perCountry.map((countryData) => (
                <CountrySection
                  key={countryData.countryCode}
                  data={countryData}
                  marks={marks}
                  searchQuery={searchQuery}
                  nameOf={nameOf}
                  busy={busy}
                  onSettleRows={settleRows}
                  onUndoIds={undoMarkIds}
                />
              ))}
            </div>
          ) : (
            currentCountryData && (
              <CountrySection
                data={currentCountryData}
                marks={marks}
                searchQuery={searchQuery}
                nameOf={nameOf}
                busy={busy}
                onSettleRows={settleRows}
                onUndoIds={undoMarkIds}
              />
            )
          )}
        </>
      )}

      {/* Global Undo Toast */}
      {undoState && (
        <div className="fixed inset-x-0 bottom-6 flex justify-center px-4 z-50 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-4 bg-black/90 border border-emerald-500/40 px-5 py-3 shadow-2xl text-xs font-mono backdrop-blur-2xl">
            <span className="text-zinc-200 font-medium">{undoState.label}</span>
            <button
              onClick={() => undoMarkIds(undoState.ids)}
              disabled={busy}
              className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors bg-emerald-500/10 px-2.5 py-1 border border-emerald-500/30"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Undo
            </button>
            <button
              onClick={() => setUndoState(null)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen bg-black text-zinc-200 font-sans selection:bg-emerald-500/30">
      <div className="max-w-5xl mx-auto px-4 py-8">{content}</div>
    </div>
  );
}

function CountrySection({
  data,
  marks,
  searchQuery = '',
  nameOf,
  busy,
  onSettleRows,
  onUndoIds
}) {
  const resolve = typeof nameOf === 'function' ? nameOf : () => null;
  const { countryCode, countryName, flag, currency, bankName, players, bankLines } = data;

  const markIdFor = useCallback(
    (sessionId, legId) => {
      const m = marks.find((x) => x.session_id === sessionId && x.leg_id === legId && !x.undone_at);
      return m ? m.id : null;
    },
    [marks]
  );

  const rowFromLine = (player, line) => ({
    session_id: line.sessionId,
    leg_id: line.legId,
    scope: 'player',
    country: countryCode,
    party_key: player.playerId || player.partyKey,
    party_name: player.name,
    counterparty_key: line.bankPartyKey || null,
    counterparty_name: line.bankName || bankName || null,
    direction: line.direction,
    amount_cad: line.amountCad,
    amount_local: line.amountLocal,
    currency: line.currency,
    session_date: line.date
  });

  const settlePlayer = (player) => {
    const rows = player.lines.filter((l) => !l.settled).map((l) => rowFromLine(player, l));
    onSettleRows(
      rows,
      `Settled ${player.name} · ${rows.length} session${rows.length === 1 ? '' : 's'} (${money(
        Math.abs(player.outstandingLocal),
        currency
      )})`
    );
  };

  const settleLine = (player, line) => {
    onSettleRows([rowFromLine(player, line)], `Settled ${player.name} · ${fmtDate(line.date)}`);
  };

  const settleBankLine = (line) => {
    onSettleRows(
      [
        {
          session_id: line.sessionId,
          leg_id: line.legId,
          scope: 'bank',
          country: countryCode,
          party_key: line.fromPartyKey || `${line.from}>${line.to}`,
          party_name: line.from,
          counterparty_key: line.toPartyKey || null,
          counterparty_name: line.to,
          direction: 'bank',
          amount_cad: line.amountCad,
          amount_local: line.amountLocal ?? line.amountCad,
          currency: 'CAD',
          session_date: line.date
        }
      ],
      `Settled ${line.from} → ${line.to} (${money(line.amountCad, 'CAD')})`
    );
  };

  const toggleLine = (settled, sessionId, legId, onSettle) => {
    if (settled) {
      const id = markIdFor(sessionId, legId);
      if (id) onUndoIds([id]);
    } else {
      onSettle();
    }
  };

  const filteredPlayers = useMemo(() => {
    if (!searchQuery.trim()) return players;
    const q = searchQuery.toLowerCase();
    return players.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [players, searchQuery]);

  const activePlayers = filteredPlayers.filter((p) => p.outstandingCount > 0);
  const clearedPlayers = filteredPlayers.filter((p) => p.outstandingCount === 0);
  const openBankLines = bankLines.filter((b) => !b.settled);

  const recentlySettled = marks
    .filter((m) => m.country === countryCode && !m.undone_at)
    .slice(0, 10);

  return (
    <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-6 space-y-6 backdrop-blur-xl">
      {/* Country Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/10 pb-4 gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{flag}</span>
          <div>
            <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2 font-sans">
              {countryName} Ledger
              <span className="text-xs font-mono font-bold px-2 py-0.5 bg-black border border-white/15 text-zinc-300">
                {currency}
              </span>
            </h2>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              {bankName ? (
                <span className="text-emerald-400/90 font-medium">Standing Bank: {bankName}</span>
              ) : (
                'No standing banker assigned'
              )}
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-zinc-400 sm:text-right">
          {activePlayers.length === 0 && openBankLines.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-400 font-bold uppercase tracking-wider">
              <CheckCircle2 className="w-3.5 h-3.5 drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" /> All Cleared
            </span>
          ) : (
            <span className="font-bold">
              {data.collectLocal > 0.005 && (
                <span className="text-emerald-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]">
                  Collect {money(data.collectLocal, currency)}
                </span>
              )}
              {data.collectLocal > 0.005 && data.payLocal > 0.005 && ' · '}
              {data.payLocal > 0.005 && (
                <span className="text-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.6)]">
                  Pay {money(data.payLocal, currency)}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Active Outstanding Players */}
      {activePlayers.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-cyan-400" />
            Outstanding Players ({activePlayers.length})
          </h3>
          <div className="bg-black/60 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {activePlayers.map((p) => (
              <PlayerCard
                key={p.key}
                player={p}
                currency={currency}
                busy={busy}
                onSettleAll={() => settlePlayer(p)}
                onToggleLine={(line) =>
                  toggleLine(line.settled, line.sessionId, line.legId, () => settleLine(p, line))
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-black/40 border border-white/10 p-5 text-center text-xs font-mono text-zinc-500 uppercase tracking-wider">
          No players with outstanding balances in {countryName}.
        </div>
      )}

      {/* Inter-Bank Transfers */}
      {openBankLines.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5 text-amber-400" />
            Between Regional Banks
          </h3>
          <div className="bg-black/60 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {openBankLines.map((b) => (
              <div
                key={`${b.sessionId}:${b.legId}`}
                className="flex items-center justify-between px-4 py-3 text-xs gap-3 hover:bg-white/[0.02] transition-colors font-mono"
              >
                <label className="flex items-center gap-3 min-w-0 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={busy}
                    onChange={() => settleBankLine(b)}
                    className="w-4 h-4 rounded border-white/20 text-emerald-500 focus:ring-emerald-500 bg-black cursor-pointer"
                  />
                  <span className="text-zinc-200 font-semibold truncate">
                    {b.from} <ArrowRight className="inline w-3 h-3 text-zinc-500 mx-1" /> {b.to}
                    <span className="text-zinc-500 font-normal ml-2">· {fmtDate(b.date)}</span>
                  </span>
                </label>
                <span className="font-bold text-amber-400 tabular-nums shrink-0">
                  {money(b.amountCad, 'CAD')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cleared Players Collapsible */}
      {clearedPlayers.length > 0 && (
        <details className="group space-y-2">
          <summary className="text-xs font-mono font-semibold text-zinc-500 hover:text-zinc-400 cursor-pointer flex items-center gap-1.5 select-none uppercase tracking-wider">
            <span className="group-open:rotate-90 transition-transform">▸</span>
            Fully Settled Players ({clearedPlayers.length})
          </summary>
          <div className="bg-black/40 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {clearedPlayers.map((p) => (
              <PlayerCard
                key={p.key}
                player={p}
                currency={currency}
                busy={busy}
                cleared
                onSettleAll={() => {}}
                onToggleLine={(line) =>
                  toggleLine(line.settled, line.sessionId, line.legId, () => settleLine(p, line))
                }
              />
            ))}
          </div>
        </details>
      )}

      {/* Recently Settled Audit Log */}
      {recentlySettled.length > 0 && (
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-zinc-400" />
            Recently Settled Activity
          </h3>
          <div className="bg-black/40 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {recentlySettled.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-xs gap-3 font-mono">
                <span className="text-zinc-400 truncate">
                  <strong className="text-zinc-200">{resolve(m.party_key) || m.party_name}</strong>
                  {m.counterparty_name && (
                    <>
                      {' '}
                      <span className="text-zinc-600">
                        {m.direction === 'from_bank' ? '←' : '→'}
                      </span>{' '}
                      <strong className="text-zinc-300">{resolve(m.counterparty_key) || m.counterparty_name}</strong>
                    </>
                  )}
                  <span className="text-zinc-500 ml-2">· {ago(m.settled_at)}</span>
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  {m.amount_local != null && (
                    <span className="text-zinc-300 font-bold tabular-nums">
                      {money(m.amount_local, m.currency || currency)}
                    </span>
                  )}
                  <button
                    onClick={() => onUndoIds([m.id])}
                    disabled={busy}
                    className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors bg-black px-2 py-0.5 border border-white/15"
                  >
                    Undo
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerCard({ player, currency, busy, cleared, onSettleAll, onToggleLine }) {
  const [open, setOpen] = useState(false);
  const owes = player.direction === 'owes_bank';

  return (
    <div className="p-3.5 hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {!cleared ? (
            <button
              onClick={onSettleAll}
              disabled={busy}
              className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white transition-all shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.3)]"
              title={`Settle all ${player.outstandingCount} outstanding sessions for ${player.name}`}
            >
              Settle All
            </button>
          ) : (
            <span className="w-5 h-5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 font-mono text-xs">
              ✓
            </span>
          )}

          <button onClick={() => setOpen((o) => !o)} className="text-left min-w-0 flex-1">
            <span className={`font-bold text-sm truncate block font-sans ${cleared ? 'text-zinc-500' : 'text-zinc-100'}`}>
              {player.name}
            </span>
            <span className="text-[11px] font-mono text-zinc-500">
              {cleared
                ? `${player.lines.length} session${player.lines.length === 1 ? '' : 's'} · cleared`
                : `${player.outstandingCount} session${player.outstandingCount === 1 ? '' : 's'} outstanding`}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`font-mono font-bold text-xs tabular-nums ${
              cleared 
                ? 'text-zinc-500' 
                : owes 
                ? 'text-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.6)]' 
                : 'text-emerald-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]'
            }`}
          >
            {cleared ? 'SETTLED' : `${owes ? 'owes ' : 'receives '}${money(player.outstandingLocal, currency)}`}
          </span>

          <button
            onClick={() => setOpen((o) => !o)}
            className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Expand session breakdown"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 pl-2 font-mono">
          {player.lines.map((line) => {
            const lineOwes = line.direction === 'to_bank';
            return (
              <label
                key={`${line.sessionId}:${line.legId}`}
                className="flex items-center justify-between py-1.5 px-2 text-xs hover:bg-white/[0.03] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={line.settled}
                    disabled={busy}
                    onChange={() => onToggleLine(line)}
                    className="w-3.5 h-3.5 rounded border-white/20 text-emerald-500 focus:ring-emerald-500 bg-black cursor-pointer"
                  />
                  <span className={`truncate text-xs ${line.settled ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                    {fmtDate(line.date)} · {lineOwes ? 'owes bank' : 'bank owes'}
                  </span>
                </div>
                <span
                  className={`font-mono font-bold tabular-nums text-xs shrink-0 ${
                    line.settled
                      ? 'text-zinc-700 line-through'
                      : lineOwes
                      ? 'text-rose-400'
                      : 'text-emerald-400'
                  }`}
                >
                  {money(line.amountLocal, line.currency || currency)}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
