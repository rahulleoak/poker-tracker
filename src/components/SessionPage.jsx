import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { loadSessionCsv } from '../utils/storage';
import { parseCumulativeNet, toPerPlayerSeries } from '../utils/pokernow-utils/parseHandLog';
import CumulativeNetChart from './CumulativeNetChart';

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
  const csvText = useMemo(() => loadSessionCsv(sessionId), [sessionId]);

  const parsed = useMemo(() => (csvText ? parseCumulativeNet(csvText) : null), [csvText]);
  const series = useMemo(() => (parsed ? toPerPlayerSeries(parsed) : null), [parsed]);

  const latestLedger = useMemo(() => {
    if (!parsed || parsed.snapshots.length === 0) return [];
    const latest = parsed.snapshots[parsed.snapshots.length - 1];
    return Object.entries(latest.nets)
      .map(([playerId, { nickname, net }]) => ({ playerId, nickname, net }))
      .sort((a, b) => b.net - a.net);
  }, [parsed]);

  const handCount = parsed?.snapshots.length ? parsed.snapshots.length - 1 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <div className="max-w-[1600px] mx-auto px-8 py-10 space-y-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Session</p>
          <h1 className="text-2xl font-bold text-emerald-400 font-mono tracking-tight break-all">{sessionId}</h1>
          {parsed && (
            <p className="text-sm text-slate-500">
              {handCount.toLocaleString()} hands · {latestLedger.length} players
            </p>
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
      </div>
    </div>
  );
}
