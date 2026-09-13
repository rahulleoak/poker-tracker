import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, ArrowLeft } from 'lucide-react';
import { loadSessionCsv } from '../utils/storage';
import { extractSessionStartDate } from '../utils/pokernow-utils/sessionMeta';
import { peekSessionPreview, clearSessionPreview } from '../utils/sessionHandoff';
import { parseCumulativeNet, groupCumulativeNet, reconcileCumulativeNet, toPerPlayerSeries } from '../utils/pokernow-utils/parseHandLog';
import { fromChartData } from '../utils/chartData';
import { sessionApi } from '../utils/sessionApi';
import { useIdentityGraph } from '../hooks/useIdentityGraph';
import { makeNameResolver } from '../utils/adminIdentity';
import CumulativeNetChart from './CumulativeNetChart';
import SessionSettlementPanel from './SessionSettlementPanel';

const entryNet = (e) =>
  (Number(e?.buyOut) || 0) + (Number(e?.stack) || 0) - (Number(e?.buyIn) || 0);

// A "bank:<id>" entry with no money is a standing banker who didn't play — it
// exists only so settlement can route through them; hide it from the ledger.
const isAbsentBank = (e) =>
  String(e?.pokerNowId || '').startsWith('bank:') && entryNet(e) === 0;

// The session nicknames a player went by, minus the one already shown as their
// name, as { short } (≤ ~20 visible chars, whole names then "…") and { full }.
const ALIAS_BUDGET = 20;
function aliasSummary(displayName, sessionNames) {
  const dn = String(displayName || '').trim().toLowerCase();
  const others = [
    ...new Set(
      (sessionNames || [])
        .map((n) => String(n || '').trim())
        .filter((n) => n && n.toLowerCase() !== dn)
    )
  ];
  if (others.length === 0) return { short: null, full: null };
  const full = others.join(', ');
  if (full.length <= ALIAS_BUDGET) return { short: full, full };

  let acc = '';
  let shown = 0;
  for (const n of others) {
    const candidate = acc ? `${acc}, ${n}` : n;
    if (candidate.length + 1 > ALIAS_BUDGET) break;
    acc = candidate;
    shown += 1;
  }
  const short =
    shown === 0 ? `${others[0].slice(0, ALIAS_BUDGET - 1)}…` : `${acc}…`;
  return { short, full };
}

function downloadCumulativeNetCSV(sessionId, series) {
  const rows = [['playerId', 'nickname', 'handNumber', 'timestamp', 'net']];
  for (const [playerId, { nicknames, points }] of Object.entries(series)) {
    const nickname = nicknames[nicknames.length - 1] || playerId;
    for (const point of points) {
      rows.push([playerId, nickname, point.handNumber ?? '', point.timestamp, point.net]);
    }
  }

  const csv = rows
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sessionId}_cumulative_net.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function SessionPage() {
  const { sessionId } = useParams();

  // The /admin preview hands us everything in-memory (single-shot); every other
  // entry point (refresh, shared link, list click) falls back to the DB.
  const preview = useMemo(() => peekSessionPreview(sessionId), [sessionId]);
  useEffect(() => {
    if (preview) clearSessionPreview();
  }, [preview]);

  const [dbRow, setDbRow] = useState(null);
  const [fetchState, setFetchState] = useState('loading'); // loading | ready | not-found | error
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    setDbRow(null);
    setFetchState('loading');
    sessionApi
      .get(sessionId)
      .then((row) => {
        if (cancelled) return;
        setDbRow(row || null);
        setFetchState(row ? 'ready' : 'not-found');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to load session:', err);
        setFetchState('error');
      });
    return () => { cancelled = true; };
  }, [sessionId, preview, reloadKey]);

  // The stash (if present) is always ready; otherwise follow the fetch.
  const loadState = preview ? 'ready' : fetchState;

  // Live master-profile names (shared admin identity graph; see design doc Stage 2).
  const { players } = useIdentityGraph();
  const nameOf = useMemo(() => makeNameResolver(players), [players]);

  const csvText = useMemo(
    () => preview?.csvText ?? loadSessionCsv(sessionId),
    [preview, sessionId]
  );

  // Ledger entries drive the Latest Ledger table + Settlement input.
  const ledgerEntries = useMemo(() => {
    if (Array.isArray(preview?.game?.entries)) return preview.game.entries;
    if (Array.isArray(dbRow?.entries)) return dbRow.entries;
    return null;
  }, [preview, dbRow]);

  const parsed = useMemo(() => {
    if (preview?.csvText) {
      let p = parseCumulativeNet(preview.csvText);
      if (preview.groups) p = groupCumulativeNet(p, preview.groups);
      return reconcileCumulativeNet(p);
    }
    if (dbRow?.chart_data) return fromChartData(dbRow.chart_data);
    if (csvText) return reconcileCumulativeNet(parseCumulativeNet(csvText));
    return null;
  }, [preview, dbRow, csvText]);

  // Swap each charted line's label to its live master name when the column
  // carries a resolved playerId (fromChartData keys the map by playerId then).
  const displayParsed = useMemo(() => {
    if (!parsed) return null;
    let touched = false;
    const players = new Map();
    for (const [id, p] of parsed.players) {
      const name = nameOf(id);
      if (name) {
        touched = true;
        players.set(id, { ...p, nicknames: [name] });
      } else {
        players.set(id, p);
      }
    }
    return touched ? { players, snapshots: parsed.snapshots } : parsed;
  }, [parsed, nameOf]);

  const series = useMemo(
    () => (displayParsed ? toPerPlayerSeries(displayParsed) : null),
    [displayParsed]
  );

  const latestLedger = useMemo(() => {
    if (ledgerEntries) {
      return ledgerEntries
        .filter((e) => e && (e.name || '').trim() !== '' && !isAbsentBank(e))
        .map((e) => {
          const name = nameOf(e.playerId) || e.name;
          const sessionNames =
            Array.isArray(e.aliases) && e.aliases.length ? e.aliases : [e.name];
          const { short, full } = aliasSummary(name, sessionNames);
          return {
            key: e.pokerNowId || e.externalId || e.name,
            name,
            aliasShort: short,
            aliasFull: full,
            net: entryNet(e)
          };
        })
        .sort((a, b) => b.net - a.net);
    }
    if (!parsed || parsed.snapshots.length === 0) return [];
    const latest = parsed.snapshots[parsed.snapshots.length - 1];
    return Object.entries(latest.nets)
      .map(([key, { nickname, net }]) => ({ key, name: nickname, aliasShort: null, aliasFull: null, net }))
      .sort((a, b) => b.net - a.net);
  }, [ledgerEntries, parsed, nameOf]);

  const settlementConfig = preview?.settlement || dbRow?.settlement || {};
  const totalBuyIn = useMemo(() => {
    return (ledgerEntries || []).reduce((s, e) => s + (Number(e?.buyIn) || 0), 0);
  }, [ledgerEntries]);

  const handCount = parsed?.snapshots.length ? parsed.snapshots.length - 1 : 0;

  const startDate =
    preview?.game?.date ||
    (dbRow?.date ? String(dbRow.date).slice(0, 10) : null) ||
    (csvText ? extractSessionStartDate(csvText) : null);
  const startLabel = startDate
    ? new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : null;
  const hasChart = Boolean(parsed && parsed.snapshots.length > 0);
  const hasLedger = latestLedger.length > 0;

  const subtitle = [
    startLabel && `Started ${startLabel}`,
    hasChart && `${handCount.toLocaleString()} hands`,
    (hasLedger || hasChart) && `${latestLedger.length} players`
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-8">
        <header className="space-y-1">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-300 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Admin
          </Link>
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Session</p>
          <h1 className="text-2xl font-bold text-emerald-400 font-mono tracking-tight break-all">{sessionId}</h1>
          {subtitle.length > 0 && (
            <p className="text-sm text-slate-500">{subtitle.join(' · ')}</p>
          )}
        </header>

        {loadState === 'loading' && (
          <p className="text-sm text-slate-500">Loading session…</p>
        )}

        {loadState === 'not-found' && (
          <p className="text-sm text-slate-500">Session not found.</p>
        )}

        {loadState === 'error' && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-rose-400">Couldn&apos;t load this session.</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              Retry
            </button>
          </div>
        )}

        {loadState === 'ready' && !hasChart && !hasLedger && (
          <p className="text-sm text-slate-500">No hand log data found for this session.</p>
        )}

        {loadState === 'ready' && (hasChart || hasLedger) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            {hasChart && (
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-slate-300">Cumulative Net</h2>
                  <button
                    onClick={() => downloadCumulativeNetCSV(sessionId, series)}
                    className="flex items-center gap-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download cumulative net
                  </button>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-center">
                  <CumulativeNetChart parsed={displayParsed} />
                </div>
              </div>
            )}

            <div className={`${hasChart ? 'lg:col-span-1' : 'lg:col-span-3'} bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col`}>
              <div className="px-5 py-4 border-b border-slate-800">
                <h2 className="text-sm font-medium text-slate-300">Latest Ledger</h2>
              </div>
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr className="text-slate-500 text-xs uppercase tracking-wider">
                      <th className="text-left px-5 py-2.5 font-medium">Player</th>
                      <th className="text-right px-5 py-2.5 font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestLedger.map(({ key, name, aliasShort, aliasFull, net }, i) => (
                      <tr key={key} className="border-t border-slate-800/80 hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3">
                          <span className="text-slate-600 text-xs tabular-nums mr-2 w-4 inline-block">{i + 1}</span>
                          <span title={aliasFull ? `Session names: ${aliasFull}` : undefined}>
                            {name}
                            {aliasShort && (
                              <span className="text-slate-500"> ({aliasShort})</span>
                            )}
                          </span>
                        </td>
                        <td className={`px-5 py-3 text-right font-medium tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {net >= 0 ? '+' : ''}{net.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {loadState === 'ready' && ledgerEntries && (
          <div className="mt-8">
            <SessionSettlementPanel
              entries={ledgerEntries}
              settlementConfig={settlementConfig}
              sessionId={sessionId}
              startDate={startDate}
              nameOf={nameOf}
              isBalanced={true}
              totalBuyIn={totalBuyIn || 1}
            />
          </div>
        )}
      </div>
    </div>
  );
}
