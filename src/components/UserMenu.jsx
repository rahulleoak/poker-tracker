import { useState } from 'react';
import { User, LogOut, Link as LinkIcon, Shield, CheckCircle2 } from 'lucide-react';
import { useAuth } from './useAuth';
import { supabase } from '../utils/supabase';

export default function UserMenu({ onOpenAuthModal }) {
  const { user, profile, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [platform, setPlatform] = useState('pokernow');
  const [externalId, setExternalId] = useState('');
  const [linking, setLinking] = useState(false);
  const [linkSuccess, setLinkSuccess] = useState(null);

  if (!user) {
    return (
      <button
        onClick={onOpenAuthModal}
        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
      >
        <User className="w-4 h-4" />
        <span>Sign In</span>
      </button>
    );
  }

  const handleLinkExternalId = async (e) => {
    e.preventDefault();
    if (!externalId.trim()) return;
    setLinking(true);
    setLinkSuccess(null);

    try {
      const { error } = await supabase
        .from('external_player_ids')
        .insert([{ user_id: user.id, platform, external_id: externalId.trim() }]);

      if (error) throw error;
      setLinkSuccess(`Successfully linked ${platform} ID: ${externalId}! Historical ledger stats backfilled.`);
      setExternalId('');
    } catch (err) {
      alert(`Failed to link ID: ${err.message}`);
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 p-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold flex items-center justify-center text-xs overflow-hidden">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <span>{(profile?.display_name || user.email || 'U')[0].toUpperCase()}</span>
          )}
        </div>
        <span className="text-xs font-semibold text-slate-200 hidden md:inline pr-1">
          {profile?.display_name || user.email?.split('@')[0]}
        </span>
      </button>

      {dropdownOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-xs text-slate-400">Signed in as</p>
            <p className="text-xs font-bold text-slate-200 truncate">{user.email}</p>
          </div>

          <div className="py-1">
            <button
              onClick={() => { setDropdownOpen(false); setLinkModalOpen(true); }}
              className="w-full px-4 py-2.5 text-left text-xs font-medium text-slate-300 hover:bg-slate-800 flex items-center gap-2 transition-colors"
            >
              <LinkIcon className="w-4 h-4 text-emerald-400" />
              <span>Link External Player ID</span>
            </button>
          </div>

          <div className="border-t border-slate-800 py-1">
            <button
              onClick={() => { setDropdownOpen(false); signOut(); }}
              className="w-full px-4 py-2.5 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      {/* Link External ID Modal */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-100">Link External Player ID</h3>
                  <p className="text-xs text-slate-400">Claim your PokerNow or ClubGG handle</p>
                </div>
              </div>
              <button 
                onClick={() => setLinkModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            {linkSuccess && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{linkSuccess}</span>
              </div>
            )}

            <form onSubmit={handleLinkExternalId} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none transition-colors"
                >
                  <option value="pokernow">PokerNow</option>
                  <option value="clubgg">ClubGG</option>
                  <option value="pokerstars">PokerStars</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">External Player ID / Name in CSV</label>
                <input
                  type="text"
                  required
                  value={externalId}
                  onChange={(e) => setExternalId(e.target.value)}
                  placeholder="e.g. Hero_Player_#abc123"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={linking}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm transition-colors shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                {linking ? 'Claiming & Backfilling...' : 'Claim & Backfill Ledger Stats'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
