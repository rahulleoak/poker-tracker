import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Crown, 
  Award, 
  Zap, 
  Shield, 
  Flame, 
  Compass, 
  Activity, 
  BarChart3, 
  Sparkles, 
  Upload, 
  RefreshCw,
  Info,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  Skull
} from 'lucide-react';
import { fromChartData, toChartData } from '../utils/chartData';
import { 
  parseCumulativeNet, 
  groupCumulativeNet, 
  reconcileCumulativeNet 
} from '../utils/pokernow-utils/parseHandLog';
import { sessionApi } from '../utils/sessionApi';
import { makeNameResolver } from '../utils/adminIdentity';
import { formatChips, formatFiat } from '../utils/formatters';

const SERIES_COLORS = [
  '#38bdf8', // sky/blue
  '#f97316', // orange
  '#34d399', // emerald/aqua
  '#fbbf24', // amber/yellow
  '#ec4899', // pink/magenta
  '#a855f7', // purple/violet
  '#22d3ee', // cyan
  '#f43f5e', // rose/red
  '#10b981', // green
  '#eab308'  // lime/yellow
];

const CHART_W = 900;
const CHART_H = 420;
const MARGIN = { top: 20, right: 30, bottom: 35, left: 60 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

function niceStep(rough) {
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1, rough))));
  const frac = rough / pow10;
  const step = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
  return step * pow10;
}

function niceTicks(min, max, count = 5) {
  if (min === max) return [min];
  const step = niceStep((max - min) / count);
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max; v += step) {
    ticks.push(Math.round(v * 100) / 100);
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
  const [loadingDbChart, setLoadingDbChart] = useState(false);
  const [rawChartBlob, setRawChartBlob] = useState(game?.chart_data || null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [selectedMetricView, setSelectedMetricView] = useState('trajectory'); // 'trajectory' | 'playstyle' | 'distribution'
  const svgRef = useRef(null);

  // Identity Resolver: Maps any playerId or seat alias to the Master Player Profile name
  const nameOf = useMemo(() => makeNameResolver(players, playerLinks), [players, playerLinks]);

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
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId) || nameOf(e.name) || e.name || 'Unknown';
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
      p.buyIn += Number(e.buyIn) || 0;
      p.buyOut += Number(e.buyOut) || 0;
      p.stack += Number(e.stack) || 0;
      p.net = p.buyOut + p.stack - p.buyIn;
      p.handsPlayed += Number(e.handsPlayed) || 0;
      p.vpipHands += Number(e.vpipHands) || 0;
      p.pfrHands += Number(e.pfrHands) || 0;
      p.threeBetHands += Number(e.threeBetHands) || 0;
      p.threeBetOpps += Number(e.threeBetOpps) || 0;
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
      .filter(p => p.handsPlayed >= 10)
      .sort((a, b) => (b.vpipHands / b.handsPlayed) - (a.vpipHands / a.handsPlayed))[0];
    if (vpipCandidate && (vpipCandidate.vpipHands / vpipCandidate.handsPlayed) > 0.35) {
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
      .filter(p => p.handsPlayed >= 10)
      .sort((a, b) => (b.pfrHands / b.handsPlayed) - (a.pfrHands / a.handsPlayed))[0];
    if (pfrCandidate && (pfrCandidate.pfrHands / pfrCandidate.handsPlayed) > 0.2) {
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
      .filter(p => p.handsPlayed >= 10 && p.net > 0)
      .sort((a, b) => (a.vpipHands / a.handsPlayed) - (b.vpipHands / b.handsPlayed))[0];
    if (nitCandidate && (nitCandidate.vpipHands / nitCandidate.handsPlayed) < 0.25) {
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

  // Playstyle Matrix Points (VPIP vs PFR)
  const playstylePoints = useMemo(() => {
    const safeEntriesList = Array.isArray(entries) ? entries : [];
    const profileMap = new Map();

    safeEntriesList.forEach(e => {
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId) || nameOf(e.name) || e.name || 'Unknown';
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
      p.handsPlayed += Number(e.handsPlayed) || 0;
      p.vpipHands += Number(e.vpipHands) || 0;
      p.pfrHands += Number(e.pfrHands) || 0;
      p.net += (Number(e.buyOut) || 0) + (Number(e.stack) || 0) - (Number(e.buyIn) || 0);
    });

    return Array.from(profileMap.values())
      .filter(p => p.handsPlayed >= 5)
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
    const totalStack = safeEntriesList.reduce((sum, e) => sum + (Number(e.stack) || 0), 0);
    if (totalStack === 0) return [];

    const map = new Map();
    safeEntriesList.forEach(e => {
      const pName = nameOf(e.playerId) || nameOf(e.externalId || e.pokerNowId) || nameOf(e.name) || e.name || 'Unknown';
      map.set(pName, (map.get(pName) || 0) + (Number(e.stack) || 0));
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

  const tooltipX = hoverIndex !== null ? xScale(hoverIndex) : null;
  const tooltipOnRight = tooltipX !== null && tooltipX > CHART_W * 0.6;

  return (
    <div className="space-y-6">
      {/* Top Sub-Nav & Metric Filter */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-black/60 p-4 border border-white/10">
        <div>
          <h2 className="text-base font-bold font-mono uppercase tracking-wider text-white flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            Session Analytics & Pulse
          </h2>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Real-time hand trajectory, playstyle quadrant, and nightly poker accolades.
          </p>
        </div>

        <div className="flex bg-black/80 border border-white/10 p-0.5 text-xs font-mono">
          <button
            type="button"
            onClick={() => setSelectedMetricView('trajectory')}
            className={`px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
              selectedMetricView === 'trajectory'
                ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Chip Trajectory</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMetricView('playstyle')}
            className={`px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
              selectedMetricView === 'playstyle'
                ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Playstyle Matrix</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedMetricView('distribution')}
            className={`px-3 py-1.5 font-bold transition-all flex items-center gap-1.5 ${
              selectedMetricView === 'distribution'
                ? 'bg-zinc-800 text-amber-400 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Chip Share</span>
          </button>
        </div>
      </div>

      {/* Accolades Showcase Carousel / Grid */}
      {awards.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-zinc-300">
              Nightly Session Accolades & Badges
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {awards.map((award) => {
              const IconComponent = award.icon;
              return (
                <div 
                  key={award.id}
                  className="bg-hud-card/90 border border-white/10 p-3.5 flex flex-col justify-between space-y-2 hover:border-white/20 transition-all group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">
                        {award.subtitle}
                      </span>
                      <h4 className="text-sm font-bold font-mono text-white group-hover:text-cyan-300 transition-colors">
                        {award.title}
                      </h4>
                    </div>
                    <div className={`p-2 border ${award.badgeColor}`}>
                      <IconComponent className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-white/5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-sans font-bold text-zinc-200">
                        {award.recipient}
                      </span>
                      <span className="text-xs font-mono font-bold text-amber-400">
                        {award.stat}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500 font-mono leading-tight">
                      {award.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 1: Interactive Trajectory Graph */}
      {selectedMetricView === 'trajectory' && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Hand-by-Hand Cumulative Chip Flow
              </h3>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                {snapshots.length > 0 
                  ? `Tracking ${playerIds.length} player profiles across ${snapshots.length} table hands.`
                  : 'Cumulative chip tracking requires a PokerNow Hand History log.'}
              </p>
            </div>

            {snapshots.length > 0 && (
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="text-zinc-500">Visible Profiles:</span>
                <span className="text-cyan-400 font-bold">{visibleIds.length}/{playerIds.length}</span>
                {hiddenIds.size > 0 && (
                  <button
                    type="button"
                    onClick={showAllPlayers}
                    className="text-xs text-emerald-400 hover:text-emerald-300 ml-2 underline underline-offset-2"
                  >
                    Reset Filter
                  </button>
                )}
              </div>
            )}
          </div>

          {loadingDbChart ? (
            <div className="py-20 flex flex-col items-center justify-center space-y-3 text-zinc-400 font-mono text-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Loading session chart telemetry...</span>
            </div>
          ) : snapshots.length > 0 ? (
            <div className="space-y-4">
              <div className="relative w-full overflow-hidden bg-black/40 border border-white/5 p-2">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  className="w-full h-auto touch-none select-none"
                  onPointerMove={visibleIds.length > 0 ? handlePointerMove : undefined}
                  onPointerLeave={() => setHoverIndex(null)}
                >
                  {/* Gridlines */}
                  {yTicks.map(t => (
                    <g key={t}>
                      <line
                        x1={MARGIN.left}
                        x2={CHART_W - MARGIN.right}
                        y1={yScale(t)}
                        y2={yScale(t)}
                        stroke="#27272a"
                        strokeWidth="1"
                        strokeDasharray="2 2"
                      />
                      <text
                        x={MARGIN.left - 10}
                        y={yScale(t)}
                        textAnchor="end"
                        dominantBaseline="middle"
                        fontSize="10"
                        fontFamily="monospace"
                        fill="#71717a"
                      >
                        {t > 0 ? `+${t}` : t}
                      </text>
                    </g>
                  ))}

                  {/* Zero Baseline */}
                  <line
                    x1={MARGIN.left}
                    x2={CHART_W - MARGIN.right}
                    y1={zeroY}
                    y2={zeroY}
                    stroke="#52525b"
                    strokeWidth="1.5"
                  />
                  <text
                    x={MARGIN.left - 10}
                    y={zeroY}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fontSize="10"
                    fontFamily="monospace"
                    fontWeight="bold"
                    fill="#a1a1aa"
                  >
                    0
                  </text>

                  {/* X Axis Hand Marks */}
                  {xTickIndices.map(i => (
                    <text
                      key={i}
                      x={xScale(i)}
                      y={CHART_H - MARGIN.bottom + 18}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="monospace"
                      fill="#71717a"
                    >
                      {i === nSnapshots - 1 ? 'Final' : `H#${snapshots[i].handNumber ?? i}`}
                    </text>
                  ))}

                  {/* Player Paths */}
                  {chartLines.map(line => (
                    <path
                      key={line.id}
                      d={line.pathD}
                      fill="none"
                      stroke={line.color}
                      strokeWidth="2.5"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      className="transition-all duration-150"
                    />
                  ))}

                  {/* End Dot Markers */}
                  {chartLines.map(line => {
                    const endPt = line.pts[line.pts.length - 1];
                    if (!endPt) return null;
                    return (
                      <circle
                        key={line.id}
                        cx={endPt.x}
                        cy={endPt.y}
                        r="4.5"
                        fill={line.color}
                        stroke="#09090b"
                        strokeWidth="2"
                      />
                    );
                  })}

                  {/* Hover Crosshair */}
                  {tooltipX !== null && visibleIds.length > 0 && (
                    <line
                      x1={tooltipX}
                      x2={tooltipX}
                      y1={MARGIN.top}
                      y2={CHART_H - MARGIN.bottom}
                      stroke="#06b6d4"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                  )}
                </svg>

                {/* Tooltip Overlay */}
                {hoverSnapshot && hoverRows.length > 0 && (
                  <div
                    className="absolute top-4 bg-zinc-950/95 border border-cyan-500/40 p-3 shadow-2xl pointer-events-none min-w-[170px] backdrop-blur-md"
                    style={{
                      left: tooltipOnRight ? undefined : `${(tooltipX / CHART_W) * 100}%`,
                      right: tooltipOnRight ? `${100 - (tooltipX / CHART_W) * 100}%` : undefined,
                      marginLeft: tooltipOnRight ? undefined : '12px',
                      marginRight: tooltipOnRight ? '12px' : undefined,
                    }}
                  >
                    <div className="text-zinc-400 font-mono text-[11px] pb-1.5 border-b border-white/10 flex items-center justify-between">
                      <span className="font-bold text-cyan-300">
                        {hoverSnapshot.handNumber != null ? `Hand #${hoverSnapshot.handNumber}` : 'Final'}
                      </span>
                      {hoverSnapshot.timestamp && (
                        <span className="text-[9px] text-zinc-500">
                          {new Date(hoverSnapshot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1.5 mt-2">
                      {hoverRows.map(row => (
                        <div key={row.id} className="flex items-center justify-between gap-3 text-xs font-mono">
                          <span className="flex items-center gap-1.5 text-zinc-200 truncate max-w-[110px]">
                            <span className="inline-block w-2.5 h-1 shrink-0" style={{ backgroundColor: row.color }} />
                            <span className="truncate">{row.name}</span>
                          </span>
                          <span className={`font-bold tabular-nums ${row.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {row.net >= 0 ? `+${formatChips(row.net)}` : formatChips(row.net)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Legend & Player Filters */}
              <div className="flex flex-wrap items-center gap-2 p-3 bg-black/50 border border-white/5">
                {playerIds.map(id => {
                  const hidden = hiddenIds.has(id);
                  const color = colorById.get(id);
                  const name = displayNameById.get(id) || id;

                  return (
                    <div key={id} className="flex items-center bg-zinc-900 border border-white/10 px-2 py-1 text-xs font-mono">
                      <button
                        type="button"
                        onClick={() => toggleHidden(id)}
                        className="flex items-center gap-1.5 text-zinc-300 hover:text-white transition-colors"
                        title={hidden ? 'Show player on chart' : 'Hide player from chart'}
                      >
                        <span
                          className="w-2.5 h-2.5 shrink-0"
                          style={{ backgroundColor: color, opacity: hidden ? 0.3 : 1 }}
                        />
                        <span className={hidden ? 'line-through text-zinc-600' : ''}>
                          {name}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => isolatePlayer(id)}
                        className="text-[10px] uppercase font-bold text-zinc-500 hover:text-cyan-400 ml-2 pl-1.5 border-l border-white/10"
                        title={`Isolate ${name}`}
                      >
                        only
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-12 px-4 border border-dashed border-white/15 bg-black/40 flex flex-col items-center justify-center text-center space-y-3">
              <div className="p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Upload className="w-6 h-6" />
              </div>
              <div className="space-y-1 max-w-md">
                <h4 className="text-sm font-bold font-mono text-white uppercase">
                  Hand-by-Hand Log Not Attached
                </h4>
                <p className="text-xs text-zinc-400 font-mono">
                  Upload the full PokerNow game log CSV to generate the real-time chip movement timeline, single-hand drop metrics, and comeback charts.
                </p>
              </div>
              {onAttachLog && (
                <label className="px-4 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-300 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer transition-all flex items-center gap-2">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={onAttachLog}
                    className="hidden"
                  />
                  <Upload className="w-3.5 h-3.5" /> Attach Log CSV
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: Playstyle Matrix (VPIP vs PFR) */}
      {selectedMetricView === 'playstyle' && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="border-b border-white/10 pb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-400" />
                Player Archetype Matrix (VPIP vs. PFR)
              </h3>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Classifies each player into tactical quadrants based on action voluntary participation (VPIP%) and pre-flop aggression (PFR%).
              </p>
            </div>
          </div>

          {playstylePoints.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Quadrant Visual Map */}
              <div className="lg:col-span-2 relative bg-black/60 border border-white/10 aspect-[4/3] p-6 flex flex-col justify-between font-mono text-xs">
                {/* Quadrant Background Zones */}
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 pointer-events-none opacity-20">
                  <div className="border-r border-b border-cyan-500/40 bg-cyan-950/20 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-cyan-400 font-bold uppercase">🦈 TAG (Tight-Aggressive)</span>
                  </div>
                  <div className="border-b border-purple-500/40 bg-purple-950/20 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-purple-400 font-bold uppercase">⚡ LAG / Maniac</span>
                  </div>
                  <div className="border-r border-blue-500/40 bg-blue-950/20 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-blue-400 font-bold uppercase">🪨 Nit / Rock</span>
                  </div>
                  <div className="border-rose-500/40 bg-rose-950/20 p-2 flex flex-col justify-between">
                    <span className="text-[10px] text-rose-400 font-bold uppercase">🐟 Calling Station</span>
                  </div>
                </div>

                {/* Scatter Dots */}
                <div className="absolute inset-8 relative">
                  {playstylePoints.map((pt, i) => {
                    const xPct = Math.max(5, Math.min(95, pt.vpip));
                    const yPct = Math.max(5, Math.min(95, 100 - pt.pfr * 1.5));
                    const color = SERIES_COLORS[i % SERIES_COLORS.length];

                    return (
                      <div
                        key={pt.name}
                        className="absolute group -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                        style={{ left: `${xPct}%`, top: `${yPct}%` }}
                      >
                        <div 
                          className="w-4 h-4 rounded-full border-2 border-black flex items-center justify-center shadow-lg transition-transform group-hover:scale-150"
                          style={{ backgroundColor: color }}
                        />
                        <div className="absolute left-1/2 -translate-x-1/2 top-5 hidden group-hover:block z-30 bg-zinc-950 border border-white/20 p-2 text-center whitespace-nowrap shadow-2xl backdrop-blur-md">
                          <p className="font-bold text-white font-sans text-xs">{pt.name}</p>
                          <p className="text-[10px] text-zinc-400 font-mono">
                            VPIP: {pt.vpip}% | PFR: {pt.pfr}%
                          </p>
                          <p className={`text-[10px] font-mono font-bold ${pt.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {pt.net >= 0 ? `+${formatChips(pt.net)}` : formatChips(pt.net)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Coordinate Labels */}
                <div className="flex justify-between text-[10px] text-zinc-500 z-10 pt-2 border-t border-white/10">
                  <span>Tight (&lt;20% VPIP)</span>
                  <span className="text-zinc-300 font-bold uppercase tracking-widest">Voluntary Put In Pot (VPIP %)</span>
                  <span>Loose (&gt;50% VPIP)</span>
                </div>
              </div>

              {/* Roster Archetype List */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-zinc-300">
                  Tactical Profiles
                </h4>
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {playstylePoints.map((p, idx) => (
                    <div 
                      key={p.name}
                      className="p-2.5 bg-black/40 border border-white/10 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-2.5 h-2.5 shrink-0" 
                          style={{ backgroundColor: SERIES_COLORS[idx % SERIES_COLORS.length] }} 
                        />
                        <div>
                          <span className="font-bold font-sans text-white block">{p.name}</span>
                          <span className="text-[10px] text-zinc-500">
                            {p.style} · {p.hands} hands
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-zinc-300 font-bold block">{p.vpip}% / {p.pfr}%</span>
                        <span className={`text-[10px] font-bold ${p.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {p.net >= 0 ? `+${formatChips(p.net)}` : formatChips(p.net)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-zinc-500 font-mono text-xs">
              No pre-flop action statistics recorded for this session yet.
            </div>
          )}
        </div>
      )}

      {/* VIEW 3: Table Dominance & Chip Distribution */}
      {selectedMetricView === 'distribution' && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 sm:p-6 shadow-2xl backdrop-blur-xl space-y-6">
          <div className="border-b border-white/10 pb-3">
            <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              Final Table Chip Dominance
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              Proportion of ending table chips held by each player profile.
            </p>
          </div>

          {chipDistribution.length > 0 ? (
            <div className="space-y-6">
              {/* Stack Distribution Stacked Bar */}
              <div className="w-full h-7 bg-zinc-900 border border-white/10 flex overflow-hidden">
                {chipDistribution.map(item => (
                  <div
                    key={item.name}
                    style={{ width: `${item.percentage}%`, backgroundColor: item.color }}
                    className="h-full relative group transition-all"
                    title={`${item.name}: ${formatChips(item.stack)} (${item.percentage}%)`}
                  />
                ))}
              </div>

              {/* Detailed Breakdown Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {chipDistribution.map(item => (
                  <div 
                    key={item.name}
                    className="p-3 bg-black/40 border border-white/10 flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 shrink-0" style={{ backgroundColor: item.color }} />
                      <div>
                        <span className="font-bold text-white font-sans block">{item.name}</span>
                        <span className="text-[11px] text-zinc-400">{formatChips(item.stack)} chips</span>
                      </div>
                    </div>
                    <span className="text-sm font-bold text-amber-400">
                      {item.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-zinc-500 font-mono text-xs">
              No active cash-out stacks recorded for this session.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
