import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Link2,
  Unlink,
  Users,
  GripVertical,
  Landmark,
  Sparkles,
  Check,
  Pencil,
  ChevronRight,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { formatChips } from '../utils/formatters';
import { COUNTRIES, DEFAULT_COUNTRY, country } from '../utils/countries';
import { keyOfEntry } from '../utils/bankSettlement';
import { autoGroupEntries } from '../utils/playerAutoGroup';
import { bankerConfigFor } from '../utils/adminBankDefaults';
import { useLiveCadToUsd } from '../hooks/useLiveCadToUsd';

const generateId = () => `grp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

// The country a seat is the standing bank for, if any: the DB `admin_bank_defaults`
// table (keyed by resolved profile id) wins, else the name-based fallback list.
function standingBankCountry(key, name, resolvedByKey, bankDefaultByCountry) {
  const info = resolvedByKey[key];
  if (info?.playerId) {
    for (const [code, pid] of Object.entries(bankDefaultByCountry || {})) {
      if (pid && pid === info.playerId) return code;
    }
  }
  const cfg = bankerConfigFor(info?.displayName) || bankerConfigFor(name);
  return cfg ? cfg.country : null;
}

const netOf = (entry) =>
  (Number(entry?.buyOut) || 0) + (Number(entry?.stack) || 0) - (Number(entry?.buyIn) || 0);

const netClass = (net) =>
  net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-slate-500';

const formatNet = (net) => `${net > 0 ? '+' : ''}${net === 0 ? '0' : formatChips(net)}`;

const shortId = (id) =>
  id && id.length > 16 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id || '(no id)';

const sigOf = (members) => [...members].sort().join('|');

// Stable identity for an entry: a player can share a nickname with someone else
// (e.g. two "kkkush" accounts), so prefer the PokerNow / external id.
const keyOf = keyOfEntry;

// Editable net (chips) figure — lets a reviewer patch a bad ledger row (e.g. an
// unclosed seat) in place, without needing a matching input state per row.
function NetInput({ value, overridden, onChange, onReset, className = '' }) {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
        title="Edit net (chips)"
        className={`bg-transparent border rounded-md text-right tabular-nums outline-none px-1 py-0.5 [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
          overridden
            ? 'border-amber-500/60 focus:border-amber-400'
            : 'border-transparent hover:border-slate-700 focus:border-emerald-500'
        } ${netClass(Number(value) || 0)} ${className}`}
      />
      {overridden && (
        <button
          type="button"
          onClick={onReset}
          onMouseDown={(e) => e.stopPropagation()}
          title="Reset to parsed value"
          className="p-0.5 text-amber-500/70 hover:text-amber-400 shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}
    </span>
  );
}

function CountrySelect({ value, onChange, disabled = false, title = 'Country', className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      disabled={disabled}
      title={title}
      className={`bg-slate-800 border border-slate-700 rounded-md text-xs px-1.5 py-1 outline-none focus:border-emerald-500 text-slate-200 disabled:opacity-60 disabled:cursor-not-allowed ${className}`}
    >
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.flag} {c.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Post-upload review dialog for the /admin CSV flow.
 *
 * One row per person for this session, grouped by settlement country. Each row
 * carries its profile link, bank toggle and (when not inherited from a linked
 * profile) its country. Dragging one row onto another merges the seats; dropping
 * a row on a country header reassigns it. On confirm the caller gets
 * { sessionId, groups, profileAssignments, countryByKey, profileCountryByKey,
 *   bankByCountry, chipsPerCad, cadToUsd }.
 */
export default function AdminPlayerLinkDialog({
  entries = [],
  onCancel,
  onConfirm,
  ledgerSource = null, // 'file' | 'fetched' | null (reconstructed from hand log)
  suggestedId = '',
  idIsFallback = false,
  initialGroups = [],
  initialSettlement = null,
  resolvedByKey = {}, // entry key -> { playerId, displayName } already known to the DB
  profiles = [], // [{ id, display_name, country }] master profiles for the picker
  bankDefaultByCountry = {}, // country code -> profile id: standing banker (admin_bank_defaults)
  error = null,
}) {
  const players = useMemo(
    () => entries.filter((e) => e && (e.name || '').trim() !== ''),
    [entries]
  );

  const entryByKey = useMemo(() => {
    const map = new Map();
    players.forEach((p) => {
      const k = keyOf(p);
      if (k && !map.has(k)) map.set(k, p);
    });
    return map;
  }, [players]);

  const nameFor = (key) => entryByKey.get(key)?.name || key;

  const profileById = useMemo(() => {
    const m = new Map();
    for (const p of profiles) m.set(p.id, p);
    return m;
  }, [profiles]);

  const sortedProfiles = useMemo(
    () => [...profiles].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [profiles]
  );

  // Editable session id — the PokerNow game id, or a generated fallback the
  // upload flow suggested. Becomes admin_sessions.id and the /admin/session route.
  const [sessionId, setSessionId] = useState(suggestedId);
  const [idOpen, setIdOpen] = useState(idIsFallback);

  // groups: [{ id, members: [key, ...], source }]  — first member is the primary
  // identity; `source` is 'auto' | 'manual'. Seeded from `initialGroups`.
  const [groups, setGroups] = useState(() =>
    (Array.isArray(initialGroups) ? initialGroups : [])
      .filter((m) => Array.isArray(m) && m.length > 1)
      .map((members) => ({ id: generateId(), members: [...members], source: 'manual' }))
  );
  const [dragKey, setDragKey] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // key | groupId | `country:<code>` | null
  const [expanded, setExpanded] = useState(() => new Set()); // group ids with seats shown
  const [editingLinks, setEditingLinks] = useState(false);
  const [dismissedSug, setDismissedSug] = useState(() => new Set());
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [mergeMenuFor, setMergeMenuFor] = useState(null); // unit key
  const [mergeFilter, setMergeFilter] = useState('');
  const mergeMenuRef = useRef(null);

  // unitKey -> '' (none) | '__create__' | <profileId>. Seeded from entries the DB
  // already recognises, so those come pre-bound.
  const [assignments, setAssignments] = useState(() => {
    const seed = {};
    for (const [key, info] of Object.entries(resolvedByKey || {})) {
      if (info?.playerId) seed[key] = info.playerId;
    }
    return seed;
  });

  // Seed each standing banker into its country unless already placed.
  const [countryByKey, setCountryByKey] = useState(() => {
    const seeded = { ...(initialSettlement?.countryByKey || {}) };
    for (const e of entries) {
      const k = keyOfEntry(e);
      if (seeded[k]) continue;
      const code = standingBankCountry(k, e.name, resolvedByKey, bankDefaultByCountry);
      if (code) seeded[k] = code;
    }
    return seeded;
  });
  const [bankByCountry, setBankByCountry] = useState(initialSettlement?.bankByCountry || {});
  const [bankTouched, setBankTouched] = useState(
    () => new Set(Object.keys(initialSettlement?.bankByCountry || {}))
  );
  const [chipsPerCad, setChipsPerCad] = useState(
    Number(initialSettlement?.chipsPerCad) > 0 ? Number(initialSettlement.chipsPerCad) : 100
  );
  const { cadToUsd: liveCadToUsd, isLive: cadToUsdIsLive } = useLiveCadToUsd(0.73);
  const [cadToUsdOverride, setCadToUsdOverride] = useState(
    Number(initialSettlement?.cadToUsd) > 0 ? Number(initialSettlement.cadToUsd) : null
  );
  const cadToUsd =
    cadToUsdOverride ?? (cadToUsdIsLive ? Number(liveCadToUsd.toFixed(4)) : liveCadToUsd);

  // Per-seat key -> reviewer-edited net (raw input string), overriding the value
  // derived from buyIn/buyOut/stack. Lets a bad ledger row (e.g. an unclosed
  // seat whose stack never got credited) be patched here instead of forcing a
  // re-export of the CSV.
  const [netOverrides, setNetOverrides] = useState(
    () => ({ ...(initialSettlement?.netOverrides || {}) })
  );

  const groupedKeys = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => g.members.forEach((m) => set.add(m)));
    return set;
  }, [groups]);

  const poolPlayers = players.filter((p) => !groupedKeys.has(keyOf(p)));

  const netOfKey = (key) => {
    const ov = netOverrides[key];
    if (ov === undefined) return netOf(entryByKey.get(key));
    return ov === '' ? 0 : Number(ov);
  };
  const setNetOverride = (key, raw) =>
    setNetOverrides((prev) => ({ ...prev, [key]: raw }));
  const clearNetOverride = (key) =>
    setNetOverrides((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });

  const groupNet = (members) => members.reduce((sum, key) => sum + netOfKey(key), 0);

  // The settleable units: one per group (its primary key) + every ungrouped player.
  const units = useMemo(() => {
    const g = groups.map((grp) => ({
      key: grp.members[0],
      name: nameFor(grp.members[0]),
      net: groupNet(grp.members)
    }));
    const p = poolPlayers.map((pl) => ({ key: keyOf(pl), name: pl.name, net: netOfKey(keyOf(pl)) }));
    return [...g, ...p];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, poolPlayers, entryByKey, netOverrides]);

  // Country from the unit's linked profile wins and locks the picker; otherwise
  // it's the reviewer-set / standing-bank-seeded value, editable here.
  const profileCountryOf = (key) => {
    const v = assignments[key];
    if (v && v !== '__create__') return profileById.get(v)?.country || null;
    return null;
  };
  const countryLocked = (key) => Boolean(profileCountryOf(key));
  const countryOf = (key) => profileCountryOf(key) || countryByKey[key] || DEFAULT_COUNTRY;

  const activeCountryCodes = useMemo(() => {
    const present = new Set(units.map((u) => countryOf(u.key)));
    return COUNTRIES.filter((c) => present.has(c.code)).map((c) => c.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, countryByKey, assignments, profileById]);

  const setUnitCountry = (key, code) => {
    if (countryLocked(key)) return;
    setCountryByKey((prev) => ({ ...prev, [key]: code }));
    setBankByCountry((prev) => {
      const next = { ...prev };
      for (const [c, bankKey] of Object.entries(next)) {
        if (bankKey === key && c !== code) delete next[c];
      }
      return next;
    });
  };

  const setCountryBank = (code, key) => {
    setBankTouched((prev) => new Set(prev).add(code));
    setBankByCountry((prev) => {
      const next = { ...prev };
      if (!key) delete next[code];
      else next[code] = key;
      return next;
    });
  };

  const toggleUnitBank = (code, key) => setCountryBank(code, bankByCountry[code] === key ? '' : key);

  // Standing bankers: for every active country the reviewer hasn't touched and
  // that has no bank yet, pick the configured banker if they're playing in it.
  useEffect(() => {
    setBankByCountry((prev) => {
      let next = prev;
      for (const { code } of COUNTRIES) {
        if (prev[code] || bankTouched.has(code) || !activeCountryCodes.includes(code)) continue;
        const hit = units.find(
          (u) =>
            countryOf(u.key) === code &&
            standingBankCountry(u.key, u.name, resolvedByKey, bankDefaultByCountry) === code
        );
        if (hit) {
          if (next === prev) next = { ...prev };
          next[code] = hit.key;
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountryCodes, units, countryByKey, assignments, profileById, bankTouched, resolvedByKey, bankDefaultByCountry]);

  // After the groups change, drop bank picks whose key stopped being its own
  // settleable unit (e.g. a merge folded that seat into another person).
  const pruneBanksFor = (nextGroups) => {
    const grouped = new Set(nextGroups.flatMap((g) => g.members));
    const unitKeys = new Set([
      ...nextGroups.map((g) => g.members[0]),
      ...players.map((p) => keyOf(p)).filter((k) => !grouped.has(k))
    ]);
    setBankByCountry((prev) => {
      let changed = false;
      const next = {};
      for (const [code, k] of Object.entries(prev)) {
        if (unitKeys.has(k)) next[code] = k;
        else changed = true;
      }
      return changed ? next : prev;
    });
  };

  // Close the merge menu on an outside click.
  useEffect(() => {
    if (!mergeMenuFor) return undefined;
    const onDoc = (e) => {
      if (mergeMenuRef.current && !mergeMenuRef.current.contains(e.target)) {
        setMergeMenuFor(null);
        setMergeFilter('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [mergeMenuFor]);

  const dropMember = (list, key) =>
    list
      .map((g) => ({
        ...g,
        source: g.members.includes(key) ? 'manual' : g.source,
        members: g.members.filter((m) => m !== key)
      }))
      .filter((g) => g.members.length > 1);

  const commitGroups = (next) => {
    setGroups(next);
    pruneBanksFor(next);
  };

  const link = (sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    const next = dropMember(groups, sourceKey);
    const targetGroup = next.find((g) => g.members.includes(targetKey));
    if (targetGroup) {
      targetGroup.members = [...targetGroup.members, sourceKey];
      targetGroup.source = 'manual';
      commitGroups([...next]);
    } else {
      commitGroups([
        ...next,
        { id: generateId(), members: [targetKey, sourceKey], source: 'manual' }
      ]);
    }
  };

  const addToGroup = (sourceKey, groupId) => {
    if (!sourceKey) return;
    const next = dropMember(groups, sourceKey);
    const target = next.find((g) => g.id === groupId);
    if (!target) return;
    target.members = [...target.members, sourceKey];
    target.source = 'manual';
    commitGroups([...next]);
  };

  const unlink = (key) => commitGroups(dropMember(groups, key));

  // Name-similarity suggestions over players not in a manual group, minus the
  // ones already applied or dismissed.
  const suggestions = useMemo(() => {
    const manualKeys = new Set(
      groups.filter((g) => g.source === 'manual').flatMap((g) => g.members)
    );
    const pool = players.filter((p) => !manualKeys.has(keyOf(p)));
    return autoGroupEntries({ entries: pool, keyOf })
      .map((g) => g.members)
      .filter((m) => m.length > 1)
      .filter((m) => !dismissedSug.has(sigOf(m)))
      .filter(
        (m) =>
          !groups.some(
            (g) => g.members.length === m.length && m.every((k) => g.members.includes(k))
          )
      );
  }, [players, groups, dismissedSug]);

  const applySuggestion = (members) => {
    const next = members.reduce((acc, k) => dropMember(acc, k), groups);
    commitGroups([...next, { id: generateId(), members: [...members], source: 'manual' }]);
  };
  const dismissSuggestion = (members) =>
    setDismissedSug((prev) => new Set(prev).add(sigOf(members)));

  const handleDragStart = (key) => (e) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key);
  };
  const handleDragEnd = () => {
    setDragKey(null);
    setDropTarget(null);
  };
  const allowDrop = (targetKey) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== targetKey) setDropTarget(targetKey);
  };

  const setUnitProfile = (key, value) => setAssignments((prev) => ({ ...prev, [key]: value }));

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Per-unit view model.
  const unitRows = useMemo(() => {
    return units.map((u) => {
      const grp = groups.find((g) => g.members[0] === u.key);
      const seats = grp ? grp.members : [u.key];
      const v = assignments[u.key] ?? '';
      const info = resolvedByKey[u.key];
      return {
        key: u.key,
        name: u.name,
        net: u.net,
        code: countryOf(u.key),
        locked: countryLocked(u.key),
        seats,
        isMerged: seats.length > 1,
        groupId: grp?.id || null,
        groupSource: grp?.source || null,
        profileValue: v,
        resolved: Boolean(v) && v !== '__create__',
        creating: v === '__create__',
        matched: Boolean(info) && v === info.playerId,
        boundCountry:
          v && v !== '__create__' ? profileById.get(v)?.country || null : null,
        isSyntheticBank: String(entryByKey.get(u.key)?.pokerNowId || '').startsWith('bank:')
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, groups, assignments, resolvedByKey, countryByKey, profileById, entryByKey]);

  const byCountry = useMemo(() => {
    const m = new Map(activeCountryCodes.map((c) => [c, []]));
    for (const r of unitRows) {
      if (!m.has(r.code)) m.set(r.code, []);
      m.get(r.code).push(r);
    }
    for (const [, list] of m) {
      // unresolved first, then biggest swing.
      list.sort((a, b) =>
        a.resolved === b.resolved ? Math.abs(b.net) - Math.abs(a.net) : a.resolved ? 1 : -1
      );
    }
    return m;
  }, [unitRows, activeCountryCodes]);

  const countryNet = (code) =>
    unitRows.filter((r) => r.code === code).reduce((s, r) => s + r.net, 0);

  const matchedCount = unitRows.filter((r) => r.resolved).length;
  const mergedSeatCount = groups.reduce((s, g) => s + g.members.length, 0);

  const trimmedId = (sessionId || '').trim();
  const totalNet = useMemo(
    () => Math.round(players.reduce((sum, p) => sum + netOfKey(keyOf(p)), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [players, netOverrides]
  );
  const isBalanced = totalNet === 0;

  const handleConfirm = () => {
    if (!trimmedId) return;

    const profileAssignments = {};
    for (const u of units) {
      const v = assignments[u.key];
      if (!v) continue;
      profileAssignments[u.key] = v === '__create__' ? { create: u.name } : { playerId: v };
    }

    const effectiveCountryByKey = {};
    const profileCountryByKey = {};
    for (const u of units) {
      const pc = profileCountryOf(u.key);
      if (pc) {
        effectiveCountryByKey[u.key] = pc;
        continue;
      }
      const c = countryByKey[u.key];
      if (c) effectiveCountryByKey[u.key] = c;
      const v = assignments[u.key];
      const willBindProfile = v === '__create__' || (v && profileById.has(v));
      if (c && willBindProfile) profileCountryByKey[u.key] = c;
    }

    onConfirm({
      sessionId: trimmedId,
      groups: groups.map((g) => g.members).filter((m) => m.length > 1),
      profileAssignments,
      countryByKey: effectiveCountryByKey,
      profileCountryByKey,
      bankByCountry,
      chipsPerCad: Number(chipsPerCad) > 0 ? Number(chipsPerCad) : 100,
      cadToUsd: Number(cadToUsd) > 0 ? Number(cadToUsd) : 1,
      netOverrides: Object.fromEntries(
        Object.keys(netOverrides).map((key) => [key, netOfKey(key)])
      )
    });
  };

  const ledgerMsg = !isBalanced
    ? `Ledger off by ${formatNet(totalNet)} — check the source CSV`
    : ledgerSource === 'file'
    ? 'From uploaded ledger CSV (exact)'
    : ledgerSource === 'fetched'
    ? 'From PokerNow ledger CSV (exact)'
    : 'Reconstructed from hand log — add the ledger CSV for exact amounts';

  const mergeCandidates = (rowKey) =>
    unitRows
      .filter((r) => r.key !== rowKey)
      .filter((r) => r.name.toLowerCase().includes(mergeFilter.trim().toLowerCase()))
      .slice(0, 8);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-900 space-y-2">
          <div className="flex justify-between items-start gap-3">
            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              Review session
            </h3>
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] font-bold px-2 py-1 rounded-md flex items-center gap-1 ${
                  isBalanced
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}
                title={ledgerMsg}
              >
                {isBalanced ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {isBalanced ? 'balanced' : `Σ net ${formatNet(totalNet)}`}
              </span>
              <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {idOpen ? (
            <div className="space-y-1">
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                spellCheck={false}
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm font-mono text-slate-200 outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-slate-600">
                {idIsFallback
                  ? "Couldn't read a PokerNow game id — using a generated one."
                  : 'From the PokerNow export. Editing it changes the saved id and the /admin/session URL.'}
              </p>
            </div>
          ) : (
            <button
              onClick={() => setIdOpen(true)}
              className="flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-slate-200"
              title="Edit session id"
            >
              {shortId(trimmedId)}
              <Pencil className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {activeCountryCodes.length === 0 && (
            <p className="text-xs text-slate-600 italic py-6 text-center">No players parsed.</p>
          )}

          {activeCountryCodes.map((code) => {
            const meta = country(code);
            const rows = byCountry.get(code) || [];
            const cNet = countryNet(code);
            const bankKey = bankByCountry[code] || '';
            const isCountryOver = dropTarget === `country:${code}`;
            return (
              <div
                key={code}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dropTarget !== `country:${code}`) setDropTarget(`country:${code}`);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const k = e.dataTransfer.getData('text/plain') || dragKey;
                  if (k) setUnitCountry(k, code);
                  handleDragEnd();
                }}
                className={`rounded-xl border transition-colors ${
                  isCountryOver ? 'border-emerald-500 bg-emerald-500/[0.06]' : 'border-slate-800'
                }`}
              >
                {/* Country subheader — owns the bank */}
                <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-800 bg-slate-950/40">
                  <span className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                    {meta.flag} {meta.name}
                    <span className="text-slate-600 text-xs font-normal">· {rows.length}</span>
                  </span>
                  <div className="flex items-center gap-2.5">
                    <div className="flex items-center gap-1.5">
                      <Landmark className={`w-3.5 h-3.5 ${bankKey ? 'text-emerald-400' : 'text-amber-500/70'}`} />
                      <select
                        value={bankKey}
                        onChange={(e) => setCountryBank(code, e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-md text-xs px-1.5 py-1 outline-none focus:border-emerald-500 text-slate-200"
                      >
                        <option value="">no bank</option>
                        {rows.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <span className={`text-xs font-bold tabular-nums w-16 text-right ${netClass(cNet)}`}>
                      {formatNet(cNet)}
                    </span>
                  </div>
                </div>

                {!bankKey && (
                  <p className="px-3 py-1.5 text-[11px] text-amber-500/80 flex items-center gap-1 border-b border-slate-800/60">
                    <AlertTriangle className="w-3 h-3" /> No bank — players in {meta.name} settle individually.
                  </p>
                )}

                {/* Unit rows */}
                <div className="divide-y divide-slate-800/60">
                  {rows.map((r) => {
                    const isOver = dropTarget === r.key && dragKey && dragKey !== r.key;
                    const isBank = bankKey === r.key;
                    const showSelect = !r.resolved || editingLinks;
                    const isExpanded = r.groupId && expanded.has(r.groupId);
                    return (
                      <div key={r.key}>
                        <div
                          draggable
                          onDragStart={handleDragStart(r.key)}
                          onDragEnd={handleDragEnd}
                          onDragOver={allowDrop(r.key)}
                          onDragLeave={() => setDropTarget(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const src = e.dataTransfer.getData('text/plain') || dragKey;
                            if (r.groupId) addToGroup(src, r.groupId);
                            else link(src, r.key);
                            handleDragEnd();
                          }}
                          className={`flex items-center gap-2 px-3 py-2 cursor-grab active:cursor-grabbing border-l-2 ${
                            isOver
                              ? 'border-l-emerald-500 bg-emerald-500/10'
                              : dragKey === r.key
                              ? 'border-l-slate-600 bg-slate-800/40 opacity-50'
                              : r.resolved
                              ? 'border-l-transparent hover:bg-slate-800/30'
                              : 'border-l-amber-500/60 bg-amber-500/[0.03] hover:bg-amber-500/[0.06]'
                          }`}
                        >
                          <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />

                          <div className="flex items-center gap-1.5 min-w-0 w-40 shrink-0">
                            <span className="text-sm text-slate-200 truncate">{r.name}</span>
                            {r.isSyntheticBank && (
                              <span className="text-[9px] uppercase font-bold text-slate-500 shrink-0">
                                didn&apos;t play
                              </span>
                            )}
                            {r.isMerged && (
                              <button
                                onClick={() => toggleExpand(r.groupId)}
                                className="flex items-center text-[10px] font-bold text-emerald-500/80 shrink-0"
                                title="Show merged seats"
                              >
                                ×{r.seats.length}
                                <ChevronRight
                                  className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                />
                              </button>
                            )}
                          </div>

                          {/* Profile link */}
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            {showSelect ? (
                              <select
                                value={r.profileValue}
                                onMouseDown={(e) => e.stopPropagation()}
                                onChange={(e) => setUnitProfile(r.key, e.target.value)}
                                className={`bg-slate-800 border rounded-md text-xs px-1.5 py-1 outline-none focus:border-emerald-500 text-slate-200 max-w-[180px] ${
                                  r.resolved ? 'border-slate-700' : 'border-amber-500/40'
                                }`}
                              >
                                <option value="">↳ link…</option>
                                <option value="__create__">＋ Create “{r.name}”</option>
                                {sortedProfiles.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.display_name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => setEditingLinks(true)}
                                className="flex items-center gap-1 text-xs text-emerald-400/90 hover:text-emerald-300 min-w-0"
                                title="Change profile link"
                              >
                                <Check className="w-3 h-3 shrink-0" />
                                <span className="truncate">
                                  {r.creating ? `Create “${r.name}”` : profileById.get(r.profileValue)?.display_name}
                                </span>
                              </button>
                            )}
                          </div>

                          {/* Bank toggle */}
                          <button
                            onClick={() => toggleUnitBank(code, r.key)}
                            title={isBank ? 'Bank for this country' : 'Make bank for this country'}
                            className={`p-1 rounded shrink-0 ${
                              isBank
                                ? 'text-emerald-400 bg-emerald-500/10'
                                : 'text-slate-600 hover:text-slate-400'
                            }`}
                          >
                            <Landmark className="w-3.5 h-3.5" />
                          </button>

                          {/* Country — only when not inherited from a profile */}
                          {r.locked ? (
                            <span
                              className="text-xs shrink-0 w-7 text-center"
                              title={`From profile · ${country(r.code).name}`}
                            >
                              {country(r.code).flag}
                            </span>
                          ) : (
                            <CountrySelect
                              value={r.code}
                              onChange={(c) => setUnitCountry(r.key, c)}
                              className="shrink-0"
                            />
                          )}

                          {/* Merge menu (keyboard-friendly alt to drag) */}
                          <div className="relative shrink-0">
                            <button
                              onClick={() => {
                                setMergeMenuFor(mergeMenuFor === r.key ? null : r.key);
                                setMergeFilter('');
                              }}
                              title="Merge with another player"
                              className="p-1 rounded text-slate-600 hover:text-emerald-400"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                            {mergeMenuFor === r.key && (
                              <div
                                ref={mergeMenuRef}
                                className="absolute right-0 top-full mt-1 z-10 w-52 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-1.5 space-y-1"
                              >
                                <input
                                  autoFocus
                                  value={mergeFilter}
                                  onChange={(e) => setMergeFilter(e.target.value)}
                                  placeholder="merge into…"
                                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-500"
                                />
                                <div className="max-h-40 overflow-y-auto">
                                  {mergeCandidates(r.key).map((t) => (
                                    <button
                                      key={t.key}
                                      onClick={() => {
                                        link(r.key, t.key);
                                        setMergeMenuFor(null);
                                        setMergeFilter('');
                                      }}
                                      className="w-full text-left px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 rounded truncate"
                                    >
                                      {t.name}
                                    </button>
                                  ))}
                                  {mergeCandidates(r.key).length === 0 && (
                                    <p className="px-2 py-1 text-xs text-slate-600">No match.</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {r.isMerged ? (
                            <span className={`text-sm font-bold tabular-nums w-16 text-right shrink-0 ${netClass(r.net)}`}>
                              {formatNet(r.net)}
                            </span>
                          ) : (
                            <NetInput
                              value={netOverrides[r.key] ?? r.net}
                              overridden={netOverrides[r.key] !== undefined}
                              onChange={(raw) => setNetOverride(r.key, raw)}
                              onReset={() => clearNetOverride(r.key)}
                              className="w-16 text-sm font-bold"
                            />
                          )}
                        </div>

                        {/* Merged seats */}
                        {isExpanded && (
                          <div className="flex flex-wrap gap-1.5 px-3 pb-2 pl-8">
                            {r.seats.map((key, idx) => {
                              const mNet = netOfKey(key);
                              return (
                                <span
                                  key={key}
                                  draggable
                                  onDragStart={handleDragStart(key)}
                                  onDragEnd={handleDragEnd}
                                  className="group inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg pl-2 pr-1 py-0.5 text-xs cursor-grab active:cursor-grabbing"
                                >
                                  <span className="text-slate-300">{nameFor(key)}</span>
                                  {idx === 0 && (
                                    <span className="text-[9px] uppercase font-bold text-emerald-500/80">primary</span>
                                  )}
                                  <NetInput
                                    value={netOverrides[key] ?? mNet}
                                    overridden={netOverrides[key] !== undefined}
                                    onChange={(raw) => setNetOverride(key, raw)}
                                    onReset={() => clearNetOverride(key)}
                                    className="w-14 font-semibold"
                                  />
                                  <button
                                    onClick={() => unlink(key)}
                                    title="Unlink"
                                    className="ml-0.5 p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                                  >
                                    <Unlink className="w-3 h-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {rows.length === 0 && (
                    <p className="px-3 py-2 text-xs text-slate-600 italic">No players in {meta.name}.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Utility strip */}
        <div className="border-t border-slate-800 bg-slate-950/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-3 text-slate-400">
            <label className="flex items-center gap-1.5">
              <input
                type="number"
                min="1"
                value={chipsPerCad}
                onChange={(e) => setChipsPerCad(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-14 bg-slate-800 border border-slate-700 rounded-md px-1.5 py-0.5 text-slate-200 text-xs outline-none focus:border-emerald-500 text-center [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              chips = 1 CAD
            </label>
            <label className="flex items-center gap-1.5">
              1 CAD =
              <input
                type="number"
                min="0"
                step="0.01"
                value={cadToUsd}
                onChange={(e) => setCadToUsdOverride(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-16 bg-slate-800 border border-slate-700 rounded-md px-1.5 py-0.5 text-slate-200 text-xs outline-none focus:border-emerald-500 text-center [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              USD
              {cadToUsdOverride == null && cadToUsdIsLive && (
                <span className="text-[10px] uppercase font-bold text-emerald-500/70">live</span>
              )}
            </label>
          </div>

          <div className="flex items-center gap-3">
            {matchedCount < unitRows.length && (
              <span className="text-slate-500">{unitRows.length - matchedCount} unlinked</span>
            )}
            {matchedCount > 0 && (
              <button
                onClick={() => setEditingLinks((v) => !v)}
                className="text-slate-400 hover:text-slate-200"
              >
                {editingLinks ? 'done editing links' : 'edit links'}
              </button>
            )}
            {suggestions.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setSuggestOpen((v) => !v)}
                  className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-semibold"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Auto-link · {suggestions.length}
                </button>
                {suggestOpen && (
                  <div className="absolute right-0 bottom-full mb-1 z-10 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-2 space-y-1.5">
                    <p className="text-[11px] text-slate-500 px-1">Merge look-alike names?</p>
                    {suggestions.map((m) => (
                      <div
                        key={sigOf(m)}
                        className="flex items-center justify-between gap-2 rounded-md bg-slate-900/60 px-2 py-1.5"
                      >
                        <span className="text-xs text-slate-300 truncate">
                          {m.map((k) => nameFor(k)).join(' + ')}
                        </span>
                        <span className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => applySuggestion(m)}
                            className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300"
                          >
                            merge
                          </button>
                          <button
                            onClick={() => dismissSuggestion(m)}
                            className="p-0.5 text-slate-500 hover:text-slate-300"
                            title="Dismiss"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 bg-slate-900">
          {error && <p className="px-4 pt-3 text-xs text-rose-400">{error}</p>}
          <div className="p-4 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {unitRows.length} unit{unitRows.length === 1 ? '' : 's'} · {matchedCount} matched
              {groups.length > 0 && ` · ${mergedSeatCount} seats merged`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onCancel}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-xl text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!trimmedId}
                title={isBalanced ? undefined : ledgerMsg}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-50 ${
                  isBalanced
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white disabled:hover:bg-emerald-600'
                    : 'bg-amber-600 hover:bg-amber-500 text-white'
                }`}
              >
                {isBalanced ? 'Create session' : 'Create anyway'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
