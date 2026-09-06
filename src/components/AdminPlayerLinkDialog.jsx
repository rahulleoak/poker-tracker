import { useEffect, useMemo, useState } from 'react';
import { X, Link2, Unlink, Users, GripVertical, Landmark, Sparkles } from 'lucide-react';
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

// Stable identity for an entry: a player can share a nickname with someone else
// (e.g. two "kkkush" accounts), so prefer the PokerNow / external id.
const keyOf = keyOfEntry;

function CountrySelect({ value, onChange, className = '' }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      title="Country"
      className={`bg-slate-800 border border-slate-700 rounded-md text-xs px-1.5 py-1 outline-none focus:border-emerald-500 text-slate-200 ${className}`}
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
 * Renders every parsed player as a draggable node showing its read-only net
 * profit. Dragging one node onto another links them as the same person. Each
 * player/group is also assigned a country (default Canada) and each country can
 * nominate one of its players as the bank everyone in that country settles
 * with. On confirm the caller gets { groups, countryByKey, bankByCountry,
 * chipsPerCad }.
 *
 * @param {{ entries: Array<Object>, onCancel: () => void, onConfirm: (result: Object) => void }} props
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
  profiles = [], // [{ id, display_name }] master profiles for the "link to profile" picker
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

  // Editable session id — the PokerNow game id, or a generated fallback the
  // upload flow suggested. Becomes admin_sessions.id and the /admin/session route.
  const [sessionId, setSessionId] = useState(suggestedId);

  // groups: [{ id, members: [key, ...], source }]  — first member is the primary
  // identity; `source` is 'auto' (made by the Auto-group toggle) or 'manual'
  // (dragged or curated by hand). Toggling auto-group off only clears 'auto'.
  // Seeded from `initialGroups` (member-key lists) when re-opening to overwrite.
  const [groups, setGroups] = useState(() =>
    (Array.isArray(initialGroups) ? initialGroups : [])
      .filter((m) => Array.isArray(m) && m.length > 1)
      .map((members) => ({ id: generateId(), members: [...members], source: 'manual' }))
  );
  const [dragKey, setDragKey] = useState(null);
  const [dropTarget, setDropTarget] = useState(null); // key | groupId | null
  const [autoGroupOn, setAutoGroupOn] = useState(false);

  // unitKey -> '' (none) | '__create__' | <profileId>. Seeded from entries the DB
  // already recognises, so those come pre-bound.
  const [assignments, setAssignments] = useState(() => {
    const seed = {};
    for (const [key, info] of Object.entries(resolvedByKey || {})) {
      if (info?.playerId) seed[key] = info.playerId;
    }
    return seed;
  });

  // Seed each standing banker (see adminBankDefaults) into its country, unless
  // the reviewer / a saved session already placed that seat somewhere.
  const [countryByKey, setCountryByKey] = useState(() => {
    const seeded = { ...(initialSettlement?.countryByKey || {}) };
    for (const e of entries) {
      const k = keyOfEntry(e);
      if (seeded[k]) continue;
      const code = standingBankCountry(k, e.name, resolvedByKey, bankDefaultByCountry);
      if (code) seeded[k] = code;
    }
    return seeded;
  }); // unitKey -> country code
  const [bankByCountry, setBankByCountry] = useState(initialSettlement?.bankByCountry || {}); // country code -> unitKey
  // Countries whose bank the reviewer (or a saved session) has set explicitly —
  // the standing-banker default won't overwrite these.
  const [bankTouched, setBankTouched] = useState(
    () => new Set(Object.keys(initialSettlement?.bankByCountry || {}))
  );
  const [chipsPerCad, setChipsPerCad] = useState(
    Number(initialSettlement?.chipsPerCad) > 0 ? Number(initialSettlement.chipsPerCad) : 100
  );
  // `cadToUsd` defaults to the live FX rate (same source as the main app) and is
  // overridable in the field below; `null` override means "track the live rate".
  const { cadToUsd: liveCadToUsd, isLive: cadToUsdIsLive } = useLiveCadToUsd(0.73);
  const [cadToUsdOverride, setCadToUsdOverride] = useState(
    Number(initialSettlement?.cadToUsd) > 0 ? Number(initialSettlement.cadToUsd) : null
  );
  const cadToUsd =
    cadToUsdOverride ?? (cadToUsdIsLive ? Number(liveCadToUsd.toFixed(4)) : liveCadToUsd);

  const groupedKeys = useMemo(() => {
    const set = new Set();
    groups.forEach((g) => g.members.forEach((m) => set.add(m)));
    return set;
  }, [groups]);

  const poolPlayers = players.filter((p) => !groupedKeys.has(keyOf(p)));

  const groupNet = (members) =>
    members.reduce((sum, key) => sum + netOf(entryByKey.get(key)), 0);

  // The settleable units: one per group (its primary key) + every ungrouped player.
  const units = useMemo(() => {
    const g = groups.map((grp) => ({
      key: grp.members[0],
      name: nameFor(grp.members[0]),
      net: groupNet(grp.members)
    }));
    const p = poolPlayers.map((pl) => ({ key: keyOf(pl), name: pl.name, net: netOf(pl) }));
    return [...g, ...p];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, poolPlayers, entryByKey]);

  const countryOf = (key) => countryByKey[key] || DEFAULT_COUNTRY;

  const activeCountryCodes = useMemo(() => {
    const present = new Set(units.map((u) => countryOf(u.key)));
    return COUNTRIES.filter((c) => present.has(c.code)).map((c) => c.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, countryByKey]);

  const setUnitCountry = (key, code) => {
    setCountryByKey((prev) => ({ ...prev, [key]: code }));
    // A player can't stay the bank of a country they just left.
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

  // Standing bankers: for every active country the reviewer hasn't touched and
  // that has no bank yet, pick the configured banker if they're playing in it.
  useEffect(() => {
    setBankByCountry((prev) => {
      let next = prev;
      for (const { code } of COUNTRIES) {
        if (prev[code] || bankTouched.has(code) || !activeCountryCodes.includes(code)) continue;
        const hit = units.find(
          (u) =>
            (countryByKey[u.key] || DEFAULT_COUNTRY) === code &&
            standingBankCountry(u.key, u.name, resolvedByKey, bankDefaultByCountry) === code
        );
        if (hit) {
          if (next === prev) next = { ...prev };
          next[code] = hit.key;
        }
      }
      return next;
    });
  }, [activeCountryCodes, units, countryByKey, bankTouched, resolvedByKey, bankDefaultByCountry]);

  // A group the user pulls a member out of, or adds a member to, is now
  // hand-curated — mark it 'manual' so the auto-group toggle won't discard it.
  const dropMember = (list, key) =>
    list
      .map((g) => ({
        ...g,
        source: g.members.includes(key) ? 'manual' : g.source,
        members: g.members.filter((m) => m !== key)
      }))
      .filter((g) => g.members.length > 1);

  const link = (sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    setGroups((prev) => {
      const next = dropMember(prev, sourceKey);
      const targetGroup = next.find((g) => g.members.includes(targetKey));
      if (targetGroup) {
        targetGroup.members = [...targetGroup.members, sourceKey];
        targetGroup.source = 'manual';
        return [...next];
      }
      return [...next, { id: generateId(), members: [targetKey, sourceKey], source: 'manual' }];
    });
  };

  const addToGroup = (sourceKey, groupId) => {
    if (!sourceKey) return;
    setGroups((prev) => {
      const next = dropMember(prev, sourceKey);
      const target = next.find((g) => g.id === groupId);
      if (!target) return prev;
      target.members = [...target.members, sourceKey];
      target.source = 'manual';
      return [...next];
    });
  };

  const unlink = (key) => {
    setGroups((prev) => dropMember(prev, key));
  };

  // Auto-group toggle: rebuild the 'auto' groups from name similarity over the
  // players not already in a manual group; leave manual groups untouched.
  const toggleAutoGroup = () => {
    const on = !autoGroupOn;
    setAutoGroupOn(on);

    const manual = groups.filter((g) => g.source === 'manual');
    let nextGroups = manual;
    if (on) {
      const manualKeys = new Set(manual.flatMap((g) => g.members));
      const pool = players.filter((p) => !manualKeys.has(keyOf(p)));
      const auto = autoGroupEntries({ entries: pool, keyOf }).map((g, i) => ({
        id: `${generateId()}-${i}`,
        members: [...g.members],
        source: 'auto'
      }));
      nextGroups = [...manual, ...auto];
    }
    setGroups(nextGroups);

    // Drop bank picks whose player is no longer its own settleable unit.
    const grouped = new Set(nextGroups.flatMap((g) => g.members));
    const unitKeys = new Set([
      ...nextGroups.map((g) => g.members[0]),
      ...players.map((p) => keyOf(p)).filter((k) => !grouped.has(k))
    ]);
    setBankByCountry((prev) => {
      const cleaned = {};
      for (const [code, key] of Object.entries(prev)) {
        if (unitKeys.has(key)) cleaned[code] = key;
      }
      return cleaned;
    });
  };

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

  const trimmedId = (sessionId || '').trim();

  const setUnitProfile = (key, value) => setAssignments((prev) => ({ ...prev, [key]: value }));

  const handleConfirm = () => {
    if (!trimmedId) return;

    // { unitKey -> { playerId } | { create: displayName } } for the units the
    // reviewer bound to a master profile.
    const profileAssignments = {};
    for (const u of units) {
      const v = assignments[u.key];
      if (!v) continue;
      profileAssignments[u.key] = v === '__create__' ? { create: u.name } : { playerId: v };
    }

    onConfirm({
      sessionId: trimmedId,
      groups: groups.map((g) => g.members).filter((m) => m.length > 1),
      profileAssignments,
      countryByKey,
      bankByCountry,
      chipsPerCad: Number(chipsPerCad) > 0 ? Number(chipsPerCad) : 100,
      cadToUsd: Number(cadToUsd) > 0 ? Number(cadToUsd) : 1
    });
  };

  const linkedCount = groupedKeys.size;
  const totalNet = useMemo(
    () => Math.round(players.reduce((sum, p) => sum + netOf(p), 0)),
    [players]
  );
  const isBalanced = totalNet === 0;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex justify-between items-start bg-slate-900">
          <div>
            <h3 className="font-bold text-lg text-slate-100 flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" />
              Review &amp; Link Players
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Drag a player onto another to link them. Set each player&apos;s country and pick a bank per country.
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-200 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-6 overflow-y-auto">
          {/* Session ID */}
          <div className="space-y-1.5">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Session ID</h4>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              spellCheck={false}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-2.5 py-1.5 text-sm font-mono text-slate-200 outline-none focus:border-emerald-500"
            />
            <p className="text-[11px] text-slate-600">
              {idIsFallback
                ? "Couldn't read a PokerNow game id — using a generated one. Edit if you want a specific id."
                : 'From the PokerNow export. Editing it changes the saved id and the /admin/session URL.'}
            </p>
          </div>

          {/* Linked groups */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Linked Players {groups.length > 0 && <span className="text-slate-600">· {groups.length}</span>}
            </h4>
            {groups.length === 0 ? (
              <p className="text-xs text-slate-600 italic border border-dashed border-slate-800 rounded-xl p-4 text-center">
                No linked players yet.
              </p>
            ) : (
              <div className="space-y-2">
                {groups.map((g) => {
                  const net = groupNet(g.members);
                  const isOver = dropTarget === g.id;
                  const primaryKey = g.members[0];
                  return (
                    <div
                      key={g.id}
                      onDragOver={allowDrop(g.id)}
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        addToGroup(e.dataTransfer.getData('text/plain') || dragKey, g.id);
                        handleDragEnd();
                      }}
                      className={`rounded-xl border p-3 transition-colors ${
                        isOver ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-700 bg-slate-950/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 min-w-0">
                          <Link2 className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{nameFor(primaryKey)}</span>
                          {g.source === 'auto' && (
                            <span className="flex items-center gap-0.5 text-[9px] text-slate-500 shrink-0">
                              <Sparkles className="w-2.5 h-2.5" />
                              auto
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <CountrySelect value={countryOf(primaryKey)} onChange={(c) => setUnitCountry(primaryKey, c)} />
                          <span className={`text-xs font-bold ${netClass(net)}`}>{formatNet(net)}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.members.map((key, idx) => {
                          const mNet = netOf(entryByKey.get(key));
                          return (
                            <span
                              key={key}
                              draggable
                              onDragStart={handleDragStart(key)}
                              onDragEnd={handleDragEnd}
                              className="group inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg pl-2 pr-1 py-1 text-xs cursor-grab active:cursor-grabbing"
                            >
                              <span className="text-slate-200">{nameFor(key)}</span>
                              {idx === 0 && (
                                <span className="text-[9px] uppercase font-bold text-emerald-500/80">primary</span>
                              )}
                              <span className={`font-semibold ${netClass(mNet)}`}>{formatNet(mNet)}</span>
                              <button
                                onClick={() => unlink(key)}
                                title="Unlink"
                                className="ml-0.5 p-0.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                              >
                                <Unlink className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ledger balance */}
          <div
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-xs ${
              isBalanced
                ? 'border-slate-800 bg-slate-950/50 text-slate-500'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            }`}
          >
            <span className="font-medium">
              {!isBalanced
                ? 'Ledger does not balance — check the source CSV'
                : ledgerSource === 'file'
                ? 'From uploaded ledger CSV (exact)'
                : ledgerSource === 'fetched'
                ? 'From PokerNow ledger CSV (exact)'
                : 'Reconstructed from hand log — add the ledger CSV for exact amounts'}
            </span>
            <span className={`font-bold ${isBalanced ? 'text-slate-400' : ''}`}>
              Σ net {formatNet(totalNet)}
            </span>
          </div>

          {/* Unlinked pool */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Players · {poolPlayers.length}
              </h4>
              <button
                type="button"
                onClick={toggleAutoGroup}
                aria-pressed={autoGroupOn}
                title="Group players whose names look like the same person"
                className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                  autoGroupOn
                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Auto-group
                <span
                  className={`ml-0.5 flex h-3.5 w-6 items-center rounded-full px-0.5 transition-colors ${
                    autoGroupOn ? 'bg-emerald-500/70' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full bg-white transition-transform ${
                      autoGroupOn ? 'translate-x-2.5' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {poolPlayers.map((p) => {
                const key = keyOf(p);
                const net = netOf(p);
                const isOver = dropTarget === key && dragKey && dragKey !== key;
                return (
                  <div
                    key={key}
                    draggable
                    onDragStart={handleDragStart(key)}
                    onDragEnd={handleDragEnd}
                    onDragOver={allowDrop(key)}
                    onDragLeave={() => setDropTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      link(e.dataTransfer.getData('text/plain') || dragKey, key);
                      handleDragEnd();
                    }}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors cursor-grab active:cursor-grabbing ${
                      isOver
                        ? 'border-emerald-500 bg-emerald-500/10'
                        : dragKey === key
                        ? 'border-slate-600 bg-slate-800/40 opacity-50'
                        : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                    }`}
                  >
                    <GripVertical className="w-4 h-4 text-slate-600 shrink-0" />
                    <span className="text-sm text-slate-200 truncate flex-1">
                      {p.name}
                      {String(p.pokerNowId || '').startsWith('bank:') && (
                        <span className="ml-1.5 text-[10px] uppercase font-bold text-slate-500">didn&apos;t play · bank</span>
                      )}
                    </span>
                    <CountrySelect value={countryOf(key)} onChange={(c) => setUnitCountry(key, c)} />
                    <span className={`text-sm font-bold shrink-0 ${netClass(net)}`}>{formatNet(net)}</span>
                  </div>
                );
              })}
              {poolPlayers.length === 0 && (
                <p className="text-xs text-slate-600 italic col-span-full py-2">All players linked.</p>
              )}
            </div>
          </div>

          {/* Profiles — link each unit to a saved master player profile */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Link2 className="w-3.5 h-3.5" /> Profiles
              <span className="text-slate-600 normal-case font-normal tracking-normal">
                · link to a saved player (optional)
              </span>
            </h4>
            <div className="space-y-1.5">
              {units.map((u) => {
                const resolved = resolvedByKey[u.key];
                const value = assignments[u.key] ?? '';
                return (
                  <div
                    key={u.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-200 truncate flex items-center gap-1.5">
                      {u.name}
                      {resolved && value === resolved.playerId && (
                        <span className="text-[10px] uppercase font-bold text-emerald-500/80">matched</span>
                      )}
                    </span>
                    <select
                      value={value}
                      onChange={(e) => setUnitProfile(u.key, e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded-md text-xs px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 max-w-[55%]"
                    >
                      <option value="">— no profile —</option>
                      <option value="__create__">＋ Create “{u.name}”</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Banks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Landmark className="w-3.5 h-3.5" /> Banks
              </h4>
              <div className="flex items-center gap-3">
                <label className="text-xs text-slate-400 flex items-center gap-1.5">
                  <input
                    type="number"
                    min="1"
                    value={chipsPerCad}
                    onChange={(e) => setChipsPerCad(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-16 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-slate-200 text-xs outline-none focus:border-emerald-500 text-center [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  chips = 1 CAD
                </label>
                <label className="text-xs text-slate-400 flex items-center gap-1.5">
                  1 CAD =
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cadToUsd}
                    onChange={(e) => setCadToUsdOverride(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-16 bg-slate-800 border border-slate-700 rounded-md px-2 py-1 text-slate-200 text-xs outline-none focus:border-emerald-500 text-center [-moz-appearance:_textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  USD
                  {cadToUsdOverride == null && cadToUsdIsLive && (
                    <span className="text-[10px] uppercase font-bold text-emerald-500/70">live</span>
                  )}
                </label>
              </div>
            </div>
            {activeCountryCodes.length === 0 ? (
              <p className="text-xs text-slate-600 italic">No players yet.</p>
            ) : (
              <div className="space-y-1.5">
                {activeCountryCodes.map((code) => {
                  const meta = country(code);
                  const countryUnits = units.filter((u) => countryOf(u.key) === code);
                  return (
                    <div
                      key={code}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                    >
                      <span className="text-sm text-slate-200">
                        {meta.flag} {meta.name}
                        <span className="text-slate-600 text-xs"> · {countryUnits.length}</span>
                      </span>
                      <select
                        value={bankByCountry[code] || ''}
                        onChange={(e) => setCountryBank(code, e.target.value)}
                        className="bg-slate-800 border border-slate-700 rounded-md text-xs px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 max-w-[55%]"
                      >
                        <option value="">No bank</option>
                        {countryUnits.map((u) => (
                          <option key={u.key} value={u.key}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-800 bg-slate-900">
          {error && (
            <p className="px-4 pt-3 text-xs text-rose-400">{error}</p>
          )}
          <div className="p-4 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">
              {linkedCount > 0
                ? `${linkedCount} player${linkedCount === 1 ? '' : 's'} linked into ${groups.length} profile${
                    groups.length === 1 ? '' : 's'
                  }`
                : 'No links — all players kept separate'}
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
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition-colors"
              >
                Create Session
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
