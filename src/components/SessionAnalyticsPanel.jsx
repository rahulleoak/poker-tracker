import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  Award, 
  Flame, 
  Zap, 
  Crown, 
  Target, 
  Shield, 
  Skull, 
  Sparkles, 
  BarChart2, 
  Layers, 
  Upload, 
  Eye, 
  EyeOff, 
  Crosshair, 
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { formatChips, formatFiat } from '../utils/formatters';
import { makeNameResolver } from '../utils/adminIdentity';
import { fromChartData, toChartData } from '../utils/chartData';
import { sessionApi } from '../utils/sessionApi';

const SERIES_COLORS = [
  '#38bdf8', // sky-400
  '#34d399', // emerald-400
  '#f59e0b', // amber-500
  '#f43f5e', // rose-500
  '#a855f7', // purple-500
  '#06b6d4', // cyan-500
  '#fb923c', // orange-400
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#eab308', // yellow-500
  '#6366f1', // indigo-500
  '#14b8a6', // teal-500
  '#f87171', // red-400
  '#a3e635', // lime-400
  '#67e8f9', // cyan-300
  '#c084fc', // purple-400
];

const CHART_W = 1000;
const CHART_H = 460;
const MARGIN = { top: 30, right: 30, bottom: 40, left: 60 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

function niceTicks(min, max, count = 5) {
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep || 1)));
  const norm = rawStep / mag;
  let step = mag;
  if (norm > 5) step = 10 * mag;
  else if (norm > 2) step = 5 * mag;
  else if (norm > 1) step = 2 * mag;

  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let t = start; t <= max; t += step) {
    ticks.push(t);
  }
  return ticks;
}

export default function SessionAnalyticsPanel({
  game,
  entries = [],
  players = [],
  playerLinks = [],
  globalCurrency = 'USD',
  exchangeRates = {},
  chipValue = 1,
  onAttachLog
}) {
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const [rawChartBlob, setRawChartBlob] = useState(game?.chart_data || null);
  const [loadingDbChart, setLoadingDbChart] = useState(false);
  const svgRef = useRef(null);

  // Identity Resolver mapping any session name/ID to the Master Profile display name
  const nameOf = useMemo(() => {
    return makeNameResolver(players, playerLinks);
  }, [players, playerLinks]);

  // Sync if game.chart_data updates
  useEffect(() => {
    if (game?.chart_data) {
      setRawChartBlob(game.chart_data);
    }
  }, [game?.chart_data]);

  // If chart_data wasn't passed directly on game, attempt a lightweight fetch from admin_sessions
  useEffect(() => {
    if (rawChartBlob || !game?.id) return;
    let cancelled = false;

    async function fetchChart() {
      try {
        setLoadingDbChart(true);
        const fullRow = await sessionApi.get(game.id);
        if (cancelled) return;
        if (fullRow?.chart_data) {
          setRawChartBlob(fullRow.chart_data);
        }
      } catch (err) {
        console.warn('Could not fetch chart_data for session:', err);
      } finally {
        if (!cancelled) setLoadingDbChart(false);
      }
    }

    fetchChart();
    return () => { cancelled = true; };
  }, [game?.id, rawChartBlob]);

  // Parse raw chart_data or parse entries into chart structure
  const parsedData = useMemo(() => {
    if (rawChartBlob) {
      const fromBlob = fromChartData(rawChartBlob);
      if (fromBlob && fromBlob.players?.size > 0 && fromBlob.snapshots?.length > 0) {
        // Remap player nicknames to master profile display names
        const updatedPlayers = new Map();
        for (const [id, p] of fromBlob.players) {
          const resolved = nameOf(id) || p.nicknames?.[0] || id;
          updatedPlayers.set(id, { ...p, nicknames: [resolved] });
        }
        return { players: updatedPlayers, snapshots: fromBlob.snapshots };
      }
    }
    return null;
  }, [rawChartBlob, nameOf]);

  const playerIds = useMemo(() => {
    return parsedData?.players instanceof Map ? [...parsedData.players.keys()] : [];
  }, [parsedData]);

  const snapshots = useMemo(() => {
    return Array.isArray(parsedData?.snapshots) ? parsedData.snapshots : [];
  }, [parsedData]);

  const nSnapshots = snapshots.length;

  // Map each player to a stable color and resolved profile name
  const colorById = useMemo(() => {
    const map = new Map();
    playerIds.forEach((id, idx) => {
      map.set(id, SERIES_COLORS[idx % SERIES_COLORS.length]);
    });
    return map;
  }, [playerIds]);

  const displayNameById = useMemo(() => {
    const map = new Map();
    playerIds.forEach(id => {
      const p = parsedData?.players?.get(id);
      const nick = p?.nicknames?.[0] || id;
      map.set(id, nameOf(id) || nick);
    });
    return map;
  }, [playerIds, parsedData, nameOf]);

  const visibleIds = useMemo(() => {
    return playerIds.filter(id => !hiddenIds.has(id));
  }, [playerIds, hiddenIds]);

  const toggleHidden = (id) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isolatePlayer = (id) => {
    setHiddenIds(new Set(playerIds.filter(pid => pid !== id)));
  };

  const showAllPlayers = () => {
    setHiddenIds(new Set());
  };

  // Trajectory Range Calculation
  const { yMin, yMax } = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return { yMin: 0, yMax: 0 };
    let min = 0;
    let max = 0;
    for (const s of snapshots) {
      for (const id of visibleIds) {
        const net = s.nets[id]?.net;
        if (typeof net === 'number') {
          if (net < min) min = net;
          if (net > max) max = net;
        }
      }
    }
    const padding = Math.max((max - min) * 0.12, 50);
    return { yMin: min - padding, yMax: max + padding };
  }, [snapshots, visibleIds]);

  const xScale = (i) => (nSnapshots <= 1 ? MARGIN.left : MARGIN.left + (i / (nSnapshots - 1)) * PLOT_W);
  const yScale = (v) => MARGIN.top + (1 - (v - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const chartLines = useMemo(() => {
    if (!snapshots || snapshots.length === 0) return [];
    return visibleIds.map(id => {
      const name = displayNameById.get(id) || id;
      const color = colorById.get(id) || '#38bdf8';
      const pts = [];
      snapshots.forEach((s, i) => {
        const net = s.nets[id]?.net;
        if (typeof net === 'number') {
          pts.push({ i, x: xScale(i), y: yScale(net), net, handNumber: s.handNumber });
        }
      });
      const pathD = pts.map((pt, k) => `${k === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
      return { id, name, color, pts, pathD };
    });
  }, [visibleIds, displayNameById, colorById, snapshots, yMin, yMax]);

  const yTicks = useMemo(() => niceTicks(yMin, yMax, 5).filter(t => t !== 0), [yMin, yMax]);
  const zeroY = yScale(0);

  const xTickIndices = useMemo(() => {
    if (nSnapshots <= 1) return nSnapshots === 1 ? [0] : [];
    const count = Math.min(8, nSnapshots);
    const set = new Set();
    for (let k = 0; k < count; k++) {
      set.add(Math.round((k / (count - 1)) * (nSnapshots - 1)));
    }
    return [...set].sort((a, b) => a - b);
  }, [nSnapshots]);

  const handlePointerMove = (e) => {
    if (nSnapshots === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = CHART_W / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    const frac = nSnapshots <= 1 ? 0 : (localX - MARGIN.left) / PLOT_W;
    const idx = Math.max(0, Math.min(nSnapshots - 1, Math.round(frac * (nSnapshots - 1))));
    setHoverIndex(idx);
  };

  // --- SUPERLATIVE AWARDS CALCULATION ---
  const awards = useMemo(() => {
    const list = [];
    const safeEntriesList = Array.isArray(entries) ? entries : [];

    // 1. Group stats by Player Profile
    const profileMap = new Map();

    safeEntriesList.forEach(e => {
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId || e.external_player_id) || nameOf(e.name || e.player_name) || e.name || e.player_name || 'Unknown';
      if (!profileMap.has(pName)) {
        profileMap.set(pName, {
          name: pName,
          buyIn: 0,
          buyOut: 0,
          stack: 0,
          net: 0,
          handsPlayed: 0,
          vpipHands: 0,
          pfrHands: 0,
          threeBetHands: 0,
          threeBetOpps: 0,
          peakNet: -Infinity,
          troughNet: Infinity,
          maxSwing: 0,
          biggestSingleDrop: 0
        });
      }
      const p = profileMap.get(pName);
      p.buyIn += Number(e.buyIn ?? e.buy_in ?? 0);
      p.buyOut += Number(e.buyOut ?? e.buy_out ?? 0);
      p.stack += Number(e.stack ?? e.cash_out ?? 0);
      p.net = p.buyOut + p.stack - p.buyIn;
      p.handsPlayed += Number(e.handsPlayed ?? e.hands_played ?? 0);
      p.vpipHands += Number(e.vpipHands ?? e.vpip_hands ?? 0);
      p.pfrHands += Number(e.pfrHands ?? e.pfr_hands ?? 0);
      p.threeBetHands += Number(e.threeBetHands ?? e.three_bet_hands ?? 0);
      p.threeBetOpps += Number(e.threeBetOpps ?? e.three_bet_opps ?? 0);
    });

    // If we have hand-by-hand snapshots, compute exact peak, trough, comeback, swing, and bad-beat drop
    if (snapshots && snapshots.length > 0) {
      playerIds.forEach(id => {
        const pName = displayNameById.get(id) || id;
        if (!profileMap.has(pName)) {
          profileMap.set(pName, {
            name: pName,
            buyIn: 0,
            buyOut: 0,
            stack: 0,
            net: 0,
            handsPlayed: 0,
            vpipHands: 0,
            pfrHands: 0,
            threeBetHands: 0,
            threeBetOpps: 0,
            peakNet: -Infinity,
            troughNet: Infinity,
            maxSwing: 0,
            biggestSingleDrop: 0
          });
        }
        const p = profileMap.get(pName);
        let prevNet = 0;
        let peak = -Infinity;
        let trough = Infinity;
        let maxDrop = 0;

        snapshots.forEach((s, idx) => {
          const val = s.nets[id]?.net;
          if (typeof val === 'number') {
            if (val > peak) peak = val;
            if (val < trough) trough = val;
            if (idx > 0) {
              const drop = prevNet - val;
              if (drop > maxDrop) maxDrop = drop;
            }
            prevNet = val;
          }
        });

        p.peakNet = peak === -Infinity ? p.net : peak;
        p.troughNet = trough === Infinity ? p.net : trough;
        p.maxSwing = p.peakNet - p.troughNet;
        p.biggestSingleDrop = maxDrop;
      });
    }

    const profiles = Array.from(profileMap.values()).filter(p => p.buyIn > 0 || p.handsPlayed > 0 || p.stack > 0);
    if (profiles.length === 0) return [];

    // Award 1: Apex Predator (MVP - Highest Net Profit)
    const winner = [...profiles].sort((a, b) => b.net - a.net)[0];
    if (winner && winner.net > 0) {
      list.push({
        id: 'mvp',
        title: 'Apex Predator',
        subtitle: 'Session MVP',
        icon: Crown,
        badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]',
        recipient: winner.name,
        stat: `+${formatChips(winner.net)} chips`,
        desc: 'Dominant session leader and table apex predator.'
      });
    }

    // Award 2: The Comeback Kid (Deepest trough to positive finish)
    const comebackCandidate = [...profiles]
      .filter(p => p.troughNet < -50 && p.net > 0)
      .sort((a, b) => a.troughNet - b.troughNet)[0];
    if (comebackCandidate) {
      list.push({
        id: 'comeback',
        title: 'The Comeback Kid',
        subtitle: 'Resurrection Award',
        icon: Sparkles,
        badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.25)]',
        recipient: comebackCandidate.name,
        stat: `Dug out of ${formatChips(comebackCandidate.troughNet)}`,
        desc: `Clawed back from a deep deficit to finish +${formatChips(comebackCandidate.net)}.`
      });
    }

    // Award 3: The Rollercoaster (Widest peak-to-trough swing)
    const swingCandidate = [...profiles].sort((a, b) => b.maxSwing - a.maxSwing)[0];
    if (swingCandidate && swingCandidate.maxSwing > 100) {
      list.push({
        id: 'rollercoaster',
        title: 'The Rollercoaster',
        subtitle: 'Maximum Turbulence',
        icon: Zap,
        badgeColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.25)]',
        recipient: swingCandidate.name,
        stat: `Δ ${formatChips(swingCandidate.maxSwing)} chips`,
        desc: 'Highest swing range between table peak and trough.'
      });
    }

    // Award 4: VPIP Chieftain (Highest action rate)
    const vpipCandidate = [...profiles]
      .filter(p => p.handsPlayed >= 3)
      .sort((a, b) => (b.vpipHands / b.handsPlayed) - (a.vpipHands / a.handsPlayed))[0];
    if (vpipCandidate && (vpipCandidate.vpipHands / vpipCandidate.handsPlayed) >= 0.25) {
      const vpipPct = Math.round((vpipCandidate.vpipHands / vpipCandidate.handsPlayed) * 100);
      list.push({
        id: 'vpip_king',
        title: 'VPIP Chieftain',
        subtitle: 'Action Magnet',
        icon: Flame,
        badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.25)]',
        recipient: vpipCandidate.name,
        stat: `${vpipPct}% VPIP (${vpipCandidate.vpipHands}/${vpipCandidate.handsPlayed})`,
        desc: 'Never saw a pre-flop hand they did not want to play.'
      });
    }

    // Award 5: Pre-Flop Bully (Highest PFR aggression)
    const pfrCandidate = [...profiles]
      .filter(p => p.handsPlayed >= 3)
      .sort((a, b) => (b.pfrHands / b.handsPlayed) - (a.pfrHands / a.handsPlayed))[0];
    if (pfrCandidate && (pfrCandidate.pfrHands / pfrCandidate.handsPlayed) >= 0.15) {
      const pfrPct = Math.round((pfrCandidate.pfrHands / pfrCandidate.handsPlayed) * 100);
      list.push({
        id: 'pfr_bully',
        title: 'Pre-Flop Bully',
        subtitle: 'Hyper Aggressor',
        icon: Target,
        badgeColor: 'text-purple-400 bg-purple-500/10 border-purple-500/30 shadow-[0_0_12px_rgba(168,85,247,0.25)]',
        recipient: pfrCandidate.name,
        stat: `${pfrPct}% PFR Rate`,
        desc: 'Relentless pre-flop open raiser putting maximum pressure.'
      });
    }

    // Award 6: The Rock of Gibraltar (Lowest VPIP with positive profit)
    const nitCandidate = [...profiles]
      .filter(p => p.handsPlayed >= 3 && p.net > 0)
      .sort((a, b) => (a.vpipHands / a.handsPlayed) - (b.vpipHands / b.handsPlayed))[0];
    if (nitCandidate && (nitCandidate.vpipHands / nitCandidate.handsPlayed) <= 0.35) {
      const nitPct = Math.round((nitCandidate.vpipHands / nitCandidate.handsPlayed) * 100);
      list.push({
        id: 'rock',
        title: 'Rock of Gibraltar',
        subtitle: 'Calculated Nit',
        icon: Shield,
        badgeColor: 'text-blue-400 bg-blue-500/10 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.25)]',
        recipient: nitCandidate.name,
        stat: `${nitPct}% VPIP (+${formatChips(nitCandidate.net)})`,
        desc: 'Surgical discipline: folded all night, took everyone\'s money.'
      });
    }

    // Award 7: The Whale (Highest Buy-In volume)
    const whaleCandidate = [...profiles].sort((a, b) => b.buyIn - a.buyIn)[0];
    if (whaleCandidate && whaleCandidate.buyIn > 0 && profiles.length > 1) {
      list.push({
        id: 'whale',
        title: 'Table Sponsor',
        subtitle: 'The Whale',
        icon: Award,
        badgeColor: 'text-amber-300 bg-amber-400/10 border-amber-400/30',
        recipient: whaleCandidate.name,
        stat: `${formatChips(whaleCandidate.buyIn)} Buy-In`,
        desc: 'Funded the session bankroll with the largest buy-in volume.'
      });
    }

    // Award 8: Cooler Magnet (Largest single hand drop)
    const coolerCandidate = [...profiles].sort((a, b) => b.biggestSingleDrop - a.biggestSingleDrop)[0];
    if (coolerCandidate && coolerCandidate.biggestSingleDrop > 150) {
      list.push({
        id: 'cooler',
        title: 'Cooler Magnet',
        subtitle: 'Bad Beat Target',
        icon: Skull,
        badgeColor: 'text-zinc-400 bg-zinc-800/80 border-zinc-700',
        recipient: coolerCandidate.name,
        stat: `-${formatChips(coolerCandidate.biggestSingleDrop)} single drop`,
        desc: 'Suffered the single largest one-hand stack demolition.'
      });
    }

    return list;
  }, [entries, snapshots, playerIds, displayNameById, nameOf]);

  // Playstyle Matrix Analysis (VPIP vs PFR)
  const playstyleMatrix = useMemo(() => {
    const safeEntriesList = Array.isArray(entries) ? entries : [];
    const profileMap = new Map();

    safeEntriesList.forEach(e => {
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId || e.external_player_id) || nameOf(e.name || e.player_name) || e.name || e.player_name || 'Unknown';
      if (!profileMap.has(pName)) {
        profileMap.set(pName, {
          name: pName,
          handsPlayed: 0,
          vpipHands: 0,
          pfrHands: 0,
          net: 0
        });
      }
      const p = profileMap.get(pName);
      p.handsPlayed += Number(e.handsPlayed ?? e.hands_played ?? 0);
      p.vpipHands += Number(e.vpipHands ?? e.vpip_hands ?? 0);
      p.pfrHands += Number(e.pfrHands ?? e.pfr_hands ?? 0);
      p.net += (Number(e.buyOut ?? e.buy_out ?? 0)) + (Number(e.stack ?? e.cash_out ?? 0)) - (Number(e.buyIn ?? e.buy_in ?? 0));
    });

    return Array.from(profileMap.values())
      .filter(p => p.handsPlayed >= 3)
      .map(p => {
        const vpip = Math.min(100, Math.round((p.vpipHands / p.handsPlayed) * 100));
        const pfr = Math.min(100, Math.round((p.pfrHands / p.handsPlayed) * 100));
        let style = 'TAG';
        if (vpip > 45 && pfr > 30) style = 'Maniac';
        else if (vpip > 35 && pfr <= 15) style = 'Calling Station';
        else if (vpip > 28 && pfr > 18) style = 'LAG';
        else if (vpip < 20 && pfr < 15) style = 'Nit';

        return {
          name: p.name,
          vpip,
          pfr,
          hands: p.handsPlayed,
          net: p.net,
          style
        };
      });
  }, [entries, nameOf]);

  // Chip Distribution Summary
  const chipDistribution = useMemo(() => {
    const safeEntriesList = Array.isArray(entries) ? entries : [];
    const totalStack = safeEntriesList.reduce((sum, e) => sum + (Number(e.stack ?? e.cash_out ?? 0)), 0);
    if (totalStack === 0) return [];

    const map = new Map();
    safeEntriesList.forEach(e => {
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId || e.external_player_id) || nameOf(e.name || e.player_name) || e.name || e.player_name || 'Unknown';
      map.set(pName, (map.get(pName) || 0) + (Number(e.stack ?? e.cash_out ?? 0)));
    });

    return Array.from(map.entries())
      .map(([name, stack], idx) => ({
        name,
        stack,
        percentage: Math.round((stack / totalStack) * 1000) / 10,
        color: SERIES_COLORS[idx % SERIES_COLORS.length]
      }))
      .sort((a, b) => b.stack - a.stack);
  }, [entries, nameOf]);

  const hoverSnapshot = hoverIndex !== null && snapshots ? snapshots[hoverIndex] : null;
  const hoverRows = hoverSnapshot
    ? visibleIds
        .map(id => {
          const entry = hoverSnapshot.nets[id];
          if (!entry) return null;
          return {
            id,
            name: displayNameById.get(id) || id,
            net: entry.net,
            color: colorById.get(id)
          };
        })
        .filter(Boolean)
        .sort((a, b) => b.net - a.net)
    : [];

  return (
    <div className="space-y-6 font-sans">
      {/* SECTION 1: Superlative Accolades & Badges */}
      {awards.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              <h4 className="font-bold text-white uppercase tracking-wider text-xs font-mono">
                Nightly Superlatives & Badges
              </h4>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              {awards.length} Badges Awarded
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {awards.map(award => {
              const Icon = award.icon;
              return (
                <div 
                  key={award.id}
                  className="bg-black/60 border border-white/10 p-3.5 flex flex-col justify-between space-y-2 hover:border-white/25 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                        {award.subtitle}
                      </span>
                      <h5 className="font-bold text-sm text-zinc-100 font-sans group-hover:text-amber-300 transition-colors">
                        {award.title}
                      </h5>
                    </div>
                    <div className={`p-1.5 border shrink-0 ${award.badgeColor}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white truncate font-sans">
                        {award.recipient}
                      </span>
                      <span className="text-[11px] font-mono font-bold text-amber-400 shrink-0">
                        {award.stat}
                      </span>
                    </div>
                    <p className="text-[10px] text-zinc-400 font-mono line-clamp-2">
                      {award.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 2: Interactive SVG Multi-Series Trajectory Line Graph */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 shadow-2xl backdrop-blur-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-cyan-400" />
            <h4 className="font-bold text-white uppercase tracking-wider text-sm font-mono">
              Player Chip Trajectory Over Time
            </h4>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            {playerIds.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={showAllPlayers}
                  className="px-2.5 py-1 bg-black/60 hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white transition-all text-[11px]"
                >
                  Show All ({playerIds.length})
                </button>
                <span className="text-zinc-600">|</span>
              </>
            )}
            <span className="text-zinc-400 text-[11px]">
              {nSnapshots > 0 ? `${nSnapshots} Hands Charted` : 'No Timeline Data'}
            </span>
          </div>
        </div>

        {/* Player Filters Bar */}
        {playerIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 bg-black/60 border border-white/10 p-2 text-xs font-mono">
            <span className="text-zinc-500 uppercase tracking-widest text-[10px] mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Filter:
            </span>
            {playerIds.map(id => {
              const name = displayNameById.get(id) || id;
              const color = colorById.get(id) || '#38bdf8';
              const isHidden = hiddenIds.has(id);

              return (
                <div
                  key={id}
                  className={`flex items-center gap-1 px-2 py-0.5 border text-[11px] transition-all ${
                    isHidden
                      ? 'bg-zinc-950/60 border-white/5 text-zinc-600 line-through'
                      : 'bg-zinc-900 border-white/20 text-zinc-200 shadow-sm'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleHidden(id)}
                    className="flex items-center gap-1.5 hover:text-white transition-colors"
                  >
                    <span 
                      className="w-2 h-2 rounded-full inline-block shrink-0" 
                      style={{ backgroundColor: isHidden ? '#52525b' : color }} 
                    />
                    <span className="truncate max-w-[120px]">{name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => isolatePlayer(id)}
                    className="text-[9px] uppercase tracking-wider text-cyan-400/80 hover:text-cyan-300 ml-1 pl-1 border-l border-white/10"
                    title={`Isolate ${name}`}
                  >
                    only
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* SVG Chart Area */}
        {nSnapshots > 0 ? (
          <div className="relative overflow-hidden bg-black/80 border border-white/10 p-2 sm:p-4">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CHART_W} ${CHART_H}`}
              className="w-full h-auto select-none cursor-crosshair"
              onPointerMove={handlePointerMove}
              onPointerLeave={() => setHoverIndex(null)}
            >
              {/* Grid Lines */}
              {yTicks.map(val => {
                const y = yScale(val);
                return (
                  <g key={`ytick-${val}`}>
                    <line
                      x1={MARGIN.left}
                      x2={CHART_W - MARGIN.right}
                      y1={y}
                      y2={y}
                      stroke="rgba(255, 255, 255, 0.07)"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      fill="#71717a"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {val > 0 ? `+${val}` : val}
                    </text>
                  </g>
                );
              })}

              {/* Zero Equilibrium Line */}
              <line
                x1={MARGIN.left}
                x2={CHART_W - MARGIN.right}
                y1={zeroY}
                y2={zeroY}
                stroke="#06b6d4"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.6"
              />
              <text
                x={MARGIN.left - 8}
                y={zeroY + 3.5}
                textAnchor="end"
                fill="#06b6d4"
                fontSize="10"
                fontWeight="bold"
                fontFamily="monospace"
              >
                0
              </text>

              {/* Hand Axis Ticks */}
              {xTickIndices.map(idx => {
                const x = xScale(idx);
                const handNum = snapshots[idx]?.handNumber;
                return (
                  <g key={`xtick-${idx}`}>
                    <line
                      x1={x}
                      x2={x}
                      y1={MARGIN.top}
                      y2={CHART_H - MARGIN.bottom}
                      stroke="rgba(255, 255, 255, 0.05)"
                      strokeDasharray="2 2"
                    />
                    <text
                      x={x}
                      y={CHART_H - MARGIN.bottom + 16}
                      textAnchor="middle"
                      fill="#71717a"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {handNum !== null ? `#${handNum}` : `H${idx + 1}`}
                    </text>
                  </g>
                );
              })}

              {/* Trajectory Series Polylines */}
              {chartLines.map(line => (
                <path
                  key={line.id}
                  d={line.pathD}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-opacity duration-150"
                  opacity={hoverIndex !== null ? 0.85 : 1}
                />
              ))}

              {/* Hover Crosshair & Anchor Dots */}
              {hoverIndex !== null && (
                <>
                  <line
                    x1={xScale(hoverIndex)}
                    x2={xScale(hoverIndex)}
                    y1={MARGIN.top}
                    y2={CHART_H - MARGIN.bottom}
                    stroke="rgba(255, 255, 255, 0.4)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  {chartLines.map(line => {
                    const pt = line.pts[hoverIndex];
                    if (!pt) return null;
                    return (
                      <circle
                        key={`dot-${line.id}`}
                        cx={pt.x}
                        cy={pt.y}
                        r="4"
                        fill={line.color}
                        stroke="#000"
                        strokeWidth="1.5"
                      />
                    );
                  })}
                </>
              )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoverSnapshot && hoverRows.length > 0 && (
              <div 
                className="absolute top-4 right-4 bg-zinc-950/95 border border-white/20 p-3 shadow-2xl backdrop-blur-md pointer-events-none text-xs font-mono max-w-xs space-y-2 z-10"
              >
                <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                  <span className="font-bold text-white">
                    {hoverSnapshot.handNumber !== null ? `Hand #${hoverSnapshot.handNumber}` : `Hand Index ${hoverIndex + 1}`}
                  </span>
                  {hoverSnapshot.timestamp && (
                    <span className="text-[10px] text-zinc-500">
                      {new Date(hoverSnapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                  {hoverRows.map(row => (
                    <div key={row.id} className="flex items-center justify-between gap-3 text-[11px]">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: row.color }} />
                        <span className="text-zinc-300 truncate">{row.name}</span>
                      </div>
                      <span className={`font-bold tabular-nums shrink-0 ${row.net > 0 ? 'text-emerald-400' : row.net < 0 ? 'text-rose-400' : 'text-zinc-500'}`}>
                        {row.net > 0 ? `+${formatChips(row.net)}` : formatChips(row.net)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-black/60 border border-white/10 p-8 text-center space-y-4 font-mono">
            <div className="max-w-md mx-auto space-y-2">
              <BarChart2 className="w-8 h-8 text-zinc-600 mx-auto" />
              <h5 className="font-bold text-zinc-300 text-sm">No Hand Log Attached</h5>
              <p className="text-xs text-zinc-500">
                To unlock hand-by-hand chip trajectory graphs, comeback badges, and bad beat metrics, attach a PokerNow game log CSV.
              </p>
            </div>

            {onAttachLog && (
              <label className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-cyan-500/40 text-cyan-400 hover:text-cyan-300 font-bold text-xs uppercase tracking-wider cursor-pointer transition-all shadow-[0_0_10px_rgba(6,182,212,0.2)]">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={onAttachLog} 
                  className="hidden" 
                />
                <Upload className="w-3.5 h-3.5" />
                <span>Upload PokerNow Log CSV</span>
              </label>
            )}
          </div>
        )}
      </div>

      {/* SECTION 3: Playstyle Matrix & Ending Chip Dominance Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Playstyle Matrix (VPIP vs PFR) */}
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 shadow-2xl backdrop-blur-xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-purple-400" />
              <h4 className="font-bold text-white uppercase tracking-wider text-xs font-mono">
                Player Archetypes & Playstyle Matrix
              </h4>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              VPIP vs PFR
            </span>
          </div>

          {playstyleMatrix.length > 0 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {playstyleMatrix.map(p => (
                  <div 
                    key={p.name}
                    className="bg-black/60 border border-white/10 p-2.5 flex items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div>
                      <span className="font-bold text-zinc-200 block truncate max-w-[140px]">{p.name}</span>
                      <span className="text-[10px] text-zinc-500">
                        {p.vpip}% VPIP · {p.pfr}% PFR ({p.hands} hands)
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 border text-[10px] uppercase font-bold tracking-wider ${
                      p.style === 'TAG' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
                      p.style === 'LAG' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' :
                      p.style === 'Maniac' ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' :
                      p.style === 'Calling Station' ? 'bg-purple-500/10 border-purple-500/30 text-purple-400' :
                      'bg-blue-500/10 border-blue-500/30 text-blue-400'
                    }`}>
                      {p.style}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-xs font-mono text-zinc-500 bg-black/40 border border-white/5">
              No pre-flop action data available for this session.
            </div>
          )}
        </div>

        {/* Final Table Chip Dominance */}
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 shadow-2xl backdrop-blur-xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h4 className="font-bold text-white uppercase tracking-wider text-xs font-mono">
                Ending Table Chip Dominance
              </h4>
            </div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
              Stack Distribution
            </span>
          </div>

          {chipDistribution.length > 0 ? (
            <div className="space-y-3">
              {/* Stacked Percentage Bar */}
              <div className="h-3 w-full bg-black/80 flex overflow-hidden border border-white/10">
                {chipDistribution.map(item => (
                  <div
                    key={item.name}
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                    className="h-full transition-all duration-300 relative group"
                    title={`${item.name}: ${item.percentage}% (${formatChips(item.stack)})`}
                  />
                ))}
              </div>

              {/* Legend List */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {chipDistribution.map(item => (
                  <div key={item.name} className="flex items-center justify-between bg-black/40 border border-white/5 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-zinc-300 truncate text-[11px]">{item.name}</span>
                    </div>
                    <span className="text-zinc-400 font-bold text-[11px] tabular-nums shrink-0">
                      {item.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-xs font-mono text-zinc-500 bg-black/40 border border-white/5">
              No ending stacks recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
