import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { 
  Landmark, 
  RotateCcw, 
  Search, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  ArrowRight, 
  Users, 
  ShieldCheck, 
  Coins, 
  ArrowLeft,
  Filter
} from 'lucide-react';
import { COUNTRIES } from '../utils/countries';
import { sessionApi } from '../utils/sessionApi';
import { buildCountrySettlement } from '../utils/settlementLedger';
import { useIdentityGraph } from '../hooks/useIdentityGraph';
import { makeNameResolver } from '../utils/adminIdentity';

const money = (n, currency = 'CAD') => `$${Math.abs(Number(n) || 0).toFixed(2)} ${currency}`;

const fmtDate = (d) =>
  d
    ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : '—';

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SettlementPage({ embedded = false }) {
  const { country: countryParam } = useParams();
  const navigate = useNavigate();

  const [selectedCountry, setSelectedCountry] = useState(() => {
    if (countryParam) {
      const match = COUNTRIES.find((c) => c.code.toLowerCase() === countryParam.toLowerCase());
      return match ? match.code : 'ALL';
    }
    return 'ALL';
  });

  useEffect(() => {
    if (countryParam) {
      const match = COUNTRIES.find((c) => c.code.toLowerCase() === countryParam.toLowerCase());
      if (match) setSelectedCountry(match.code);
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
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          {!embedded && (
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors mb-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
            </Link>
          )}
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Landmark className="w-6 h-6 text-emerald-400" />
            Cross-Session Settlement Hub
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Aggregate outstanding balances across all historical sessions with one-click bulk settlement.
          </p>
        </div>

        {/* Region Switcher Tabs */}
        <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-1 shrink-0 self-start sm:self-auto">
          <button
            onClick={() => handleCountryTabChange('ALL')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
              selectedCountry === 'ALL'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>🌐 All Regions</span>
          </button>
          {COUNTRIES.map((c) => (
            <button
              key={c.code}
              onClick={() => handleCountryTabChange(c.code)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                selectedCountry === c.code
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span>{c.flag}</span>
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      </div>

      {state === 'loading' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm">Calculating cross-session balances…</p>
        </div>
      )}

      {state === 'error' && (
        <div className="bg-rose-950/30 border border-rose-900/50 rounded-2xl p-6 text-center text-rose-400">
          <p className="text-sm">Could not load settlement data.</p>
          <button
            onClick={loadAll}
            className="mt-3 px-4 py-1.5 bg-rose-900/50 hover:bg-rose-800/50 text-white text-xs font-semibold rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && (
        <>
          {/* Key Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Total Receivables
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-400">
                  {selectedCountry === 'ALL'
                    ? `$${globalMetrics.totalCollect.toFixed(2)} CAD`
                    : money(currentCountryData?.collectLocal || 0, currentCountryData?.currency)}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 block">Owed to bank by players</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Total Payables
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-rose-400">
                  {selectedCountry === 'ALL'
                    ? `$${globalMetrics.totalPay.toFixed(2)} CAD`
                    : money(currentCountryData?.payLocal || 0, currentCountryData?.currency)}
                </span>
              </div>
              <span className="text-[11px] text-slate-500 block">Bank owes winning players</span>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-1">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">
                Outstanding Players
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-100">
                  {selectedCountry === 'ALL'
                    ? globalMetrics.totalOutstandingPlayers
                    : currentCountryData?.outstandingPlayerCount || 0}
                </span>
                <span className="text-xs text-slate-500">pending settlement</span>
              </div>
              <span className="text-[11px] text-slate-500 block">Across all recorded games</span>
            </div>
          </div>

          {/* Search / Filter Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter players by name or handle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Render All Regions or Single Region */}
          {selectedCountry === 'ALL' ? (
            <div className="space-y-8">
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
          <div className="pointer-events-auto flex items-center gap-4 bg-slate-900 border border-emerald-500/40 rounded-xl px-5 py-3.5 shadow-2xl text-sm animate-in slide-in-from-bottom-5">
            <span className="text-slate-100 font-medium">{undoState.label}</span>
            <button
              onClick={() => undoMarkIds(undoState.ids)}
              disabled={busy}
              className="flex items-center gap-1.5 font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Undo
            </button>
            <button
              onClick={() => setUndoState(null)}
              className="text-slate-400 hover:text-slate-200 text-xs"
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
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
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
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6">
      {/* Country Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-4 gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">{flag}</span>
          <div>
            <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              {countryName} Ledger
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {currency}
              </span>
            </h2>
            <p className="text-xs text-slate-500">
              {bankName ? (
                <span className="text-emerald-400/90 font-medium">Standing Bank: {bankName}</span>
              ) : (
                'No standing banker assigned'
              )}
            </p>
          </div>
        </div>

        <div className="text-xs text-slate-400 sm:text-right">
          {activePlayers.length === 0 && openBankLines.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" /> All settled up
            </span>
          ) : (
            <span>
              {data.collectLocal > 0.005 && (
                <span className="text-emerald-400 font-semibold">
                  Collect {money(data.collectLocal, currency)}
                </span>
              )}
              {data.collectLocal > 0.005 && data.payLocal > 0.005 && ' · '}
              {data.payLocal > 0.005 && (
                <span className="text-rose-400 font-semibold">
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
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-emerald-400" />
            Outstanding Players ({activePlayers.length})
          </h3>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl divide-y divide-slate-800/60 overflow-hidden">
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
        <div className="bg-slate-950/30 border border-slate-800/50 rounded-xl p-5 text-center text-xs text-slate-500">
          No players with outstanding balances in {countryName}.
        </div>
      )}

      {/* Inter-Bank Transfers */}
      {openBankLines.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Landmark className="w-3.5 h-3.5 text-amber-400" />
            Between Regional Banks
          </h3>
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl divide-y divide-slate-800/60 overflow-hidden">
            {openBankLines.map((b) => (
              <div
                key={`${b.sessionId}:${b.legId}`}
                className="flex items-center justify-between px-4 py-3 text-xs gap-3 hover:bg-slate-900/30 transition-colors"
              >
                <label className="flex items-center gap-3 min-w-0 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={busy}
                    onChange={() => settleBankLine(b)}
                    className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
                  />
                  <span className="text-slate-200 font-semibold truncate">
                    {b.from} <ArrowRight className="inline w-3 h-3 text-slate-500 mx-1" /> {b.to}
                    <span className="text-slate-500 font-normal ml-2">· {fmtDate(b.date)}</span>
                  </span>
                </label>
                <span className="font-bold text-slate-200 shrink-0">
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
          <summary className="text-xs font-semibold text-slate-500 hover:text-slate-400 cursor-pointer flex items-center gap-1.5 select-none">
            <span className="group-open:rotate-90 transition-transform">▸</span>
            Fully Settled Players ({clearedPlayers.length})
          </summary>
          <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl divide-y divide-slate-800/40 overflow-hidden">
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
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            Recently Settled Activity
          </h3>
          <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl divide-y divide-slate-800/40 overflow-hidden">
            {recentlySettled.map((m) => (
              <div key={m.id} className="flex items-center justify-between px-4 py-2.5 text-xs gap-3">
                <span className="text-slate-400 truncate">
                  <strong className="text-slate-200">{resolve(m.party_key) || m.party_name}</strong>
                  {m.counterparty_name && (
                    <>
                      {' '}
                      <span className="text-slate-600">
                        {m.direction === 'from_bank' ? '←' : '→'}
                      </span>{' '}
                      <strong className="text-slate-300">{resolve(m.counterparty_key) || m.counterparty_name}</strong>
                    </>
                  )}
                  <span className="text-slate-500 ml-2">· {ago(m.settled_at)}</span>
                </span>
                <div className="flex items-center gap-3 shrink-0">
                  {m.amount_local != null && (
                    <span className="text-slate-300 font-semibold tabular-nums">
                      {money(m.amount_local, m.currency || currency)}
                    </span>
                  )}
                  <button
                    onClick={() => onUndoIds([m.id])}
                    disabled={busy}
                    className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors bg-slate-900 px-2 py-0.5 rounded border border-slate-800"
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
    <div className="p-3.5 hover:bg-slate-900/40 transition-colors">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {!cleared ? (
            <button
              onClick={onSettleAll}
              disabled={busy}
              className="px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shrink-0 shadow-sm"
              title={`Settle all ${player.outstandingCount} outstanding sessions for ${player.name}`}
            >
              Settle All
            </button>
          ) : (
            <span className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              ✓
            </span>
          )}

          <button onClick={() => setOpen((o) => !o)} className="text-left min-w-0 flex-1">
            <span className={`font-bold text-sm truncate block ${cleared ? 'text-slate-400' : 'text-slate-100'}`}>
              {player.name}
            </span>
            <span className="text-[11px] text-slate-500">
              {cleared
                ? `${player.lines.length} session${player.lines.length === 1 ? '' : 's'} · all settled`
                : `${player.outstandingCount} session${player.outstandingCount === 1 ? '' : 's'} outstanding`}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span
            className={`font-bold text-sm tabular-nums ${
              cleared ? 'text-slate-500' : owes ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {cleared ? 'Settled' : `${owes ? 'owes ' : 'receives '}${money(player.outstandingLocal, currency)}`}
          </span>

          <button
            onClick={() => setOpen((o) => !o)}
            className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            title="Expand session breakdown"
          >
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-1.5 pl-2">
          {player.lines.map((line) => {
            const lineOwes = line.direction === 'to_bank';
            return (
              <label
                key={`${line.sessionId}:${line.legId}`}
                className="flex items-center justify-between py-1.5 px-2 rounded-lg text-xs hover:bg-slate-900/60 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={line.settled}
                    disabled={busy}
                    onChange={() => onToggleLine(line)}
                    className="w-3.5 h-3.5 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 bg-slate-900 cursor-pointer"
                  />
                  <span className={`truncate ${line.settled ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                    {fmtDate(line.date)} · {lineOwes ? 'owes bank' : 'bank owes'}
                  </span>
                </div>
                <span
                  className={`font-semibold tabular-nums shrink-0 ${
                    line.settled
                      ? 'text-slate-600 line-through'
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
