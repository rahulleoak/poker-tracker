import { Link } from 'react-router-dom';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';

const LINKS = [
  { to: '/', label: 'App', description: 'Dashboard, sessions, and hand replayer.', icon: LayoutDashboard },
  { to: '/admin', label: 'Admin', description: 'Upload a PokerNow CSV to create a session.', icon: ShieldCheck },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-emerald-400">HomeGame Tracker</h1>
          <p className="text-sm text-slate-500 mt-1">Pick where you want to go.</p>
        </div>

        <nav className="space-y-3">
          {LINKS.map(({ to, label, description, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 border border-slate-800 rounded-xl p-4 hover:border-emerald-500 hover:bg-slate-800/50 transition-colors"
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-400 shrink-0">
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">{label}</p>
                <p className="text-xs text-slate-500">{description}</p>
              </div>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
