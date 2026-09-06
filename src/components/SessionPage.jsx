import { useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { loadSessionCsv } from '../utils/storage';
import { extractSessionStartDate } from '../utils/pokernow-utils/sessionMeta';
import { computeBankSettlement } from '../utils/bankSettlement';
import { peekSessionPreview, clearSessionPreview } from '../utils/sessionHandoff';
import { parseCumulativeNet, groupCumulativeNet, reconcileCumulativeNet, toPerPlayerSeries } from '../utils/pokernow-utils/parseHandLog';
import CumulativeNetChart from './CumulativeNetChart';

const entryNet = (e) =>
  (Number(e?.buyOut) || 0) + (Number(e?.stack) || 0) - (Number(e?.buyIn) || 0);

const money = (n, currency = 'CAD') => `$${Math.abs(Number(n) || 0).toFixed(2)} ${currency}`;

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

  // The /admin preview hands us everything in-memory (single-shot); fall back to
  // the localStorage cache for any other entry point or a hard refresh.
  const preview = useMemo(() => peekSessionPreview(sessionId), [sessionId]);
  useEffect(() => {
    if (preview) clearSessionPreview();
  }, [preview]);

  const csvText = useMemo(
    () => preview?.csvText ?? loadSessionCsv(sessionId),
    [preview, sessionId]
  );
  const passedEntries = Array.isArray(preview?.game?.entries) ? preview.game.entries : null;

  const parsed = useMemo(() => {
    if (!csvText) return null;
    let p = parseCumulativeNet(csvText);
    // Fold players linked in the /admin dialog into a single charted line, then
    // ease the reconstruction residual to zero so the chart ends where the
    // ledger table does.
    if (preview?.groups) p = groupCumulativeNet(p, preview.groups);
    return reconcileCumulativeNet(p);
  }, [csvText, preview]);
  const series = useMemo(() => (parsed ? toPerPlayerSeries(parsed) : null), [parsed]);

  const latestLedger = useMemo(() => {
    if (passedEntries) {
      return passedEntries
        .filter((e) => e && (e.name || '').trim() !== '')
        .map((e) => ({
          playerId: e.pokerNowId || e.externalId || e.name,
          nickname: e.name,
          net: entryNet(e)
        }))
        .sort((a, b) => b.net - a.net);
    }
    if (!parsed || parsed.snapshots.length === 0) return [];
    const latest = parsed.snapshots[parsed.snapshots.length - 1];
    return Object.entries(latest.nets)
      .map(([playerId, { nickname, net }]) => ({ playerId, nickname, net }))
      .sort((a, b) => b.net - a.net);
  }, [passedEntries, parsed]);

  const settlement = useMemo(
    () =>
      passedEntries
        ? computeBankSettlement({ entries: passedEntries, ...(preview?.settlement || {}) })
        : null,
    [passedEntries, preview]
  );

  const handCount = parsed?.snapshots.length ? parsed.snapshots.length - 1 : 0;

  const startDate = preview?.game?.date || (csvText ? extractSessionStartDate(csvText) : null);
  const startLabel = startDate
    ? new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
    : null;
  const subtitle = [
    startLabel && `Started ${startLabel}`,
    parsed && `${handCount.toLocaleString()} hands`,
    parsed && `${latestLedger.length} players`
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Session</p>
          <h1 className="text-2xl font-bold text-emerald-400 font-mono tracking-tight break-all">{sessionId}</h1>
          {subtitle.length > 0 && (
            <p className="text-sm text-slate-500">{subtitle.join(' · ')}</p>
          )}
        </header>

        {!csvText ? (
          <p className="text-sm text-slate-500">No hand log data found for this session.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
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
                <CumulativeNetChart parsed={parsed} />
              </div>
            </div>

            <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
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
                    {latestLedger.map(({ playerId, nickname, net }, i) => (
                      <tr key={playerId} className="border-t border-slate-800/80 hover:bg-slate-800/40 transition-colors">
                        <td className="px-5 py-3">
                          <span className="text-slate-600 text-xs tabular-nums mr-2 w-4 inline-block">{i + 1}</span>
                          {nickname}
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

        {settlement && settlement.countries.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-300">Settlement</h2>
              <span className="text-xs text-slate-500">
                {settlement.chipsPerCad} chips = 1 CAD · 1 CAD = {settlement.cadToUsd} USD
              </span>
            </div>
            <div className="p-5 space-y-5">
              {settlement.countries.map((c) => {
                const nonBank = c.members.filter((m) => !m.isBank && Math.abs(m.netLocal) >= 0.005);
                const converted = c.currency !== 'CAD';
                return (
                  <div key={c.code} className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-400 flex items-center gap-2 flex-wrap">
                      <span>{c.flag} {c.name}</span>
                      <span className="text-slate-600">
                        {c.bankName ? `Bank · ${c.bankName}` : 'No bank assigned'}
                      </span>
                      <span className="text-slate-600">
                        settles in {c.currency}
                        {converted && ` (1 CAD = ${c.fxFromCad} ${c.currency})`}
                      </span>
                    </div>
                    {c.bankName ? (
                      <div className="divide-y divide-slate-800/60">
                        {nonBank.map((m) => (
                          <div key={m.key} className="flex items-center justify-between py-2 text-sm gap-3">
                            <span className="text-slate-300 truncate">{m.name}</span>
                            <span className={`shrink-0 text-right ${m.netLocal >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {m.netLocal >= 0
                                ? `receives ${money(m.netLocal, c.currency)} from ${c.bankName}`
                                : `pays ${money(m.netLocal, c.currency)} to ${c.bankName}`}
                              {converted && (
                                <span className="text-slate-600"> ({money(m.netCad, 'CAD')})</span>
                              )}
                            </span>
                          </div>
                        ))}
                        {nonBank.length === 0 && (
                          <div className="py-2 text-sm text-slate-600 italic">Everyone in {c.name} broke even.</div>
                        )}
                        <div className="flex items-center justify-between py-2 text-sm gap-3">
                          <span className="text-slate-300 truncate">
                            {c.bankName} <span className="text-[10px] uppercase font-bold text-emerald-500/70">bank</span>
                          </span>
                          <span className="text-slate-500 shrink-0">
                            country net {c.netLocal >= 0 ? '+' : '−'}{money(c.netLocal, c.currency)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600 italic">
                        Assign a bank for {c.name} in the review dialog to route its settlement.
                      </p>
                    )}
                  </div>
                );
              })}

              {settlement.bankTransfers.length > 0 && (
                <div className="space-y-1.5 pt-3 border-t border-slate-800">
                  <div className="text-xs font-semibold text-slate-400">Between banks</div>
                  <div className="divide-y divide-slate-800/60">
                    {settlement.bankTransfers.map((t, i) => (
                      <div key={i} className="flex items-center justify-between py-2 text-sm gap-3">
                        <span className="text-slate-300 truncate">
                          {t.from} <span className="text-slate-600">→</span> {t.to}
                        </span>
                        <span className="text-slate-200 shrink-0">
                          {money(t.amount, 'CAD')}
                          {settlement.cadToUsd !== 1 && (
                            <span className="text-slate-600"> ({money(t.amount * settlement.cadToUsd, 'USD')})</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
