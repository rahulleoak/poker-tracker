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

  // Compute Country-Banker Settlement
  const bankerSettlement = useMemo(() => {
    if (!isBalanced || totalBuyIn <= 0 || !Array.isArray(entries) || entries.length === 0) {
      return null;
    }
    const namedEntries = entries.map(e => ({
      ...e,
      name: (nameOf(e.playerId) || e.name || '').trim()
    }));

    return computeBankSettlement({
      entries: namedEntries,
      chipsPerCad: settlementConfig.chipsPerCad || (1 / (chipValue || 1)),
      cadToUsd: settlementConfig.cadToUsd || (exchangeRates?.CAD ? 1 / exchangeRates.CAD : 0.74),
      bankByCountry: settlementConfig.bankByCountry || {},
      countryByKey: settlementConfig.countryByKey || {}
    });
  }, [isBalanced, totalBuyIn, entries, settlementConfig, chipValue, exchangeRates, nameOf]);

  // Compute Peer-to-Peer Settlement (fallback / casual mode)
  const peerSettlement = useMemo(() => {
    if (!isBalanced || totalBuyIn <= 0 || !Array.isArray(entries) || entries.length === 0) {
      return null;
    }
    return calculateSettlement({
      entries,
      chipValue,
      gameCurrency,
      settlementCurrency: gameCurrency,
      exchangeRates,
      useBankBuddies: false
    });
  }, [isBalanced, totalBuyIn, entries, chipValue, gameCurrency, exchangeRates]);

  const pidByKey = useMemo(() => {
    const map = new Map();
    for (const e of entries || []) {
      map.set(keyOfEntry(e), e.playerId || null);
    }
    return map;
  }, [entries]);

  const markFor = useCallback((legId) => {
    return marks.find(m => m.leg_id === legId && !m.undone_at) || null;
  }, [marks]);

  const toggleMark = useCallback(async (legId, buildRow) => {
    if (busy) return;
    setBusy(true);
    try {
      const existing = markFor(legId);
      if (existing) {
        await sessionApi.undoMarks([existing.id]);
        setUndoState(null);
      } else {
        const row = buildRow();
        const inserted = await sessionApi.addMarks([row]);
        const ids = (inserted || []).map(r => r.id).filter(Boolean);
        if (ids.length) {
          setUndoState({ ids, label: `Marked "${row.party_name || 'Transfer'}" as settled` });
        }
      }
      await reloadMarks();
      if (onSettleChange) onSettleChange();
    } catch (err) {
      console.error('Failed to toggle settlement mark:', err);
    } finally {
      setBusy(false);
    }
  }, [busy, markFor, reloadMarks, onSettleChange]);

  const handleSettleAllInCountry = useCallback(async (countryCode) => {
    if (!bankerSettlement || busy) return;
    const transfers = bankerSettlement.playerTransfers.filter(
      t => t.country === countryCode && !markFor(t.legId)
    );
    if (transfers.length === 0) return;

    setBusy(true);
    try {
      const rowsToInsert = transfers.map(t => ({
        session_id: sessionId,
        leg_id: t.legId,
        scope: 'player',
        country: t.country,
        party_key: pidByKey.get(t.partyKey) || t.partyKey,
        party_name: t.partyName,
        counterparty_key: pidByKey.get(t.bankKey) || t.bankKey,
        counterparty_name: t.bankName,
        direction: t.direction,
        amount_cad: t.amount,
        amount_local: t.amountLocal,
        currency: t.currency,
        session_date: startDate || null
      }));

      const inserted = await sessionApi.addMarks(rowsToInsert);
      await reloadMarks();
      const ids = (inserted || []).map(r => r.id).filter(Boolean);
      if (ids.length) {
        setUndoState({ ids, label: `Settled ${transfers.length} player(s) in ${countryCode}` });
      }
      if (onSettleChange) onSettleChange();
    } catch (err) {
      console.error('Failed to batch settle:', err);
    } finally {
      setBusy(false);
    }
  }, [bankerSettlement, busy, markFor, sessionId, pidByKey, startDate, reloadMarks, onSettleChange]);

  const handleUndo = useCallback(async (ids) => {
    if (!ids?.length || busy) return;
    setBusy(true);
    try {
      await sessionApi.undoMarks(ids);
      await reloadMarks();
      setUndoState(null);
      if (onSettleChange) onSettleChange();
    } catch (err) {
      console.error('Failed to undo settlement mark:', err);
    } finally {
      setBusy(false);
    }
  }, [busy, reloadMarks, onSettleChange]);

  const handleCopySummary = useCallback(async () => {
    let text = '';
    if (mode === 'banker' && bankerSettlement) {
      text = buildSettlementText(bankerSettlement, {
        sessionId,
        isSettled: (legId) => Boolean(markFor(legId))
      });
    } else if (peerSettlement?.transactions) {
      const dateStr = startDate ? ` (${startDate})` : '';
      text = `♠️ Poker Settlement${dateStr}\n`;
      text += peerSettlement.transactions.map(tx => `• ${tx.from} ➔ ${tx.to}: ${formatFiat(tx.amount, gameCurrency)}`).join('\n');
    }

    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mode, bankerSettlement, peerSettlement, sessionId, markFor, startDate, gameCurrency]);

  const countryOfBankKey = useCallback((bankKey) => {
    return bankerSettlement?.countries?.find(c => c.bankKey === bankKey)?.code || null;
  }, [bankerSettlement]);

  if (!isBalanced || totalBuyIn === 0) {
    return (
      <div className="hud-corner-reticle bg-hud-card/80 border border-white/10 p-6 text-center space-y-3 backdrop-blur-xl">
        <AlertCircle className="w-8 h-8 text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.8)] mx-auto" />
        <h3 className="font-bold text-white font-sans text-sm uppercase tracking-wider">Ledger Discrepancy</h3>
        <p className="text-xs text-zinc-400 max-w-xs mx-auto font-sans">
          Balance buy-ins with ending stacks to compute bank routes.
        </p>
      </div>
    );
  }

  return (
    <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 overflow-hidden shadow-2xl backdrop-blur-xl flex flex-col font-sans">
      {/* Header */}
      <div className="p-4 border-b border-white/10 bg-black/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-white font-sans uppercase tracking-wider flex items-center gap-1.5">
              Settlement Checklist
              <span className="text-[9px] uppercase font-mono font-bold tracking-widest px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                Live
              </span>
            </h3>
            <p className="text-[11px] text-zinc-500 font-mono">Banker routes & ledger state</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-black/80 border border-white/10 p-0.5">
            <button
              onClick={() => setMode('banker')}
              className={`px-2.5 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                mode === 'banker' 
                  ? 'bg-zinc-800 text-emerald-400 border border-emerald-500/30 shadow-[0_0_6px_rgba(16,185,129,0.3)]' 
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Landmark className="w-3 h-3" /> Banker
            </button>
            <button
              onClick={() => setMode('peer')}
              className={`px-2.5 py-1 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 ${
                mode === 'peer' 
                  ? 'bg-zinc-800 text-cyan-400 border border-cyan-500/30 shadow-[0_0_6px_rgba(6,182,212,0.3)]' 
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users className="w-3 h-3" /> P2P
            </button>
          </div>

          <button
            onClick={handleCopySummary}
            className="px-2.5 py-1.5 text-xs font-mono font-bold uppercase tracking-wider bg-black/60 hover:bg-zinc-900 text-zinc-200 border border-white/15 transition-all flex items-center gap-1.5 hover:border-cyan-400 hover:text-cyan-300"
            title="Copy formatted settlement text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto max-h-[550px]">
        {mode === 'banker' && bankerSettlement && (
          <>
            {bankerSettlement.countries.map((c) => {
              const nonBank = c.members.filter(m => !m.isBank && Math.abs(m.netLocal) >= 0.005);
              const converted = c.currency !== 'CAD';
              const transfersByKey = new Map(
                bankerSettlement.playerTransfers
                  .filter(t => t.country === c.code)
                  .map(t => [t.partyKey, t])
              );
              const unsettledCount = nonBank.filter(m => {
                const t = transfersByKey.get(m.key);
                return t ? !markFor(t.legId) : true;
              }).length;

              return (
                <div key={c.code} className="bg-black/60 border border-white/10 p-3.5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{c.flag}</span>
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-sans">{c.name}</span>
                      <span className="text-xs text-zinc-400 font-mono">
                        {c.bankName ? `· Bank: ${c.bankName}` : '· No Bank'}
                      </span>
                    </div>

                    {c.bankName && unsettledCount > 0 && (
                      <button
                        onClick={() => handleSettleAllInCountry(c.code)}
                        disabled={busy}
                        className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Settle All ({unsettledCount})
                      </button>
                    )}
                  </div>

                  {c.bankName ? (
                    <div className="divide-y divide-white/5">
                      {nonBank.map((m) => {
                        const t = transfersByKey.get(m.key);
                        const settled = t ? Boolean(markFor(t.legId)) : false;

                        return (
                          <div key={m.key} className="flex items-center justify-between py-2 text-xs gap-3">
                            <label className="flex items-center gap-2.5 min-w-0 cursor-pointer select-none">
                              {t && (
                                <input
                                  type="checkbox"
                                  checked={settled}
                                  disabled={busy}
                                  onChange={() =>
                                    toggleMark(t.legId, () => ({
                                      session_id: sessionId,
                                      leg_id: t.legId,
                                      scope: 'player',
                                      country: t.country,
                                      party_key: pidByKey.get(t.partyKey) || t.partyKey,
                                      party_name: t.partyName,
                                      counterparty_key: pidByKey.get(t.bankKey) || t.bankKey,
                                      counterparty_name: t.bankName,
                                      direction: t.direction,
                                      amount_cad: t.amount,
                                      amount_local: t.amountLocal,
                                      currency: t.currency,
                                      session_date: startDate || null
                                    }))
                                  }
                                  className="w-4 h-4 rounded border-white/20 text-emerald-500 focus:ring-emerald-500 bg-black cursor-pointer"
                                />
                              )}
                              <span className={`truncate font-medium font-sans ${settled ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
                                {m.name}
                              </span>
                            </label>

                            <div className="shrink-0 text-right">
                              {settled ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/30 uppercase">
                                  <Check className="w-3 h-3" /> Settled
                                </span>
                              ) : (
                                <span className={`font-mono tabular-nums text-xs font-bold ${m.netLocal >= 0 ? 'text-emerald-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]' : 'text-rose-400 drop-shadow-[0_0_4px_rgba(244,63,94,0.6)]'}`}>
                                  {m.netLocal >= 0
                                    ? `receives ${money(m.netLocal, c.currency)}`
                                    : `pays ${money(m.netLocal, c.currency)}`}
                                  {converted && (
                                    <span className="text-zinc-500 text-[10px] ml-1 font-normal font-mono">
                                      ({money(m.netCad, 'CAD')})
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {nonBank.length === 0 && (
                        <div className="py-2 text-xs text-zinc-500 font-mono italic">All players in {c.name} broke even.</div>
                      )}

                      <div className="flex items-center justify-between pt-2 text-xs text-zinc-400 font-mono">
                        <span className="flex items-center gap-1.5 font-medium">
                          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                          {c.bankName} (Bank)
                        </span>
                        <span className="font-bold text-zinc-200 tabular-nums">
                          Net: {c.netLocal >= 0 ? '+' : '−'}{money(c.netLocal, c.currency)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500 font-mono italic">Assign a banker for {c.name} to route regional debts.</p>
                  )}
                </div>
              );
            })}

            {/* Inter-Bank Transfers */}
            {bankerSettlement.bankTransfers.length > 0 && (
              <div className="bg-black/60 border border-white/10 p-3.5 space-y-2">
                <div className="text-xs font-bold font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 drop-shadow-[0_0_4px_rgba(245,158,11,0.8)]" />
                  Inter-Bank Clearing
                </div>
                <div className="divide-y divide-white/5">
                  {bankerSettlement.bankTransfers.map((t) => {
                    const settled = Boolean(markFor(t.legId));
                    return (
                      <div key={t.legId} className="flex items-center justify-between py-2 text-xs gap-3">
                        <label className="flex items-center gap-2 min-w-0 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={settled}
                            disabled={busy}
                            onChange={() =>
                              toggleMark(t.legId, () => ({
                                session_id: sessionId,
                                leg_id: t.legId,
                                scope: 'bank',
                                country: countryOfBankKey(t.fromKey),
                                party_key: pidByKey.get(t.fromKey) || t.fromKey,
                                party_name: t.from,
                                counterparty_key: pidByKey.get(t.toKey) || t.toKey,
                                counterparty_name: t.to,
                                direction: 'bank',
                                amount_cad: t.amount,
                                amount_local:
                                  bankerSettlement.cadToUsd !== 1
                                    ? t.amount * bankerSettlement.cadToUsd
                                    : t.amount,
                                currency: 'CAD',
                                session_date: startDate || null
                              }))
                            }
                            className="w-4 h-4 rounded border-white/20 text-emerald-500 focus:ring-emerald-500 bg-black cursor-pointer"
                          />
                          <span className={`truncate font-mono font-semibold ${settled ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
                            {t.from} <ArrowRight className="inline w-3 h-3 text-zinc-500 mx-0.5" /> {t.to}
                          </span>
                        </label>
                        <div className="shrink-0">
                          {settled ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/30 uppercase">
                              <Check className="w-3 h-3" /> Cleared
                            </span>
                          ) : (
                            <span className="font-mono tabular-nums text-xs font-bold text-amber-400 drop-shadow-[0_0_4px_rgba(245,158,11,0.6)]">
                              {money(t.amount, 'CAD')}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Peer-to-Peer Mode */}
        {mode === 'peer' && peerSettlement && (
          <div className="space-y-2">
            {peerSettlement.transactions.map((tx, idx) => (
              <div key={idx} className="p-2.5 bg-black/60 border border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 font-sans font-medium text-zinc-200">
                  <span>{tx.from}</span>
                  <ArrowRight className="w-3 h-3 text-cyan-400" />
                  <span>{tx.to}</span>
                </div>
                <span className="font-mono tabular-nums font-bold text-emerald-400 drop-shadow-[0_0_4px_rgba(34,197,94,0.6)]">
                  {formatFiat(tx.amount, gameCurrency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Undo Toast */}
      {undoState && (
        <div className="p-3 bg-zinc-900 border-t border-white/15 flex items-center justify-between text-xs font-mono">
          <span className="text-zinc-300 truncate max-w-[200px]">{undoState.label}</span>
          <button
            onClick={() => handleUndo(undoState.ids)}
            className="text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
