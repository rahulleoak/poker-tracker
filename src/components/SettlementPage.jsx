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
  ArrowLeft,
  Check
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
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function SettlementPage({ embedded = false }) {
  const { country: routeCountry } = useParams();
  const navigate = useNavigate();

  const [activeCountry, setActiveCountry] = useState(() => {
    const code = (routeCountry || 'CA').toUpperCase();
    return COUNTRIES.some((c) => c.code === code) ? code : 'CA';
  });

  const [sessions, setSessions] = useState([]);
  const [marks, setMarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [undoToast, setUndoToast] = useState(null);

  const { graph, resolve } = useIdentityGraph();

  useEffect(() => {
    if (routeCountry) {
      const code = routeCountry.toUpperCase();
      if (COUNTRIES.some((c) => c.code === code) && code !== activeCountry) {
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
      const [sessRes, marksRes] = await Promise.all([
        sessionApi.list(),
        sessionApi.listMarks()
      ]);
      setSessions(sessRes || []);
      setMarks(marksRes || []);
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

  const currentCountryConfig = useMemo(
    () => COUNTRIES.find((c) => c.code === activeCountry) || COUNTRIES[0],
    [activeCountry]
  );

  const countryData = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    return buildCountrySettlement(activeCountry, sessions, marks, resolve);
  }, [activeCountry, sessions, marks, resolve]);

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
      await sessionApi.unmarkBulk(ids);
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
      party_key: player.key,
      party_name: player.name,
      counterparty_key: line.bankKey || null,
      counterparty_name: line.bankName || null,
      direction: line.direction,
      amount_cad: line.amountCad,
      amount_local: line.amountLocal,
      currency: line.currency || currentCountryConfig.currency,
      session_date: line.date || null
    }));

    try {
      const inserted = await sessionApi.markBulk(payloads);
      if (inserted && inserted.length > 0) {
        setMarks((prev) => [...prev, ...inserted]);
        showUndo(
          inserted.map((m) => m.id),
          `Settled ${inserted.length} line${inserted.length === 1 ? '' : 's'} for ${player.name}`
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
        await sessionApi.unmark(markId);
        setMarks((prev) => prev.filter((m) => m.id !== markId));
      } else {
        const payload = buildPayload();
        const inserted = await sessionApi.mark(payload);
        if (inserted) {
          setMarks((prev) => [...prev, inserted]);
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
        party_key: b.fromKey,
        party_name: b.from,
        counterparty_key: b.toKey,
        counterparty_name: b.to,
        direction: 'bank',
        amount_cad: b.amountCad,
        amount_local: b.amountCad,
        currency: 'CAD',
        session_date: b.date || null
      };
      const inserted = await sessionApi.mark(payload);
      if (inserted) {
        setMarks((prev) => [...prev, inserted]);
        showUndo([inserted.id], `Settled bank transfer: ${b.from} → ${b.to}`);
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
                {sessions.length} sessions tracked
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight mt-1">
              Cross-Border Settlement Desk
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-mono">
              Net balance rollup by regional banker & player clearing state.
            </p>
          </div>

          {/* Country Selector Tabs */}
          <div className="flex gap-2 bg-black/60 border border-white/10 p-1 self-start md:self-auto">
            {COUNTRIES.map((c) => {
              const active = c.code === activeCountry;
              return (
                <button
                  key={c.code}
                  onClick={() => handleCountrySelect(c.code)}
                  className={`px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 ${
                    active
                      ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
                  }`}
                >
                  <span className="text-base">{c.flag}</span>
                  <span>{c.name}</span>
                  <span className="text-[10px] text-zinc-500">({c.currency})</span>
                </button>
              );
            })}
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
          resolve={resolve}
          onSettlePlayer={handleSettlePlayer}
          onToggleLine={handleToggleLine}
          onSettleBankLine={handleSettleBankLine}
          onUndoIds={handleUndo}
        />
      ) : null}

      {/* Undo Toast */}
      {undoToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 border border-emerald-500/40 shadow-2xl p-4 flex items-center gap-4 text-xs font-mono animate-in fade-in slide-in-from-bottom duration-200 max-w-md">
          <span className="text-emerald-400 flex items-center gap-2 font-medium">
            <CheckCircle2 className="w-4 h-4" />
            {undoToast.label}
          </span>
          <button
            onClick={() => handleUndo(undoToast.ids)}
            disabled={busy}
            className="px-3 py-1 bg-black border border-white/20 text-zinc-200 hover:text-white hover:border-emerald-400 uppercase tracking-wider font-bold transition-all ml-auto shrink-0 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3 text-cyan-400" /> Undo
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
  const q = search.trim().toLowerCase();

  const activePlayers = useMemo(() => {
    return (data?.players || [])
      .filter((p) => p.outstandingCount > 0)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [data, q]);

  const clearedPlayers = useMemo(() => {
    return (data?.players || [])
      .filter((p) => p.outstandingCount === 0 && p.lines.length > 0)
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [data, q]);

  const openBankLines = useMemo(() => {
    return (data?.bankTransfers || []).filter((b) => !b.settled);
  }, [data]);

  const recentlySettled = useMemo(() => {
    return (data?.recentMarks || []).slice(0, 10);
  }, [data]);

  const settlePlayer = (player) => onSettlePlayer(player);
  const settleLine = (player, line) => ({
    session_id: line.sessionId,
    leg_id: line.legId,
    scope: 'player',
    country: countryCode,
    party_key: player.key,
    party_name: player.name,
    counterparty_key: line.bankKey || null,
    counterparty_name: line.bankName || null,
    direction: line.direction,
    amount_cad: line.amountCad,
    amount_local: line.amountLocal,
    currency: line.currency || currency,
    session_date: line.date || null
  });
  const toggleLine = (settled, sId, lId, payloadFn) => onToggleLine(settled, sId, lId, payloadFn);
  const settleBankLine = (b) => onSettleBankLine(b);

  return (
    <div className="space-y-6">
      {/* Country Net Balance Overview Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
            Net Banker Position ({countryName})
          </span>
          <span
            className={`text-xl font-bold font-mono tabular-nums mt-1 block ${
              data.netOutstandingLocal > 0
                ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                : data.netOutstandingLocal < 0
                ? 'text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : 'text-zinc-400'
            }`}
          >
            {data.netOutstandingLocal >= 0 ? '+' : '−'}
            {money(data.netOutstandingLocal, currency)}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {data.netOutstandingLocal >= 0 ? 'Bank is owed by players' : 'Bank owes players'}
          </span>
        </div>

        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
            Unsettled Player Debts
          </span>
          <span className="text-xl font-bold font-mono tabular-nums text-rose-400 mt-1 block">
            {money(data.payLocal, currency)}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {data.payCount} pending payments to bank
          </span>
        </div>

        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider block">
            Unsettled Player Payouts
          </span>
          <span className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1 block">
            {money(data.collectLocal, currency)}
          </span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {data.collectCount} pending collections from bank
          </span>
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
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => settleBankLine(b)}
                    className="w-4 h-4 rounded-none border border-white/25 bg-black/80 hover:border-emerald-400 flex items-center justify-center cursor-pointer transition-all shrink-0"
                    title="Mark bank transfer settled"
                  >
                    <Check className="w-3 h-3 text-transparent hover:text-emerald-400" />
                  </button>
                  <span className="text-zinc-200 font-semibold truncate">
                    {b.from} <ArrowRight className="inline w-3 h-3 text-zinc-500 mx-1" /> {b.to}
                    <span className="text-zinc-500 font-normal ml-2">· {fmtDate(b.date)}</span>
                  </span>
                </div>
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
              <div
                key={`${line.sessionId}:${line.legId}`}
                className="flex items-center justify-between py-1.5 px-2 text-xs hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onToggleLine(line)}
                    className={`w-4 h-4 shrink-0 border transition-all flex items-center justify-center cursor-pointer ${
                      line.settled
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                        : 'bg-black/80 border-white/25 text-transparent hover:border-emerald-400/60'
                    }`}
                    title={line.settled ? "Settled (Click to mark unsettled)" : "Click to mark settled"}
                  >
                    <Check className={`w-3 h-3 stroke-[3] transition-transform ${line.settled ? 'scale-100' : 'scale-0'}`} />
                  </button>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
