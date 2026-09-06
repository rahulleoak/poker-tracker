// Serialiser + adapter for the render-ready cumulative-net blob stored on
// `admin_sessions.chart_data`. See design/admin-session.md ("bare minimum to
// show the Cumulative graph").
//
//   toChartData(parsed)   parseHandLog output  ->  compact storable shape
//   fromChartData(blob)   storable shape       ->  the { players: Map, snapshots }
//                                                  shape CumulativeNetChart wants
//
// Shape:
//   {
//     players:    [ { playerId: string|null, nickname: string } ],  // column order = draw/colour order
//     hands:      [ number|null ],                                   // x tick + tooltip label per snapshot
//     timestamps: [ string ],                                        // kept so the CSV download stays whole
//     nets:       [ [ number|null ] ]                                // nets[snapshotIdx][playerIdx]
//   }

const lastNickname = (nicknames, fallback) => {
  if (!nicknames) return fallback;
  const arr = Array.isArray(nicknames) ? nicknames : [...nicknames];
  return arr[arr.length - 1] || fallback;
};

/**
 * @param {{ players: Map<string, {nicknames: Set<string>|string[]}>, snapshots: Array<{handNumber: number|null, timestamp: string, nets: Record<string, {net: number}>}> }} parsed
 * @param {(mapKey: string) => (string|null)} [playerIdOf] - resolve a parsed player-map key to a master profile id (Stage 2); defaults to none
 * @returns {{ players: Array<{playerId: string|null, nickname: string}>, hands: Array<number|null>, timestamps: string[], nets: Array<Array<number|null>> }}
 */
export function toChartData(parsed, playerIdOf = () => null) {
  const players = parsed?.players;
  const snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
  if (!(players instanceof Map) || players.size === 0) {
    return { players: [], hands: [], timestamps: [], nets: [] };
  }

  const ids = [...players.keys()];
  const playerDefs = ids.map((id) => ({
    playerId: playerIdOf(id) || null,
    nickname: lastNickname(players.get(id)?.nicknames, id),
  }));

  const hands = snapshots.map((s) => (s?.handNumber ?? null));
  const timestamps = snapshots.map((s) => s?.timestamp ?? '');
  const nets = snapshots.map((s) =>
    ids.map((id) => {
      const entry = s?.nets ? s.nets[id] : undefined;
      return entry && typeof entry.net === 'number' ? entry.net : null;
    })
  );

  return { players: playerDefs, hands, timestamps, nets };
}

/**
 * Rebuild the { players: Map, snapshots } shape CumulativeNetChart /
 * toPerPlayerSeries consume. A missing `net` (null) means the player wasn't in
 * that snapshot; the chart skips those points.
 *
 * @param {{ players?: Array<{playerId: string|null, nickname: string}>, hands?: Array<number|null>, timestamps?: string[], nets?: Array<Array<number|null>> }} chartData
 * @returns {{ players: Map<string, object>, snapshots: Array<object> }}
 */
export function fromChartData(chartData) {
  const cd = chartData || {};
  const playerDefs = Array.isArray(cd.players) ? cd.players : [];
  const hands = Array.isArray(cd.hands) ? cd.hands : [];
  const timestamps = Array.isArray(cd.timestamps) ? cd.timestamps : [];
  const netRows = Array.isArray(cd.nets) ? cd.nets : [];

  // Stable per-column id: the resolved playerId when present, else a synthetic
  // key derived from the nickname / column index so the Map stays keyed.
  const ids = playerDefs.map(
    (p, i) => p?.playerId || `col:${i}:${(p?.nickname || '').toLowerCase()}`
  );

  const players = new Map();
  playerDefs.forEach((p, i) => {
    players.set(ids[i], {
      nicknames: [p?.nickname || ids[i]],
      currentStack: 0,
      active: false,
      buyIn: 0,
      cashOut: 0,
    });
  });

  const snapshots = netRows.map((row, si) => {
    const nets = {};
    ids.forEach((id, pi) => {
      const v = Array.isArray(row) ? row[pi] : undefined;
      if (v === null || v === undefined) return;
      nets[id] = { nickname: playerDefs[pi]?.nickname || id, net: v };
    });
    return {
      handNumber: hands[si] ?? null,
      timestamp: timestamps[si] ?? '',
      nets,
    };
  });

  return { players, snapshots };
}
