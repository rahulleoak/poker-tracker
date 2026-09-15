import { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Check, 
  Copy, 
  Landmark, 
  Users, 
  ArrowRight, 
  ShieldCheck, 
  RotateCcw,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { computeBankSettlement, keyOfEntry } from '../utils/bankSettlement';
import { calculateSettlement } from '../utils/settlement';
import { buildSettlementText } from '../utils/settlementText';
import { sessionApi } from '../utils/sessionApi';
import { formatFiat } from '../utils/formatters';
import CountryFlag from './CountryFlag';

const money = (n, currency = 'CAD') => `$${Math.abs(Number(n) || 0).toFixed(2)} ${currency}`;

export default function SessionSettlementPanel({
  entries = [],
  settlementConfig = {},
  sessionId = 'current-session',
  startDate = null,
  gameCurrency = 'USD',
  chipValue = 1,
  exchangeRates = { USD: 1, CAD: 1.35 },
  nameOf = () => null,
  isBalanced = true,
  totalBuyIn = 0,
  onSettleChange
}) {
  const [mode, setMode] = useState('banker'); // 'banker' | 'peer'
  const [marks, setMarks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [undoState, setUndoState] = useState(null);

  // Load active settlement marks for this session
  const reloadMarks = useCallback(async () => {
    if (!sessionId) return;
    try {
      const activeMarks = await sessionApi.listMarks({ sessionId });
      setMarks(Array.isArray(activeMarks) ? activeMarks : []);
    } catch (err) {
      console.warn('Could not load session marks:', err);
    }
  }, [sessionId]);

  useEffect(() => {
    reloadMarks();
  }, [reloadMarks]);

  // Undo toast timeout
  useEffect(() => {
    if (!undoState) return undefined;
    const t = setTimeout(() => setUndoState(null), 9000);
    return () => clearTimeout(t);
  }, [undoState]);

  const safeEntriesList = useMemo(() => {
    return (Array.isArray(entries) ? entries : []).filter(
      (e) => e && typeof e === 'object' && (e.name || '').trim() !== ''
    );
  }, [entries]);

  // Compute Banker Multi-Country Settlement
  const bankerSettlement = useMemo(() => {
    if (!isBalanced || totalBuyIn <= 0 || safeEntriesList.length === 0) {
      return null;
    }
    const namedEntries = safeEntriesList.map(e => ({
      ...e,
      name: (nameOf(e?.playerId) || e?.name || '').trim()
    }));

    return computeBankSettlement({
      entries: namedEntries,
      chipsPerCad: settlementConfig?.chipsPerCad || (1 / (chipValue || 1)),
      cadToUsd: settlementConfig?.cadToUsd || (exchangeRates?.CAD ? 1 / exchangeRates.CAD : 0.74),
      exchangeRates: settlementConfig?.exchangeRates || exchangeRates,
      bankByCountry: settlementConfig?.bankByCountry || {},
      countryByKey: settlementConfig?.countryByKey || {}
    });
  }, [isBalanced, totalBuyIn, safeEntriesList, settlementConfig, chipValue, exchangeRates, nameOf]);

  // Compute Peer-to-Peer Settlement (fallback / casual mode)
  const peerSettlement = useMemo(() => {
    if (!isBalanced || totalBuyIn <= 0 || safeEntriesList.length === 0) {
      return null;
    }
    return calculateSettlement({
      entries: safeEntriesList,
      chipValue,
      gameCurrency,
      settlementCurrency: gameCurrency,
      exchangeRates,
      useBankBuddies: false
    });
  }, [isBalanced, totalBuyIn, safeEntriesList, chipValue, gameCurrency, exchangeRates]);

  const pidByKey = useMemo(() => {
    const map = new Map();
    for (const e of safeEntriesList) {
      if (e) {
        map.set(keyOfEntry(e), e.playerId || null);
      }
    }
    return map;
  }, [safeEntriesList]);

  // Marks map for quick check by leg_id
  const markMap = useMemo(() => {
    const map = new Map();
    for (const m of marks) {
      if (m && m.leg_id) {
        map.set(m.leg_id, m);
      }
    }
    return map;
  }, [marks]);

  const showUndo = (markId, label) => {
    setUndoState({ markId, label });
  };

  const handleToggle = async (isCurrentlySettled, leg) => {
    if (busy) return;
    setBusy(true);
    try {
      if (isCurrentlySettled) {
        const existing = markMap.get(leg.legId);
        if (existing) {
          await sessionApi.undoMarks([existing.id]);
          setMarks(prev => prev.filter(m => m.id !== existing.id));
        }
      } else {
        const payload = {
          session_id: sessionId,
          leg_id: leg.legId,
          scope: leg.scope, // 'player' | 'bank'
          country: leg.country || null,
          party_key: leg.partyKey || leg.fromKey || leg.partyName || leg.from,
          party_name: leg.partyName || leg.from,
          counterparty_key: leg.bankKey || leg.toKey || null,
          counterparty_name: leg.bankName || leg.to || null,
          direction: leg.direction,
          amount_cad: leg.amount,
          amount_local: leg.amountLocal ?? leg.amount,
          currency: leg.currency || 'CAD',
          session_date: startDate
        };
        const inserted = await sessionApi.addMarks([payload]);
        if (inserted && inserted[0]) {
          setMarks(prev => [...prev, inserted[0]]);
          showUndo(inserted[0].id, `Marked settled: ${leg.partyName || leg.from || ''}`);
        }
      }
      if (onSettleChange) onSettleChange();
    } catch (err) {
      console.error('Failed to toggle settlement mark:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleUndo = async (markId) => {
    if (!markId || busy) return;
    setBusy(true);
    try {
      await sessionApi.undoMarks([markId]);
      setMarks(prev => prev.filter(m => m.id !== markId));
      setUndoState(null);
      if (onSettleChange) onSettleChange();
    } catch (err) {
      console.error('Failed to undo settlement mark:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = () => {
    if (!bankerSettlement && !peerSettlement) return;
    const text = mode === 'banker' && bankerSettlement
      ? buildSettlementText(bankerSettlement, { markIds: marks.map(m => m.leg_id), gameCurrency })
      : peerSettlement?.settlementInstructions || '';
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!isBalanced || totalBuyIn <= 0) {
    return (
      <div className="hud-corner-reticle bg-hud-card/90 border border-amber-500/20 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
        <h4 className="text-sm font-bold text-white uppercase font-mono tracking-wider">
          Session Not Balanced
        </h4>
        <p className="text-xs text-zinc-400 mt-1">
          Total buy-in must equal total cash-out before settlement instructions can be calculated.
        </p>
      </div>
    );
  }

  const allLegs = bankerSettlement 
    ? [...(bankerSettlement.playerTransfers || []), ...(bankerSettlement.bankTransfers || [])]
    : [];
  const settledCount = allLegs.filter(l => markMap.has(l.legId)).length;
  const isFullySettled = allLegs.length > 0 && settledCount === allLegs.length;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-4 shadow-xl backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base tracking-tight">
                  Session Settlement Checklist
                </h3>
                {isFullySettled && (
                  <span className="px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono font-bold uppercase tracking-wider">
                    Cleared
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 font-mono">
                {mode === 'banker' ? 'Two-tier regional banking ledger' : 'Direct peer-to-peer minimal transfers'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex bg-black/60 border border-white/10 p-0.5">
              <button
                onClick={() => setMode('banker')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                  mode === 'banker'
                    ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Banker Ledger
              </button>
              <button
                onClick={() => setMode('peer')}
                className={`px-3 py-1.5 text-xs font-mono font-bold uppercase tracking-wider transition-all ${
                  mode === 'peer'
                    ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/40'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                P2P Flow
              </button>
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-zinc-200 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Chat'}
            </button>
          </div>
        </div>

        {/* Status progress bar */}
        {mode === 'banker' && allLegs.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-xs font-mono text-zinc-400">
            <span>
              Progress: <strong className="text-white">{settledCount}</strong> of <strong className="text-white">{allLegs.length}</strong> transfers completed
            </span>
            <div className="w-48 h-1.5 bg-zinc-800 overflow-hidden ml-4">
              <div 
                className="h-full bg-emerald-400 transition-all duration-300"
                style={{ width: `${(settledCount / allLegs.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Banker Multi-Country Ledger Mode */}
      {mode === 'banker' && bankerSettlement && (
        <div className="space-y-4">
          {/* Countries / Ledger Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bankerSettlement.countries.map(c => {
              const countryTransfers = bankerSettlement.playerTransfers.filter(t => t.country === c.code);
              const openCount = countryTransfers.filter(t => !markMap.has(t.legId)).length;

              return (
                <div 
                  key={c.code}
                  className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-xl backdrop-blur-xl flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2.5">
                        <CountryFlag code={c.code} className="w-5 h-3.5 rounded-[2px] shadow-sm shrink-0" />
                        <h4 className="font-bold text-white text-sm">
                          {c.name} Ledger
                        </h4>
                      </div>
                      <span className="text-xs font-mono font-bold text-zinc-400">
                        {c.currency}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-xs font-mono">
                      <div className="flex justify-between text-zinc-400">
                        <span>Standing Bank:</span>
                        <strong className="text-white">{c.bankName || 'None assigned'}</strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Regional Net:</span>
                        <strong className={c.netLocal >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {c.netLocal >= 0 ? '+' : ''}{money(c.netLocal, c.currency)}
                        </strong>
                      </div>
                      <div className="flex justify-between text-zinc-400">
                        <span>Pending Transfers:</span>
                        <strong className={openCount === 0 ? 'text-emerald-400' : 'text-amber-400'}>
                          {openCount} Open
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Player transfers within this country */}
                  <div className="mt-4 pt-3 border-t border-white/5 space-y-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 block">
                      Player ⇄ Bank Settlements
                    </span>
                    {countryTransfers.length === 0 ? (
                      <p className="text-xs text-zinc-500 italic">No non-bank player transfers in this region.</p>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {countryTransfers.map(t => {
                          const settled = markMap.has(t.legId);
                          return (
                            <div 
                              key={t.legId}
                              className="py-2 flex items-center justify-between text-xs font-mono gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <button
                                  onClick={() => handleToggle(settled, t)}
                                  disabled={busy}
                                  className={`w-4 h-4 border transition-all flex items-center justify-center shrink-0 ${
                                    settled
                                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                                      : 'bg-black/60 border-white/20 text-transparent hover:border-white/40'
                                  }`}
                                >
                                  <Check className={`w-3 h-3 stroke-[3] ${settled ? 'scale-100' : 'scale-0'}`} />
                                </button>
                                <span className={`truncate ${settled ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                                  {t.from} → {t.to}
                                </span>
                              </div>
                              <span className={`font-bold tabular-nums shrink-0 ${settled ? 'text-zinc-600' : 'text-emerald-400'}`}>
                                {money(t.amountLocal, t.currency)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inter-Bank Transfers */}
          {bankerSettlement.bankTransfers && bankerSettlement.bankTransfers.length > 0 && (
            <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-xl backdrop-blur-xl">
              <div className="flex items-center gap-2 border-b border-white/10 pb-3">
                <Landmark className="w-4 h-4 text-emerald-400" />
                <h4 className="font-bold text-white text-sm font-mono uppercase tracking-wider">
                  Inter-Bank Balancing Transfers
                </h4>
              </div>
              <div className="divide-y divide-white/5 mt-3">
                {bankerSettlement.bankTransfers.map(b => {
                  const settled = markMap.has(b.legId);
                  return (
                    <div 
                      key={b.legId}
                      className="py-2.5 flex items-center justify-between text-xs font-mono gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleToggle(settled, b)}
                          disabled={busy}
                          className={`w-4 h-4 border transition-all flex items-center justify-center shrink-0 ${
                            settled
                              ? 'bg-emerald-500/20 border-emerald-400 text-emerald-400'
                              : 'bg-black/60 border-white/20 text-transparent hover:border-white/40'
                          }`}
                        >
                          <Check className={`w-3 h-3 stroke-[3] ${settled ? 'scale-100' : 'scale-0'}`} />
                        </button>
                        <span className={`font-bold ${settled ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                          {b.from}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                        <span className={`font-bold ${settled ? 'line-through text-zinc-600' : 'text-zinc-200'}`}>
                          {b.to}
                        </span>
                      </div>
                      <span className={`font-bold tabular-nums ${settled ? 'text-zinc-600' : 'text-emerald-400'}`}>
                        {money(b.amount, 'CAD')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Peer-to-Peer Mode */}
      {mode === 'peer' && peerSettlement && (
        <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-xl backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-400" />
              <h4 className="font-bold text-white text-sm font-mono uppercase tracking-wider">
                Direct Peer Transfers ({peerSettlement.settlements.length})
              </h4>
            </div>
            <span className="text-xs font-mono text-zinc-400">
              Total Volume: {formatFiat(peerSettlement.totalVolume, gameCurrency)}
            </span>
          </div>

          <div className="divide-y divide-white/5">
            {peerSettlement.settlements.map((s, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-rose-300 font-medium">{s.from}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-emerald-300 font-medium">{s.to}</span>
                </div>
                <span className="font-bold text-zinc-100">
                  {formatFiat(s.amount, gameCurrency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Undo Toast */}
      {undoState && (
        <div className="fixed bottom-6 right-6 bg-black/95 border border-emerald-500/50 text-white px-4 py-3 shadow-2xl flex items-center gap-3 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200 backdrop-blur-md font-mono text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>{undoState.label}</span>
          <button
            onClick={() => handleUndo(undoState.markId)}
            className="ml-2 underline text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-bold"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
