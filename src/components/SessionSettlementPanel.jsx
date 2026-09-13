import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  Check, 
  Copy, 
  ExternalLink, 
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
  nameOf = (k) => null,
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
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-amber-500/70 mx-auto" />
        <h3 className="font-semibold text-slate-200">Ledger Not Balanced</h3>
        <p className="text-xs text-slate-400 max-w-xs mx-auto">
          Ensure total buy-ins match total buy-outs + ending stacks before computing settlements.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
              Settlement Checklist
              <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Live
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">Persistent check-offs & banker routes</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => setMode('banker')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'banker' 
                  ? 'bg-emerald-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Landmark className="w-3 h-3" /> Banker
            </button>
            <button
              onClick={() => setMode('peer')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1.5 ${
                mode === 'peer' 
                  ? 'bg-emerald-600 text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Users className="w-3 h-3" /> Peer-to-Peer
            </button>
          </div>

          <button
            onClick={handleCopySummary}
            className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 transition-colors flex items-center gap-1.5"
            title="Copy formatted settlement text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-5 flex-1 overflow-y-auto">
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
                <div key={c.code} className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{c.flag}</span>
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">{c.name}</span>
                      <span className="text-xs text-slate-500 font-medium">
                        {c.bankName ? `· Bank: ${c.bankName}` : '· No bank designated'}
                      </span>
                    </div>

                    {c.bankName && unsettledCount > 0 && (
                      <button
                        onClick={() => handleSettleAllInCountry(c.code)}
                        disabled={busy}
                        className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Settle All ({unsettledCount})
                      </button>
                    )}
                  </div>

                  {c.bankName ? (
                    <div className="divide-y divide-slate-800/50">
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
                                  className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 bg-slate-900 cursor-pointer"
                                />
                              )}
                              <span className={`truncate font-medium ${settled ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                                {m.name}
                              </span>
                            </label>

                            <div className="shrink-0 text-right">
                              {settled ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                  <Check className="w-3 h-3" /> Paid
                                </span>
                              ) : (
                                <span className={m.netLocal >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
                                  {m.netLocal >= 0
                                    ? `receives ${money(m.netLocal, c.currency)}`
                                    : `pays ${money(m.netLocal, c.currency)}`}
                                  {converted && (
                                    <span className="text-slate-500 text-[10px] ml-1 font-normal">
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
                        <div className="py-2 text-xs text-slate-500 italic">Everyone in {c.name} broke even.</div>
                      )}

                      <div className="flex items-center justify-between pt-2 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5 font-medium">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400/80" />
                          {c.bankName} (Bank)
                        </span>
                        <span className="font-semibold text-slate-300">
                          Country Net: {c.netLocal >= 0 ? '+' : '−'}{money(c.netLocal, c.currency)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">Assign a banker for {c.name} to route regional debts.</p>
                  )}
                </div>
              );
            })}

            {/* Inter-Bank Transfers */}
            {bankerSettlement.bankTransfers.length > 0 && (
              <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5 space-y-2">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  Between Regional Banks
                </div>
                <div className="divide-y divide-slate-800/50">
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
                            className="w-4 h-4 rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-slate-950 bg-slate-900 cursor-pointer"
                          />
                          <span className={`truncate font-semibold ${settled ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                            {t.from} <ArrowRight className="inline w-3 h-3 text-slate-500 mx-0.5" /> {t.to}
                          </span>
                        </label>
                        <div className="shrink-0 text-right">
                          {settled ? (
                            <span className="text-[11px] font-semibold text-emerald-400/80 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              Settled
                            </span>
                          ) : (
                            <span className="font-bold text-slate-200">
                              {money(t.amount, 'CAD')}
                              {bankerSettlement.cadToUsd !== 1 && (
                                <span className="text-slate-500 text-[10px] ml-1 font-normal">
                                  ({money(t.amount * bankerSettlement.cadToUsd, 'USD')})
                                </span>
                              )}
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

        {mode === 'peer' && peerSettlement && (
          <div className="space-y-2.5">
            {peerSettlement.settlements.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-4 text-center">Everyone broke even! No payments needed.</p>
            ) : (
              peerSettlement.settlements.map((tx, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 bg-slate-950/60 border border-slate-800 rounded-lg text-xs gap-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-rose-400 truncate">{tx.from}</span>
                    <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
                    <span className="font-semibold text-emerald-400 truncate">{tx.to}</span>
                  </div>
                  <span className="font-bold text-slate-200 shrink-0">{formatFiat(tx.amount, gameCurrency)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer link to Global Settlement Hub */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs">
        <span className="text-slate-500">
          FX: 1 CAD = {bankerSettlement?.cadToUsd ? bankerSettlement.cadToUsd.toFixed(3) : '0.740'} USD
        </span>
        <Link
          to="/settlement"
          className="font-semibold text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
        >
          <span>Multi-Session Ledger</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* Undo Toast */}
      {undoState && (
        <div className="p-2.5 bg-slate-800 border-t border-slate-700 flex items-center justify-between text-xs text-slate-200">
          <span className="truncate pr-2">{undoState.label}</span>
          <button
            onClick={() => handleUndo(undoState.ids)}
            disabled={busy}
            className="flex items-center gap-1 font-bold text-emerald-400 hover:text-emerald-300 shrink-0"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
