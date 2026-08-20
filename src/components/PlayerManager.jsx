import { useState } from 'react';
import { Users, Plus, Trash2, Link, Unlink } from 'lucide-react';
import { supabase } from '../utils/supabase';

export default function PlayerManager({ players, playerLinks, onUpdate }) {
  const [newPlayerName, setNewPlayerName] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const [linkPlatform, setLinkPlatform] = useState('pokernow');
  const [linkExternalId, setLinkExternalId] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleAddPlayer = async (e) => {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    setLoading(true);
    setError(null);

    const displayName = newPlayerName.trim();

    try {
      if (supabase) {
        const { data, error: dbErr } = await supabase
          .from('players')
          .insert([{ display_name: displayName }])
          .select()
          .single();

        if (dbErr) throw dbErr;
        setNewPlayerName('');
        onUpdate();
      } else {
        // Offline-only mock
        const newLocal = { id: `local-player-${Date.now()}`, display_name: displayName, created_at: new Date().toISOString() };
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
        // Offline-only mock
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
    if (!window.confirm("Are you sure you want to delete this player profile? This will unlink all associated IDs.")) return;
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
    if (!window.confirm("Are you sure you want to unlink this identity?")) return;
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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-emerald-400" />
            Player Identities Manager
          </h2>
          <p className="text-sm text-slate-400">Map multiple PokerNow Player IDs, nicknames, or temporary seats to a unified master profile.</p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm rounded-xl">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Creation & Linking Controls */}
        <div className="space-y-6 lg:col-span-1">
          {/* Create Player */}
          <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl space-y-4">
            <h3 className="font-bold text-slate-200 text-lg flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              Create Master Profile
            </h3>
            <form onSubmit={handleAddPlayer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Master Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Rahul, John Doe"
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  disabled={loading}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 transition-all text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !newPlayerName.trim()}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-emerald-900/10"
              >
                Create Profile
              </button>
            </form>
          </div>

          {/* Link Identity */}
          <div className="bg-slate-900 border border-slate-800/80 p-6 rounded-2xl shadow-xl space-y-4">
            <h3 className="font-bold text-slate-200 text-lg flex items-center gap-2">
              <Link className="w-5 h-5 text-emerald-400" />
              Link Player ID / Alias
            </h3>
            <form onSubmit={handleLinkIdentity} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Select Profile</label>
                <select
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                  disabled={loading}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 transition-all text-sm font-medium"
                >
                  <option value="">-- Choose Profile --</option>
                  {players.map(p => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Platform</label>
                <select
                  value={linkPlatform}
                  onChange={(e) => setLinkPlatform(e.target.value)}
                  disabled={loading}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 transition-all text-sm font-medium"
                >
                  <option value="pokernow">PokerNow ID (e.g. SPoLg3v...)</option>
                  <option value="alias">Seat Name Alias (e.g. @RahulL)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">External ID / Value</label>
                <input
                  type="text"
                  placeholder="e.g. SPoLg3vOL- or @RahulL"
                  value={linkExternalId}
                  onChange={(e) => setLinkExternalId(e.target.value)}
                  disabled={loading}
                  className="w-full bg-slate-950 border border-slate-800 text-slate-100 placeholder-slate-600 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 transition-all text-sm font-medium"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !selectedPlayerId || !linkExternalId.trim()}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:hover:bg-emerald-600 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-emerald-900/10"
              >
                Link Identity
              </button>
            </form>
          </div>
        </div>

        {/* Master Profiles & Linked IDs List */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-900 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/40">
              <h3 className="font-bold text-slate-100">Master Player Profiles</h3>
            </div>
            
            <div className="divide-y divide-slate-800/60 max-h-[500px] overflow-y-auto">
              {players.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  No master profiles created yet. Create one on the left to get started!
                </div>
              ) : (
                players.map(player => {
                  const links = playerLinks.filter(l => l.player_id === player.id);
                  return (
                    <div key={player.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-800/10 transition-colors">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-100 text-base">{player.display_name}</h4>
                          <span className="text-[10px] bg-slate-800 text-slate-400 font-semibold px-2 py-0.5 rounded-full">ID: {player.id.substring(0, 8)}...</span>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                          {links.length === 0 ? (
                            <span className="text-xs text-slate-500 italic">No linked external IDs or aliases.</span>
                          ) : (
                            links.map(link => (
                              <div key={link.id} className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-xl">
                                <span className="text-[10px] text-emerald-400 uppercase tracking-wider font-bold">{link.platform}:</span>
                                <span className="text-xs font-semibold text-slate-300 font-mono">{link.external_id}</span>
                                <button
                                  onClick={() => handleUnlinkIdentity(link.id)}
                                  className="text-slate-500 hover:text-rose-400 p-0.5 ml-0.5 transition-colors"
                                  title="Unlink"
                                >
                                  <Unlink className="w-3 h-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                      
                      <button
                        onClick={() => handleDeletePlayer(player.id)}
                        className="p-2 border border-slate-800 hover:border-rose-500/20 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/5 transition-all self-start md:self-center"
                        title="Delete Profile"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
