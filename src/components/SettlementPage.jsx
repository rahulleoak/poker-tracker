import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, Check as CheckIcon } from 'lucide-react';
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

const shortSessionId = (id) =>
  id && id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id || '';

// Plain-text DM to a player about what they currently owe/are owed — settled
// lines excluded, since the point is to prompt payment of what's open. Full
// (untrimmed) session ids, since the recipient may need to paste one back.
function buildPlayerMessage(player, currency) {
  const outstanding = player.lines.filter((l) => !l.settled);
  const owes = player.direction === 'owes_bank';
  const total = money(Math.abs(player.outstandingLocal), currency);

  const blocks = outstanding.map((l) => {
    const lineOwes = l.direction === 'to_bank';
    return `${fmtDate(l.date)}\n - ${l.sessionId} - ${lineOwes ? 'you owe' : 'you will be sent'} ${money(
      l.amountLocal,
      l.currency
    )}`;
  });

  return [...blocks, `Overall you ${owes ? 'owe' : 'will be sent'} ${total}`].join('\n\n');
}

export default function SettlementPage() {
  const { country: countryParam } = useParams();
  const code = countryParam
    ? COUNTRIES.find((c) => c.code.toLowerCase() === countryParam.toLowerCase())?.code || null
    : null;
  const unknownCountry = Boolean(countryParam) && !code;

  const { players } = useIdentityGraph();
  const nameOf = useMemo(() => makeNameResolver(players), [players]);

  const [legs, setLegs] = useState([]);
  const [marks, setMarks] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [busy, setBusy] = useState(false);
  const [undoState, setUndoState] = useState(null); // { ids: [], label }

  const loadMarks = useCallback(() => {
    return sessionApi.listMarks().then((m) => setMarks(Array.isArray(m) ? m : []));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    sessionApi
      .ensureLegs()
      .catch((err) => console.warn('ensureLegs failed:', err))
      .then(() => Promise.all([sessionApi.listLegs(), sessionApi.listMarks()]))
      .then(([l, m]) => {
        if (cancelled) return;
        setLegs(Array.isArray(l) ? l : []);
        setMarks(Array.isArray(m) ? m : []);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load settlement data:', err);
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const detail = code ? perCountry.find((c) => c.countryCode === code) : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Settlement</p>
          {detail ? (
            <>
              <h1 className="text-2xl font-bold text-emerald-400">
                {detail.flag} {detail.countryName}
              </h1>
              <p className="text-sm text-slate-500">
                {detail.bankName ? `Bank · ${detail.bankName}` : 'No standing bank'} · settles in{' '}
                {detail.currency}
              </p>
            </>
          ) : (
            <h1 className="text-2xl font-bold text-emerald-400">Outstanding balances</h1>
          )}
          <div className="pt-2 text-sm">
            <Link to="/admin" className="text-slate-500 hover:text-slate-300">
              &larr; Admin
            </Link>
            {detail && (
              <>
                <span className="text-slate-700 mx-2">/</span>
                <Link to="/settlement" className="text-slate-500 hover:text-slate-300">
                  All countries
                </Link>
              </>
            )}
          </div>
        </header>

        {state === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
        {state === 'error' && (
          <p className="text-sm text-rose-400">Couldn&apos;t load settlement data.</p>
        )}
        {unknownCountry && (
          <p className="text-sm text-slate-500">Unknown country “{countryParam}”.</p>
        )}

        {state === 'ready' && !unknownCountry && !detail && (
          <IndexView countries={perCountry} />
        )}

        {state === 'ready' && detail && (
          <DetailView
            data={detail}
            marks={marks}
            nameOf={nameOf}
            busy={busy}
            onSettleRows={settleRows}
            onUndoIds={undoMarkIds}
          />
        )}
      </div>

      {undoState && (
        <div className="fixed inset-x-0 bottom-0 flex justify-center px-4 pb-6 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-4 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 shadow-2xl text-sm">
            <span className="text-slate-200">{undoState.label}</span>
            <button
              onClick={() => undoMarkIds(undoState.ids)}
              disabled={busy}
              className="font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
            >
              Undo
            </button>
            <button
              onClick={() => setUndoState(null)}
              className="text-slate-500 hover:text-slate-300"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IndexView({ countries }) {
  const anything = countries.some((c) => c.outstandingPlayerCount > 0 || c.bankLines.some((b) => !b.settled));
  return (
    <div className="space-y-4">
      {!anything && (
        <p className="text-sm text-slate-500">Everything is settled. Nothing outstanding.</p>
      )}
      {countries.map((c) => (
        <Link
          key={c.countryCode}
          to={`/settlement/${c.countryCode.toLowerCase()}`}
          className="block bg-slate-900 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-200">
                {c.flag} {c.countryName}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {c.bankName ? `Bank · ${c.bankName}` : 'No standing bank'}
              </div>
            </div>
            <div className="text-right text-sm">
              {c.outstandingPlayerCount === 0 ? (
                <span className="text-slate-600">settled</span>
              ) : (
                <>
                  <div className="text-slate-300">
                    {c.outstandingPlayerCount} player{c.outstandingPlayerCount === 1 ? '' : 's'} outstanding
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {c.collectLocal > 0.005 && (
                      <span className="text-emerald-400">collect {money(c.collectLocal, c.currency)}</span>
                    )}
                    {c.collectLocal > 0.005 && c.payLocal > 0.005 && ' · '}
                    {c.payLocal > 0.005 && (
                      <span className="text-rose-400">pay {money(c.payLocal, c.currency)}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function DetailView({ data, marks, nameOf, busy, onSettleRows, onUndoIds }) {
  const resolve = typeof nameOf === 'function' ? nameOf : () => null;
  const { countryCode, currency, bankName, players, bankLines } = data;

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
      `Settled ${player.name} · ${rows.length} session${rows.length === 1 ? '' : 's'} · ${money(
        Math.abs(player.outstandingLocal),
        currency
      )}`
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
      `Settled ${line.from} → ${line.to} · ${money(line.amountCad, 'CAD')}`
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

  const activePlayers = players.filter((p) => p.outstandingCount > 0);
  const clearedPlayers = players.filter((p) => p.outstandingCount === 0);
  const openBankLines = bankLines.filter((b) => !b.settled);

  const recentlySettled = marks
    .filter((m) => m.country === countryCode && !m.undone_at)
    .slice(0, 12);

  return (
    <div className="space-y-8">
      <div className="text-sm text-slate-400">
        {activePlayers.length === 0 && openBankLines.length === 0 ? (
          <span className="text-slate-500">Nothing outstanding for {data.countryName}.</span>
        ) : (
          <>
            {data.collectLocal > 0.005 && (
              <span className="text-emerald-400">
                {bankName || 'Bank'} collects {money(data.collectLocal, currency)}
              </span>
            )}
            {data.collectLocal > 0.005 && data.payLocal > 0.005 && <span className="text-slate-600"> · </span>}
            {data.payLocal > 0.005 && (
              <span className="text-rose-400">
                {bankName || 'Bank'} pays {money(data.payLocal, currency)}
              </span>
            )}
          </>
        )}
      </div>

      {activePlayers.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70">
          {activePlayers.map((p) => (
            <PlayerRow
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
      )}

      {openBankLines.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Between banks</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70">
            {openBankLines.map((b) => (
              <div key={`${b.sessionId}:${b.legId}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={false}
                  disabled={busy}
                  onChange={() => settleBankLine(b)}
                  className="w-4 h-4 accent-emerald-500 shrink-0"
                />
                <span className="text-slate-300 flex-1">
                  {b.from} <span className="text-slate-600">→</span> {b.to}
                  <span className="text-slate-600"> · {fmtDate(b.date)}</span>
                </span>
                <span className="text-slate-200 tabular-nums">{money(b.amountCad, 'CAD')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {clearedPlayers.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Fully settled</h2>
          <div className="bg-slate-900/50 border border-slate-800/60 rounded-xl divide-y divide-slate-800/50">
            {clearedPlayers.map((p) => (
              <PlayerRow
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
        </div>
      )}

      {recentlySettled.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Recently settled</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800/70">
            {recentlySettled.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-slate-400 flex-1">
                  {resolve(m.party_key) || m.party_name}
                  {m.counterparty_name && (
                    <>
                      {' '}
                      <span className="text-slate-600">
                        {m.direction === 'from_bank' ? '←' : '→'}
                      </span>{' '}
                      {resolve(m.counterparty_key) || m.counterparty_name}
                    </>
                  )}
                  <span className="text-slate-600"> · {ago(m.settled_at)}</span>
                </span>
                {m.amount_local != null && (
                  <span className="text-slate-500 tabular-nums">
                    {money(m.amount_local, m.currency || currency)}
                  </span>
                )}
                <button
                  onClick={() => onUndoIds([m.id])}
                  disabled={busy}
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-40"
                >
                  Undo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerRow({ player, currency, busy, cleared, onSettleAll, onToggleLine }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const owes = player.direction === 'owes_bank';
  const summary = cleared
    ? `${player.lines.length} session${player.lines.length === 1 ? '' : 's'} · all settled`
    : `${owes ? 'owes bank' : 'bank owes'} ${money(player.outstandingLocal, currency)} · ${
        player.outstandingCount
      } session${player.outstandingCount === 1 ? '' : 's'}`;

  const copyMessage = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(buildPlayerMessage(player, currency));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy settlement message:', err);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 text-sm">
        {!cleared ? (
          <input
            type="checkbox"
            checked={false}
            disabled={busy}
            onChange={onSettleAll}
            title={`Settle ${player.name} entirely`}
            className="w-4 h-4 accent-emerald-500 shrink-0"
          />
        ) : (
          <span className="w-4 h-4 shrink-0 text-emerald-500 text-center leading-4">✓</span>
        )}
        <button onClick={() => setOpen((o) => !o)} className="flex-1 text-left">
          <span className={cleared ? 'text-slate-500' : 'text-slate-200'}>{player.name}</span>
          <span className="text-slate-600"> · {summary}</span>
        </button>
        <span className={`tabular-nums ${cleared ? 'text-slate-600' : owes ? 'text-rose-400' : 'text-emerald-400'}`}>
          {cleared ? '' : money(player.outstandingLocal, currency)}
        </span>
        {!cleared && (
          <button
            onClick={copyMessage}
            title="Copy a message to send this player"
            className="text-slate-600 hover:text-emerald-400 shrink-0"
          >
            {copied ? <CheckIcon className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
        <button onClick={() => setOpen((o) => !o)} className="text-slate-600 w-4 text-center">
          {open ? '▾' : '▸'}
        </button>
      </div>

      {open && (
        <div className="mt-2 ml-7 space-y-1">
          {player.lines.map((line) => {
            const lineOwes = line.direction === 'to_bank';
            return (
              <div
                key={`${line.sessionId}:${line.legId}`}
                className="flex items-center gap-2.5 text-xs py-1"
              >
                <input
                  type="checkbox"
                  checked={line.settled}
                  disabled={busy}
                  onChange={() => onToggleLine(line)}
                  className="w-3.5 h-3.5 accent-emerald-500 shrink-0 cursor-pointer"
                />
                <span
                  onClick={() => !busy && onToggleLine(line)}
                  className={`flex-1 cursor-pointer ${line.settled ? 'text-slate-600 line-through' : 'text-slate-400'}`}
                >
                  {fmtDate(line.date)} · {lineOwes ? 'owes bank' : 'bank owes'}
                </span>
                <Link
                  to={`/admin/session/${line.sessionId}`}
                  title="Open session"
                  className="font-mono text-[10px] text-slate-600 hover:text-emerald-400 shrink-0"
                >
                  {shortSessionId(line.sessionId)}
                </Link>
                <span
                  className={`tabular-nums ${
                    line.settled ? 'text-slate-600' : lineOwes ? 'text-rose-400/80' : 'text-emerald-400/80'
                  }`}
                >
                  {money(line.amountLocal, line.currency)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
