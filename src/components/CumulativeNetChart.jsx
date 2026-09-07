import { useMemo, useRef, useState } from 'react';

// Fixed-order categorical palette (dark-surface steps), CVD-validated adjacent
// ordering. Never reassign a color by rank - each player keeps its slot for
// the life of the chart, regardless of which players are currently hidden.
// Beyond 8 series, colors repeat (rare for a poker session; identity is still
// backed by the legend + tooltip).
const SERIES_COLORS = [
  '#3987e5', // blue
  '#d95926', // orange
  '#199e70', // aqua
  '#c98500', // yellow
  '#d55181', // magenta
  '#3ca23c', // green (brightened from the dark-mode step for legibility on slate-950)
  '#9085e9', // violet
  '#e66767', // red
];

const WIDTH = 820;
const HEIGHT = 460;
const MARGIN = { top: 16, bottom: 28, left: 52 };
// Direct end labels need room to the right of the last point; when they're
// not shown (too many visible series), reclaim that space for the plot
// itself instead of leaving it empty.
const RIGHT_MARGIN_WITH_LABELS = 88;
const RIGHT_MARGIN_MINIMAL = 20;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const LABEL_MIN_GAP = 14;
const MAX_DIRECT_LABELS = 4;

function niceStep(rough) {
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow10;
  const step = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return step * pow10;
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const step = niceStep((max - min) / count);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

function formatNet(v) {
  const rounded = Math.round(v);
  return `${rounded >= 0 ? '+' : ''}${rounded.toLocaleString()}`;
}

export default function CumulativeNetChart({ parsed }) {
  const svgRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());

  if (!parsed || !parsed.players || !parsed.snapshots || parsed.snapshots.length === 0) {
    return <p className="text-sm text-slate-500 px-4 py-6">Chart data unavailable.</p>;
  }

  const { players, snapshots } = parsed;
  const playerIds = useMemo(() => [...players.keys()], [players]);
  const n = snapshots.length;

  // Color and nickname are assigned from the full roster so a slot never
  // shifts when a player is hidden or isolated.
  const colorById = useMemo(() => {
    const m = new Map();
    playerIds.forEach((id, idx) => m.set(id, SERIES_COLORS[idx % SERIES_COLORS.length]));
    return m;
  }, [playerIds]);
  const nicknameById = useMemo(() => {
    const m = new Map();
    for (const id of playerIds) {
      const p = players.get(id);
      m.set(id, [...p.nicknames].slice(-1)[0] || id);
    }
    return m;
  }, [playerIds, players]);

  const visibleIds = useMemo(() => playerIds.filter((id) => !hiddenIds.has(id)), [playerIds, hiddenIds]);

  const toggleHidden = (id) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isolate = (id) => setHiddenIds(new Set(playerIds.filter((pid) => pid !== id)));
  const showAll = () => setHiddenIds(new Set());

  // Rescale to whoever is currently visible, so isolating a player zooms in
  // on their range instead of leaving them flat against the full session's scale.
  const { yMin, yMax } = useMemo(() => {
    let min = 0;
    let max = 0;
    for (const s of snapshots) {
      for (const id of visibleIds) {
        const net = s.nets[id]?.net;
        if (net === undefined) continue;
        if (net < min) min = net;
        if (net > max) max = net;
      }
    }
    const pad = Math.max((max - min) * 0.1, 10);
    return { yMin: min - pad, yMax: max + pad };
  }, [snapshots, visibleIds]);

  // Only reserve the wide right margin when direct end labels will actually
  // render (few enough visible lines) - otherwise the plot extends further
  // right instead of leaving that space empty.
  const showEndLabels = visibleIds.length > 0 && visibleIds.length <= MAX_DIRECT_LABELS;
  const marginRight = showEndLabels ? RIGHT_MARGIN_WITH_LABELS : RIGHT_MARGIN_MINIMAL;
  const plotW = WIDTH - MARGIN.left - marginRight;

  const xScale = (i) => (n <= 1 ? MARGIN.left : MARGIN.left + (i / (n - 1)) * plotW);
  const yScale = (v) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin)) * PLOT_H;

  const lines = useMemo(() => {
    return visibleIds.map((id) => {
      const nickname = nicknameById.get(id);
      const color = colorById.get(id);
      const pts = [];
      snapshots.forEach((s, i) => {
        const net = s.nets[id]?.net;
        if (net === undefined) return;
        pts.push({ i, x: xScale(i), y: yScale(net), net });
      });
      const d = pts.map((pt, k) => `${k === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ');
      return { id, nickname, color, pts, d };
    });
    // xScale/yScale are pure derivations of yMin/yMax/n/plotW (already tracked below); re-listing them is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds, nicknameById, colorById, snapshots, yMin, yMax, plotW]);

  // Direct end labels only pay off with a handful of visible lines - past
  // that, converging lines just collide, so fall back to legend + tooltip.
  const endLabels = useMemo(() => {
    if (lines.length > MAX_DIRECT_LABELS) return [];
    const withEnd = lines
      .filter((l) => l.pts.length > 0)
      .map((l) => {
        const end = l.pts[l.pts.length - 1];
        return { id: l.id, nickname: l.nickname, color: l.color, net: end.net, x: end.x, endY: end.y, labelY: end.y };
      })
      .sort((a, b) => a.endY - b.endY);
    for (let i = 1; i < withEnd.length; i++) {
      const minY = withEnd[i - 1].labelY + LABEL_MIN_GAP;
      if (withEnd[i].labelY < minY) withEnd[i].labelY = minY;
    }
    return withEnd;
  }, [lines]);

  const yTicks = useMemo(() => niceTicks(yMin, yMax, 4).filter((t) => t !== 0), [yMin, yMax]);
  const xTickIndices = useMemo(() => {
    if (n <= 1) return n === 1 ? [0] : [];
    const count = Math.min(6, n);
    const idxs = new Set();
    for (let k = 0; k < count; k++) idxs.add(Math.round((k / (count - 1)) * (n - 1)));
    return [...idxs].sort((a, b) => a - b);
  }, [n]);

  const handlePointerMove = (e) => {
    if (n === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const frac = n <= 1 ? 0 : (localX - MARGIN.left) / plotW;
    const idx = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHoverIndex(idx);
  };

  if (playerIds.length === 0 || n < 2) {
    return <p className="text-sm text-slate-500 px-4 py-6">Not enough hand data yet to chart.</p>;
  }

  const hoverSnapshot = hoverIndex !== null ? snapshots[hoverIndex] : null;
  const hoverRows = hoverSnapshot
    ? visibleIds
        .map((id) => {
          const entry = hoverSnapshot.nets[id];
          if (!entry) return null;
          return { id, nickname: nicknameById.get(id), net: entry.net, color: colorById.get(id) };
        })
        .filter(Boolean)
        .sort((a, b) => b.net - a.net)
    : [];

  const zeroY = yScale(0);
  const tooltipX = hoverIndex !== null ? xScale(hoverIndex) : null;
  const tooltipOnRight = tooltipX !== null && tooltipX > WIDTH * 0.6;

  return (
    <div className="space-y-3 w-full">
      <div className="relative w-full">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto touch-none select-none"
          onPointerMove={visibleIds.length > 0 ? handlePointerMove : undefined}
          onPointerLeave={() => setHoverIndex(null)}
        >
          {/* Gridlines */}
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={MARGIN.left}
                x2={WIDTH - marginRight}
                y1={yScale(t)}
                y2={yScale(t)}
                stroke="#1e293b"
                strokeWidth="1"
              />
              <text x={MARGIN.left - 8} y={yScale(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#64748b">
                {formatNet(t)}
              </text>
            </g>
          ))}

          {/* Zero baseline */}
          <line x1={MARGIN.left} x2={WIDTH - marginRight} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth="1" />
          <text x={MARGIN.left - 8} y={zeroY} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#94a3b8">
            0
          </text>

          {/* X axis ticks */}
          {xTickIndices.map((i) => (
            <text
              key={i}
              x={xScale(i)}
              y={HEIGHT - MARGIN.bottom + 16}
              textAnchor="middle"
              fontSize="10"
              fill="#64748b"
            >
              {i === n - 1 ? 'Final' : (snapshots[i].handNumber ?? '')}
            </text>
          ))}

          {/* Player lines */}
          {lines.map((l) => (
            <path key={l.id} d={l.d} fill="none" stroke={l.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* End markers with surface ring */}
          {lines.map((l) => {
            const end = l.pts[l.pts.length - 1];
            if (!end) return null;
            return <circle key={l.id} cx={end.x} cy={end.y} r="4" fill={l.color} stroke="#020617" strokeWidth="2" />;
          })}

          {/* Direct end labels with leader lines when nudged */}
          {endLabels.map((e) => (
            <g key={e.id}>
              {Math.abs(e.labelY - e.endY) > 1 && (
                <line x1={e.x + 6} y1={e.endY} x2={e.x + 14} y2={e.labelY} stroke={e.color} strokeWidth="1" opacity="0.6" />
              )}
              <text
                x={e.x + (Math.abs(e.labelY - e.endY) > 1 ? 16 : 8)}
                y={e.labelY}
                dominantBaseline="middle"
                fontSize="10"
                fill="#cbd5e1"
              >
                {e.nickname} <tspan fill={e.net >= 0 ? '#34d399' : '#fb7185'}>{formatNet(e.net)}</tspan>
              </text>
            </g>
          ))}

          {/* Hover crosshair */}
          {tooltipX !== null && visibleIds.length > 0 && (
            <line x1={tooltipX} x2={tooltipX} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
          )}
        </svg>

        {/* Tooltip */}
        {hoverSnapshot && hoverRows.length > 0 && (
          <div
            className="absolute top-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none min-w-[140px]"
            style={{
              left: tooltipOnRight ? undefined : `${(tooltipX / WIDTH) * 100}%`,
              right: tooltipOnRight ? `${100 - (tooltipX / WIDTH) * 100}%` : undefined,
              marginLeft: tooltipOnRight ? undefined : '10px',
              marginRight: tooltipOnRight ? '10px' : undefined,
            }}
          >
            <div className="text-slate-500 mb-1">
              {hoverSnapshot.handNumber != null ? `Hand #${hoverSnapshot.handNumber}` : 'Latest'}
            </div>
            <div className="space-y-1">
              {hoverRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-slate-300">
                    <span className="inline-block w-2.5 h-0.5" style={{ backgroundColor: row.color }} />
                    {row.nickname}
                  </span>
                  <span className={`font-medium ${row.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatNet(row.net)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {visibleIds.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500 pointer-events-none">
            All players hidden - click a name below to bring one back.
          </div>
        )}
      </div>

      {/* Legend - click a chip to hide/show that player, "only" to isolate them */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 px-1">
        {playerIds.map((id) => {
          const hidden = hiddenIds.has(id);
          return (
            <span key={id} className="group flex items-center">
              <button
                type="button"
                onClick={() => toggleHidden(id)}
                aria-pressed={!hidden}
                title={hidden ? 'Show' : 'Hide'}
                className={`flex items-center gap-1.5 text-xs px-1.5 py-0.5 rounded transition-colors ${
                  hidden ? 'text-slate-600 hover:text-slate-400' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span
                  className="inline-block w-3 h-0.5"
                  style={{ backgroundColor: colorById.get(id), opacity: hidden ? 0.35 : 1 }}
                />
                <span className={hidden ? 'line-through decoration-slate-600' : ''}>{nicknameById.get(id)}</span>
              </button>
              <button
                type="button"
                onClick={() => isolate(id)}
                title={`Show only ${nicknameById.get(id)}`}
                className="text-[10px] text-slate-500 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity px-1"
              >
                only
              </button>
            </span>
          );
        })}
        {hiddenIds.size > 0 && (
          <button
            type="button"
            onClick={showAll}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-1.5 py-0.5 ml-1"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
}
