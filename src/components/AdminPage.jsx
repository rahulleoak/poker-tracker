import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, XCircle, Trash2, ExternalLink, ChevronRight, Check } from 'lucide-react';
import { parseSessionLedger, isLedgerCsv } from '../utils/pokernow-utils/parseSessionLedger';
import {
  extractPokerNowGameId,
  extractSessionStartDate,
  applyPlayerGroups
} from '../utils/pokernow-utils/sessionMeta';
import {
  parseCumulativeNet,
  groupCumulativeNet,
  reconcileCumulativeNet
} from '../utils/pokernow-utils/parseHandLog';
import {
  createGameFromCSVEntries,
  extractPokerNowUrl
} from '../utils/sessionMapper';
import { toChartData } from '../utils/chartData';
import { keyOfEntry } from '../utils/bankSettlement';
import { COUNTRIES } from '../utils/countries';
import { sessionApi } from '../utils/sessionApi';
import { supabase } from '../utils/supabase';
import { useIdentityGraph } from '../hooks/useIdentityGraph';
import { resolveEntryIdentity, ensureProfile, linkTokens } from '../utils/adminIdentity';
import { stashSessionPreview } from '../utils/sessionHandoff';
import AdminPlayerLinkDialog from './AdminPlayerLinkDialog';

const generateFallbackId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

const readAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });

// Best-effort pull of the authoritative ledger CSV straight from PokerNow.
// Private games / CORS just return null and the caller falls back to the
// hand-log reconstruction.
async function fetchPokerNowLedger(gameId) {
  const urls = [
    `https://www.pokernow.club/games/${gameId}/ledger_${gameId}.csv`,
    `https://www.pokernow.com/games/${gameId}/ledger_${gameId}.csv`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const text = await res.text();
      if (isLedgerCsv(text)) return text;
    } catch {
      /* CORS / offline — try the next URL, then give up */
    }
  }
  return null;
}

const formatDate = (value) => {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function AdminPage() {
  const navigate = useNavigate();
  const { players, playerLinks, refresh: refreshIdentity } = useIdentityGraph();
  const [status, setStatus] = useState('idle'); // idle | parsing | review | saving | error
  const [error, setError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [pending, setPending] = useState(null); // { logText, ledgerText, ledgerSource, entries, date, gameId, ... }

  // Files staged before "Continue". The ledger CSV is the source of truth for
  // amounts; the hand log is optional and only powers the chart.
  const [picked, setPicked] = useState({
    ledgerText: null,
    ledgerName: null,
    logText: null,
    logName: null
  });

  // Collision guard (see design/admin-session.md). `collision` holds the existing
  // row so the review dialog can be pre-filled on Overwrite.
  const [collision, setCollision] = useState(null); // { row } | null
  const [prefill, setPrefill] = useState(null); // { groups, settlement } | null
  const [confirmedOverwriteId, setConfirmedOverwriteId] = useState(null);

  // Session list
  const [sessions, setSessions] = useState([]);
  const [listState, setListState] = useState('loading'); // loading | ready | error
  const [deletingId, setDeletingId] = useState(null);

  const refreshList = useCallback(async () => {
    setListState((s) => (s === 'ready' ? s : 'loading'));
    try {
      setSessions(await sessionApi.list());
      setListState('ready');
    } catch (err) {
      console.error('Failed to load admin sessions:', err);
      setListState('error');
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // Standing bank defaults (admin_bank_defaults): { countryCode -> profileId }
  const [bankDefaults, setBankDefaults] = useState({});
  const refreshBankDefaults = useCallback(async () => {
    try {
      const rows = await sessionApi.listBankDefaults();
      const map = Object.fromEntries(rows.map((r) => [r.country, r.player_id]));
      setBankDefaults(map);
      return map;
    } catch (err) {
      console.error('Failed to load bank defaults:', err);
      return {};
    }
  }, []);
  useEffect(() => {
    refreshBankDefaults();
  }, [refreshBankDefaults]);

  const openCollisionFor = useCallback(async (id) => {
    try {
      const row = await sessionApi.get(id);
      if (row) {
        setCollision({ row });
        return true;
      }
    } catch (err) {
      console.error('Collision lookup failed:', err);
    }
    return false;
  }, []);

  const [dragging, setDragging] = useState(false);

  // Accept any number of dropped/picked CSVs and sort them into the ledger slot
  // and the hand-log slot by content (isLedgerCsv), regardless of file name.
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []).filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv');
    if (files.length === 0) return;
    setError(null);
    if (status === 'error') setStatus('idle');

    try {
      const read = await Promise.all(
        files.map(async (f) => ({ name: f.name, text: await readAsText(f) }))
      );
      setPicked((prev) => {
        const next = { ...prev };
        for (const { name, text } of read) {
          if (isLedgerCsv(text)) {
            next.ledgerText = text;
            next.ledgerName = name;
          } else {
            next.logText = text;
            next.logName = name;
          }
        }
        return next;
      });
    } catch (err) {
      console.error('Failed to read a dropped file:', err);
      setError(err.message || 'Could not read a file.');
    }
  };

  const clearPicked = (slot) =>
    setPicked((p) =>
      slot === 'ledger'
        ? { ...p, ledgerText: null, ledgerName: null }
        : { ...p, logText: null, logName: null }
    );

  const handleContinue = async () => {
    setStatus('parsing');
    setError(null);
    setSaveError(null);
    setPending(null);
    setPrefill(null);
    setCollision(null);
    setConfirmedOverwriteId(null);

    try {
      let { ledgerText } = picked;
      const { logText } = picked;
      const metaText = ledgerText || logText;
      if (!metaText) throw new Error('Add the ledger CSV to continue.');

      const gameId = extractPokerNowGameId(picked.ledgerName || picked.logName || '', metaText);

      // The ledger is the source of truth. If it wasn't uploaded, try pulling it
      // straight from PokerNow before giving up.
      let ledgerSource = ledgerText ? 'file' : null;
      if (!ledgerText && gameId) {
        const fetched = await fetchPokerNowLedger(gameId);
        if (fetched) {
          ledgerText = fetched;
          ledgerSource = 'fetched';
        }
      }
      if (!ledgerText) {
        throw new Error(
          'A ledger CSV is required (ledger_<id>.csv) — it is the source of truth for amounts. ' +
            'Upload it, or make sure the game is public so it can be fetched.'
        );
      }

      const entries = parseSessionLedger(ledgerText);
      if (entries.length === 0) {
        throw new Error('No player entries found in the ledger CSV.');
      }

      // Phase 1 — resolve each entry against the master identity graph. Seats
      // that resolve to the same profile are pre-grouped; the dialog shows and
      // pre-binds them.
      const resolvedByKey = {};
      const byProfile = new Map();
      const presentProfiles = new Set();
      for (const e of entries) {
        const k = keyOfEntry(e);
        const hit = resolveEntryIdentity(e, { players, playerLinks });
        if (!hit) continue;
        presentProfiles.add(hit.playerId);
        resolvedByKey[k] = { playerId: hit.playerId, displayName: hit.displayName };
        if (!byProfile.has(hit.playerId)) byProfile.set(hit.playerId, []);
        byProfile.get(hit.playerId).push(k);
      }
      const seededGroups = [...byProfile.values()].filter((keys) => keys.length > 1);

      // A standing banker who didn't play is still the clearing house — add them
      // as a zero-balance participant so settlement can route through them.
      const freshBankDefaults = await refreshBankDefaults();
      for (const [, pid] of Object.entries(freshBankDefaults)) {
        if (!pid || presentProfiles.has(pid)) continue;
        const prof = players.find((p) => p.id === pid);
        if (!prof) continue;
        const phantom = {
          name: prof.display_name,
          pokerNowId: `bank:${pid}`,
          externalId: `bank:${pid}`,
          buyIn: 0,
          buyOut: 0,
          stack: 0
        };
        entries.push(phantom);
        resolvedByKey[keyOfEntry(phantom)] = { playerId: pid, displayName: prof.display_name };
      }

      const date = extractSessionStartDate(metaText) || new Date().toISOString().split('T')[0];
      const suggestedId = gameId || generateFallbackId();

      setPending({
        logText: logText || null,
        ledgerText,
        ledgerSource,
        entries,
        resolvedByKey,
        seededGroups,
        date,
        gameId,
        suggestedId,
        idIsFallback: !gameId
      });
      setStatus('review');

      // Early collision check on the extracted id, before the user starts
      // reviewing — so an obvious re-upload is caught up front.
      if (gameId) await openCollisionFor(gameId);
    } catch (err) {
      console.error('Failed to process PokerNow CSVs:', err);
      setError(err.message || 'Failed to process files.');
      setStatus('error');
    }
  };

  const resetUpload = () => {
    setPending(null);
    setPrefill(null);
    setCollision(null);
    setConfirmedOverwriteId(null);
    setSaveError(null);
    setPicked({ ledgerText: null, ledgerName: null, logText: null, logName: null });
    setStatus('idle');
  };

  const handleCollisionOverwrite = () => {
    const row = collision?.row;
    setPrefill({
      groups: Array.isArray(row?.groups) ? row.groups : [],
      settlement: row?.settlement && typeof row.settlement === 'object' ? row.settlement : null
    });
    setConfirmedOverwriteId(row?.id || null);
    setCollision(null);
  };

  const handleCollisionOpenExisting = () => {
    const id = collision?.row?.id;
    setCollision(null);
    resetUpload();
    if (id) navigate(`/admin/session/${id}`);
  };

  const handleConfirmReview = async ({
    sessionId,
    groups,
    profileAssignments,
    countryByKey,
    bankByCountry,
    chipsPerCad,
    cadToUsd
  }) => {
    if (!pending || !sessionId) return;

    // Second collision check: the id is editable, so what's about to be written
    // may not be what the early check saw. Skip if the user already OK'd it.
    if (supabase && sessionId !== confirmedOverwriteId) {
      try {
        if (await sessionApi.exists(sessionId)) {
          await openCollisionFor(sessionId);
          return;
        }
      } catch (err) {
        console.error('Collision re-check failed:', err);
      }
    }

    setStatus('saving');
    setSaveError(null);
    try {
      const { logText, ledgerText, entries, date } = pending;
      const resolvedByKey = pending.resolvedByKey || {};
      const groupedEntries = applyPlayerGroups(entries, groups);

      const game = createGameFromCSVEntries(groupedEntries, 'USD', date, sessionId);
      const pokerNowUrl = extractPokerNowUrl(logText || ledgerText || '');
      if (pokerNowUrl) game.pokerNowUrl = pokerNowUrl;

      const settlement = { countryByKey, bankByCountry, chipsPerCad, cadToUsd };

      // Phase 2 — persist identities. For each unit the reviewer bound to a
      // profile: ensure the `players` row, then idempotently link its tokens.
      // Synthetic "bank:<id>" tokens (absent standing bankers) are never linked.
      const realToken = (t) => t && !String(t).startsWith('bank:');
      const tokensForUnit = (unitKey) => {
        const memberKeys = groups.find((m) => m.includes(unitKey)) || [unitKey];
        const tokens = new Set();
        for (const mk of memberKeys) {
          if (!realToken(mk)) continue;
          const src = entries.find((e) => keyOfEntry(e) === mk) || {};
          for (const t of [src.pokerNowId, src.externalId, src.name, mk]) {
            if (realToken(t)) tokens.add(String(t).trim());
          }
        }
        return [...tokens];
      };

      const unitPlayerId = {}; // unitKey -> profile id
      for (const [unitKey, choice] of Object.entries(profileAssignments || {})) {
        let pid = choice.playerId || null;
        if (!pid && choice.create) pid = await ensureProfile(choice.create, { players });
        if (!pid) continue;
        unitPlayerId[unitKey] = pid;
        const tokens = tokensForUnit(unitKey);
        if (tokens.length > 0) await linkTokens(pid, tokens, { playerLinks });
      }
      if (Object.keys(unitPlayerId).length > 0) refreshIdentity();

      const playerIdForKey = (k) => unitPlayerId[k] || resolvedByKey[k]?.playerId || null;

      // Every session nickname the seats in a unit went by (for the ledger's
      // "DB Name (alias, alias…)" display). Excludes synthetic bank participants.
      const aliasesForUnit = (unitKey) => {
        const memberKeys = groups.find((m) => m.includes(unitKey)) || [unitKey];
        const set = new Set();
        for (const mk of memberKeys) {
          if (!realToken(mk)) continue;
          const src = entries.find((e) => keyOfEntry(e) === mk);
          if (!src) continue;
          for (const a of [src.name, ...(Array.isArray(src.aliases) ? src.aliases : [])]) {
            const t = String(a || '').trim();
            if (t) set.add(t);
          }
        }
        return [...set];
      };

      // Render-ready cumulative-net blob — same pipeline SessionPage runs on the
      // hand log, resolved once here so a normal page load never re-parses. Only
      // the hand-log CSV carries per-hand data; a ledger-only upload has no chart.
      const chart_data = logText
        ? toChartData(
            reconcileCumulativeNet(groupCumulativeNet(parseCumulativeNet(logText), groups)),
            (mapKey) => playerIdForKey(String(mapKey).trim().toLowerCase())
          )
        : toChartData({ players: new Map(), snapshots: [] });

      const dbEntries = (game.entries || []).map((entry) => ({
        name: entry.name,
        aliases: aliasesForUnit(keyOfEntry(entry)),
        pokerNowId: entry.pokerNowId || null,
        externalId: entry.externalId || null,
        playerId: playerIdForKey(keyOfEntry(entry)),
        buyIn: Number(entry.buyIn) || 0,
        buyOut: Number(entry.buyOut) || 0,
        stack: Number(entry.stack) || 0,
        currency: entry.currency || 'USD',
        isBank: Boolean(entry.isBank)
      }));
      // Carry aliases onto the stash too, so the immediate navigation matches a refresh.
      game.entries = (game.entries || []).map((entry) => ({
        ...entry,
        aliases: aliasesForUnit(keyOfEntry(entry))
      }));

      const seenProfile = new Set();
      const dbProfiles = [];
      for (const entry of game.entries || []) {
        const pid = playerIdForKey(keyOfEntry(entry));
        if (!pid || seenProfile.has(pid)) continue;
        seenProfile.add(pid);
        dbProfiles.push({
          playerId: pid,
          tokens: tokensForUnit(keyOfEntry(entry))
        });
      }

      // Persist when Supabase is configured; without it the flow still works
      // in-memory for this navigation, just not on refresh (unchanged from before).
      if (supabase) {
        await sessionApi.create({
          id: sessionId,
          date: game.date,
          currency: game.currency || 'USD',
          chip_value: game.chipValue ?? 1,
          poker_now_url: game.pokerNowUrl || null,
          chart_data,
          entries: dbEntries,
          groups: Array.isArray(groups) ? groups : [],
          profiles: dbProfiles,
          settlement,
          player_count: chart_data.players.length,
          hand_count: Math.max(0, chart_data.nets.length - 1)
        });
      }

      // Write-through fast path: the session view reads this and skips the round
      // trip; a refresh / shared link falls back to the DB.
      stashSessionPreview({ id: sessionId, csvText: logText || null, game, groups, settlement });
      refreshList();
      resetUpload();
      navigate(`/admin/session/${sessionId}`);
    } catch (err) {
      console.error('Failed to save session:', err);
      setSaveError(err.message || 'Failed to save session.');
      setStatus('review');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this session? Its chart, ledger and settlement are removed. Player profiles and links are kept.')) {
      return;
    }
    setDeletingId(id);
    try {
      await sessionApi.remove(id);
      await refreshList();
    } catch (err) {
      console.error('Failed to delete session:', err);
      window.alert(err.message || 'Failed to delete session.');
    } finally {
      setDeletingId(null);
    }
  };

  const showDialog = (status === 'review' || status === 'saving') && pending && !collision;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans p-6">
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
          <div>
            <h1 className="text-xl font-bold text-emerald-400">Admin: Upload PokerNow session</h1>
            <p className="text-sm text-slate-500 mt-1">
              The <span className="text-slate-300">ledger CSV</span> is the source of truth for
              amounts. The <span className="text-slate-300">hand log</span> is optional — it only
              powers the cumulative-net chart.
            </p>
          </div>

          <DropZone
            picked={picked}
            dragging={dragging}
            onFiles={handleFiles}
            onDragState={setDragging}
            onClear={clearPicked}
          />

          {error && (
            <div className="flex items-start gap-3 bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
              <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleContinue}
            disabled={(!picked.ledgerText && !picked.logText) || status === 'parsing'}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-bold rounded-xl py-2.5 text-sm transition-colors"
          >
            {status === 'parsing' ? 'Reading…' : status === 'saving' ? 'Saving…' : 'Continue'}
          </button>

          <Link to="/" className="block text-center text-sm text-slate-500 hover:text-slate-300 transition-colors">
            &larr; Back to app
          </Link>
        </div>

        <StandingBanks
          profiles={players}
          value={bankDefaults}
          onChange={async (code, playerId) => {
            try {
              await sessionApi.setBankDefault(code, playerId || null);
              await refreshBankDefaults();
            } catch (err) {
              console.error('Failed to save bank default:', err);
              window.alert(err.message || 'Failed to save bank default.');
            }
          }}
        />

        <SessionList
          state={listState}
          sessions={sessions}
          deletingId={deletingId}
          onOpen={(id) => navigate(`/admin/session/${id}`)}
          onDelete={handleDelete}
          onRetry={refreshList}
        />
      </div>

      {collision && (
        <CollisionDialog
          row={collision.row}
          onOverwrite={handleCollisionOverwrite}
          onOpenExisting={handleCollisionOpenExisting}
          onCancel={resetUpload}
        />
      )}

      {showDialog && (
        <AdminPlayerLinkDialog
          entries={pending.entries}
          ledgerSource={pending.ledgerSource}
          suggestedId={pending.suggestedId}
          idIsFallback={pending.idIsFallback}
          initialGroups={
            prefill?.groups?.length ? prefill.groups : (pending.seededGroups || [])
          }
          initialSettlement={prefill?.settlement || null}
          resolvedByKey={pending.resolvedByKey || {}}
          profiles={players}
          bankDefaultByCountry={bankDefaults}
          error={saveError}
          onCancel={resetUpload}
          onConfirm={handleConfirmReview}
        />
      )}
    </div>
  );
}

function SlotRow({ label, required, fileName, hint, onClear }) {
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs ${
        fileName ? 'border-emerald-600/40 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      {fileName ? (
        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      ) : (
        <span className="w-3.5 text-center text-slate-600 shrink-0">—</span>
      )}
      <span className="text-slate-300 shrink-0">
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </span>
      <span className="text-slate-500 truncate flex-1">
        {fileName || (required ? 'required — drop it in' : hint)}
      </span>
      {fileName && (
        <button onClick={onClear} className="text-slate-500 hover:text-rose-400 shrink-0 font-medium">
          Remove
        </button>
      )}
    </div>
  );
}

function DropZone({ picked, dragging, onFiles, onDragState, onClear }) {
  const inputRef = useRef(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        onDragState(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        onDragState(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDragState(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`rounded-xl border-2 border-dashed px-5 py-6 cursor-pointer transition-colors ${
        dragging ? 'border-emerald-500 bg-emerald-500/5' : 'border-slate-700 hover:border-slate-600'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = null;
        }}
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <Upload className="w-6 h-6 text-slate-500" />
        <span className="text-sm text-slate-300">Drop the CSVs here, or click to browse</span>
        <span className="text-xs text-slate-600">ledger + hand log — each file is detected automatically</span>
      </div>
      <div className="mt-4 space-y-1.5" onClick={(e) => e.stopPropagation()}>
        <SlotRow
          label="Ledger CSV"
          required
          fileName={picked.ledgerName}
          onClear={() => onClear('ledger')}
        />
        <SlotRow
          label="Hand log"
          hint="optional, for the chart"
          fileName={picked.logName}
          onClear={() => onClear('log')}
        />
      </div>
    </div>
  );
}

function StandingBanks({ profiles, value, onChange }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800">
        <h2 className="text-sm font-medium text-slate-300">Standing banks</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          This player banks for their country in every session, even when playing. Overridable per session.
        </p>
      </div>
      <div className="p-5 space-y-2">
        {COUNTRIES.map((c) => (
          <div key={c.code} className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-200">{c.flag} {c.name}</span>
            <select
              value={value[c.code] || ''}
              onChange={(e) => onChange(c.code, e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-md text-xs px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 max-w-[55%]"
            >
              <option value="">— none —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.display_name}</option>
              ))}
            </select>
          </div>
        ))}
        {profiles.length === 0 && (
          <p className="text-xs text-slate-600">No player profiles yet — link players in a session first.</p>
        )}
      </div>
    </div>
  );
}

function SessionList({ state, sessions, deletingId, onOpen, onDelete, onRetry }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-300">
          Sessions{state === 'ready' && sessions.length > 0 && <span className="text-slate-600"> · {sessions.length}</span>}
        </h2>
      </div>

      {state === 'loading' && (
        <div className="p-5 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-slate-800/50 animate-pulse" />
          ))}
        </div>
      )}

      {state === 'error' && (
        <div className="p-5 flex items-center justify-between gap-3">
          <p className="text-sm text-rose-400">Couldn&apos;t load sessions.</p>
          <button onClick={onRetry} className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
            Retry
          </button>
        </div>
      )}

      {state === 'ready' && sessions.length === 0 && (
        <p className="p-5 text-sm text-slate-500">No sessions yet — upload a CSV above.</p>
      )}

      {state === 'ready' && sessions.length > 0 && (
        <ul className="divide-y divide-slate-800/80">
          {sessions.map((s) => {
            const edited = s.updated_at && s.created_at && s.updated_at !== s.created_at;
            return (
              <li key={s.id}>
                <div className="group flex items-center gap-3 px-5 py-3 hover:bg-slate-800/40 transition-colors">
                  <button
                    onClick={() => onOpen(s.id)}
                    className="flex-1 min-w-0 flex items-center gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-slate-200">
                        {formatDate(s.date) || <span className="font-mono text-xs text-slate-400">{s.id}</span>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {s.player_count} player{s.player_count === 1 ? '' : 's'} · {s.hand_count.toLocaleString()} hands
                        {edited && ' · edited'}
                      </div>
                    </div>
                  </button>

                  {s.poker_now_url && (
                    <a
                      href={s.poker_now_url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Open on PokerNow"
                      className="text-slate-500 hover:text-emerald-400 p-1"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(s.id);
                    }}
                    disabled={deletingId === s.id}
                    title="Delete session"
                    className="text-slate-600 hover:text-rose-400 p-1 disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-slate-700 group-hover:text-slate-500" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CollisionDialog({ row, onOverwrite, onOpenExisting, onCancel }) {
  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <h3 className="font-bold text-lg text-slate-100">Session already exists</h3>
        <p className="text-sm text-slate-400">
          A session with id <span className="font-mono text-slate-300 break-all">{row.id}</span> already
          exists{row.created_at ? ` (uploaded ${formatDate(row.created_at) || row.created_at}` : ''}
          {row.created_at ? ` · ${row.player_count ?? '?'} players · ${(row.hand_count ?? 0).toLocaleString()} hands)` : ''}.
          Saving replaces its chart, ledger and settlement.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={onOverwrite}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors"
          >
            Overwrite
          </button>
          <button
            onClick={onOpenExisting}
            className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
          >
            Open existing
          </button>
          <button
            onClick={onCancel}
            className="text-slate-500 hover:text-slate-300 px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
