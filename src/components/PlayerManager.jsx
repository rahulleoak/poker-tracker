import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, Trash2, Link as LinkIcon, Unlink, Globe, ExternalLink } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { TOP_CURRENCIES } from '../utils/formatters';
import ConfirmationModal from './ConfirmationModal';

export default function PlayerManager({ players = [], playerLinks = [], onUpdate }) {
  const [newPlayerName, setNewPlayerName] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [linkPlatform, setLinkPlatform] = useState('pokernow');
  const [linkExternalId, setLinkExternalId] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingDeletePlayerId, setPendingDeletePlayerId] = useState(null);
  const [pendingUnlinkId, setPendingUnlinkId] = useState(null);

  const handleAddPlayer = async (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    setLoading(true);
    setError(null);

    const displayName = newPlayerName.trim();

    try {
      if (supabase) {
        const { error: dbErr } = await supabase
          .from('players')
          .insert([{ display_name: displayName, preferred_currency: 'USD' }]);

        if (dbErr) throw dbErr;
        setNewPlayerName('');
        onUpdate();
      } else {
        const newLocal = { id: `local-player-${Date.now()}`, display_name: displayName, preferred_currency: 'USD', created_at: new Date().toISOString() };
        const current = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        localStorage.setItem('offsuite_players', JSON.stringify([...current, newLocal]));
        setNewPlayerName('');
        onUpdate();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to create player");
    } finally {
      setLoading(false);
    }
  };

  const handleLinkIdentity = async (e) => {
    e.preventDefault();
    if (!selectedPlayerId || !linkExternalId.trim()) return;
    setLoading(true);
    setError(null);

    const externalId = linkExternalId.trim();

    try {
      if (supabase) {
        const { error: dbErr } = await supabase
          .from('player_links')
          .insert([{
            player_id: selectedPlayerId,
            platform: linkPlatform,
            external_id: externalId
          }]);

        if (dbErr) throw dbErr;
        setLinkExternalId('');
        onUpdate();
      } else {
        const newLink = {
          id: `local-link-${Date.now()}`,
          player_id: selectedPlayerId,
          platform: linkPlatform,
          external_id: externalId
        };
        const current = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]');
        localStorage.setItem('offsuite_player_links', JSON.stringify([...current, newLink]));
        setLinkExternalId('');
        onUpdate();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to link identity");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePlayer = async (playerId) => {
    setLoading(true);
    setError(null);

    try {
      if (supabase) {
        const { error: dbErr } = await supabase.from('players').delete().eq('id', playerId);
        if (dbErr) throw dbErr;
        onUpdate();
      } else {
        const currentPlayers = JSON.parse(localStorage.getItem('offsuite_players') || '[]').filter(p => p.id !== playerId);
        const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]').filter(l => l.player_id !== playerId);
        localStorage.setItem('offsuite_players', JSON.stringify(currentPlayers));
        localStorage.setItem('offsuite_player_links', JSON.stringify(currentLinks));
        onUpdate();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to delete player");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlinkIdentity = async (linkId) => {
    setLoading(true);
    setError(null);

    try {
      if (supabase) {
        const { error: dbErr } = await supabase.from('player_links').delete().eq('id', linkId);
        if (dbErr) throw dbErr;
        onUpdate();
      } else {
        const currentLinks = JSON.parse(localStorage.getItem('offsuite_player_links') || '[]').filter(l => l.id !== linkId);
        localStorage.setItem('offsuite_player_links', JSON.stringify(currentLinks));
        onUpdate();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to unlink identity");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePreferredCurrency = async (playerId, currency) => {
    setLoading(true);
    setError(null);
    try {
      if (supabase) {
        const { error: dbErr } = await supabase
          .from('players')
          .update({ preferred_currency: currency })
          .eq('id', playerId);

        if (dbErr) throw dbErr;
        onUpdate();
      } else {
        const current = JSON.parse(localStorage.getItem('offsuite_players') || '[]');
        const updated = current.map(p => p.id === playerId ? { ...p, preferred_currency: currency } : p);
        localStorage.setItem('offsuite_players', JSON.stringify(updated));
        onUpdate();
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Failed to update preferred currency");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300 font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
            <h2 className="text-xl font-bold text-white uppercase tracking-tight font-sans">
              Player Identity Management
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">
            Map multiple PokerNow IDs, nicknames, or temporary seats to a unified master profile
          </p>
        </div>
      </div>

      {error && (
        <div className="hud-corner-reticle hud-corner-rose bg-hud-card border border-rose-500/30 p-4 text-rose-400 text-xs font-mono backdrop-blur-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Creation & Linking Controls */}
        <div className="space-y-6 lg:col-span-1">
          {/* Create Player */}
          <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-xl space-y-4 backdrop-blur-xl">
            <h3 className="font-bold text-white text-xs uppercase tracking-wider font-mono flex items-center gap-2">
              <Plus className="w-4 h-4 text-emerald-400" />
              Create Master Profile
            </h3>
            <form onSubmit={handleAddPlayer} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Master Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rahul, John Doe"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-white/20 text-zinc-100 placeholder-zinc-600 px-3 py-2 outline-none focus:border-cyan-400 transition-all text-xs font-sans"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !newPlayerName.trim()}
                className="w-full py-2 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(16,185,129,0.3)]"
              >
                Create Profile
              </button>
            </form>
          </div>

          {/* Link Identity */}
          <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 p-5 shadow-xl space-y-4 backdrop-blur-xl">
            <h3 className="font-bold text-white text-xs uppercase tracking-wider font-mono flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-cyan-400" />
              Link Player ID / Alias
            </h3>
            <form onSubmit={handleLinkIdentity} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Select Profile</label>
                <select
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-white/20 text-zinc-200 px-3 py-2 outline-none focus:border-cyan-400 transition-all text-xs font-mono cursor-pointer"
                >
                  <option value="" className="bg-zinc-950 text-zinc-500">-- Choose Profile --</option>
                  {players.map(p => (
                    <option key={p.id} value={p.id} className="bg-zinc-950 text-white">{p.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Platform</label>
                <select
                  value={linkPlatform}
                  onChange={(e) => setLinkPlatform(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-white/20 text-zinc-200 px-3 py-2 outline-none focus:border-cyan-400 transition-all text-xs font-mono cursor-pointer"
                >
                  <option value="pokernow" className="bg-zinc-950 text-white">PokerNow ID (e.g. SPoLg3v...)</option>
                  <option value="alias" className="bg-zinc-950 text-white">Seat Name Alias (e.g. @RahulL)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">External ID / Value</label>
                <input
                  type="text"
                  placeholder="e.g. SPoLg3vOL- or @RahulL"
                  value={linkExternalId}
                  onChange={(e) => setLinkExternalId(e.target.value)}
                  disabled={loading}
                  className="w-full bg-black border border-white/20 text-zinc-100 placeholder-zinc-600 px-3 py-2 outline-none focus:border-cyan-400 font-mono text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !selectedPlayerId || !linkExternalId.trim()}
                className="w-full py-2 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-[0_0_10px_rgba(6,182,212,0.3)]"
              >
                Link Identity
              </button>
            </form>
          </div>
        </div>

        {/* Master Profiles & Linked IDs List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="hud-corner-reticle bg-hud-card/90 border border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl">
            <div className="px-5 py-3.5 border-b border-white/10 bg-black/60 flex items-center justify-between">
              <h3 className="font-bold text-white text-xs uppercase tracking-wider font-mono">Master Player Profiles ({players.length})</h3>
            </div>
            
            <div className="divide-y divide-white/5 max-h-[550px] overflow-y-auto">
              {players.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 font-mono text-xs uppercase tracking-wider">
                  No master profiles created yet. Create one on the left to get started.
                </div>
              ) : (
                players.map(player => {
                  const links = playerLinks.filter(l => l.player_id === player.id);
                  return (
                    <div key={player.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-white/[0.02] transition-colors">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Link 
                            to={`/players/${encodeURIComponent(player.display_name)}`} 
                            className="font-bold text-white hover:text-cyan-400 transition-colors text-sm font-sans flex items-center gap-1.5 group"
                          >
                            <span>{player.display_name}</span>
                            <ExternalLink className="w-3 h-3 text-zinc-500 group-hover:text-cyan-400 transition-colors" />
                          </Link>
                          <span className="text-[10px] font-mono bg-black border border-white/15 text-zinc-400 px-2 py-0.5">
                            ID: {player.id.substring(0, 8)}...
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {links.length === 0 ? (
                            <span className="text-xs text-zinc-500 font-mono italic">No linked external IDs or aliases.</span>
                          ) : (
                            links.map(link => (
                              <div key={link.id} className="flex items-center gap-1.5 bg-black/80 border border-white/15 px-2 py-0.5">
                                <span className="text-[9px] text-cyan-400 uppercase tracking-widest font-mono font-bold">{link.platform}:</span>
                                <span className="text-xs font-semibold text-zinc-300 font-mono">{link.external_id}</span>
                                <button
                                  onClick={() => setPendingUnlinkId(link.id)}
                                  className="text-zinc-500 hover:text-rose-400 p-0.5 ml-0.5 transition-colors"
                                  title="Unlink"
                                >
                                  <Unlink className="w-3 h-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 self-start md:self-center shrink-0">
                        <div className="flex flex-col items-start md:items-end">
                          <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider mb-1">Pref. Currency</span>
                          <select
                            value={player.preferred_currency || 'USD'}
                            onChange={(e) => handleUpdatePreferredCurrency(player.id, e.target.value)}
                            disabled={loading}
                            className="bg-black border border-white/20 text-zinc-200 text-xs font-mono font-bold px-2 py-1 outline-none focus:border-cyan-400 transition-all cursor-pointer"
                          >
                            {TOP_CURRENCIES.map(c => <option key={c} value={c} className="bg-zinc-950 text-white">{c}</option>)}
                          </select>
                        </div>

                        <button
                          onClick={() => setPendingDeletePlayerId(player.id)}
                          className="p-2 border border-white/10 hover:border-rose-500/40 text-zinc-500 hover:text-rose-400 transition-all mt-4 md:mt-0"
                          title="Delete Profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={pendingDeletePlayerId !== null}
        onClose={() => setPendingDeletePlayerId(null)}
        onConfirm={() => {
          if (pendingDeletePlayerId) {
            handleDeletePlayer(pendingDeletePlayerId);
            setPendingDeletePlayerId(null);
          }
        }}
        title="Delete Player Profile"
        message="Are you sure you want to delete this master player profile? All linked PokerNow IDs will be unlinked."
        confirmLabel="Delete"
        variant="danger"
      />

      <ConfirmationModal 
        isOpen={pendingUnlinkId !== null}
        onClose={() => setPendingUnlinkId(null)}
        onConfirm={() => {
          if (pendingUnlinkId) {
            handleUnlinkIdentity(pendingUnlinkId);
            setPendingUnlinkId(null);
          }
        }}
        title="Unlink Identity"
        message="Are you sure you want to unlink this PokerNow ID / Alias from this profile?"
        confirmLabel="Unlink"
        variant="danger"
      />
    </div>
  );
}
