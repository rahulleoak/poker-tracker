import React, { useState, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, 
  History, 
  Plus, 
  Users, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  Trash2,
  ChevronLeft,
  Upload
} from 'lucide-react';

// --- MOCK DATA ---
const INITIAL_GAMES = [
  {
    id: 'game-1',
    date: '2026-06-15',
    entries: [
      { name: 'Mike', buyIn: 100, cashOut: 350 },
      { name: 'Sarah', buyIn: 100, cashOut: 0 },
      { name: 'John', buyIn: 200, cashOut: 50 },
      { name: 'Emma', buyIn: 50, cashOut: 50 },
    ]
  },
  {
    id: 'game-2',
    date: '2026-06-22',
    entries: [
      { name: 'Mike', buyIn: 200, cashOut: 0 },
      { name: 'Sarah', buyIn: 100, cashOut: 450 },
      { name: 'John', buyIn: 150, cashOut: 0 },
    ]
  }
];

// --- POKER NOW CSV PARSER ---
function parsePokerNowCSV(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length === 0) return [];

  const players = {}; 

  const getPlayer = (rawName) => {
    // Poker now names are often "Name @ hashID", we just want the name
    const cleanName = rawName.split(' @ ')[0].trim();
    if (!players[cleanName]) {
      players[cleanName] = { buyIn: 0, cashOut: 0 };
    }
    return players[cleanName];
  };

  const header = lines[0].toLowerCase();
  
  // STRATEGY 1: POKER NOW LEDGER EXPORT
  if (header.includes('player_nickname') && header.includes('buy_in')) {
    // Regex splits by comma but ignores commas inside quotes
    const headerCols = lines[0].toLowerCase().split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
    const nameIdx = headerCols.indexOf('player_nickname');
    const buyInIdx = headerCols.indexOf('buy_in');
    const buyOutIdx = headerCols.indexOf('buy_out');

    if (nameIdx > -1 && buyInIdx > -1) {
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
        if (cols.length > Math.max(nameIdx, buyInIdx, buyOutIdx)) {
          const buyIn = parseFloat(cols[buyInIdx]) || 0;
          const cashOut = parseFloat(cols[buyOutIdx]) || 0;
          if (buyIn > 0 || cashOut > 0) {
            const p = getPlayer(cols[nameIdx]);
            p.buyIn += buyIn;
            p.cashOut += cashOut;
          }
        }
      }
    }
  } 
  // STRATEGY 2: POKER NOW HAND HISTORY LOG EXPORT
  else {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      
      // Approvals (Initial buy in)
      let m = line.match(/approved the player "([^"]+)" participation with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);

      // Add-ons (Requested stack)
      m = line.match(/approved the player "([^"]+)" requested stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);

      // Sits down (Buy in)
      m = line.match(/player "([^"]+)" sits down with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).buyIn += parseInt(m[2], 10);

      // Quits (Cash out)
      m = line.match(/player "([^"]+)" quits the game with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).cashOut += parseInt(m[2], 10);

      // Stands up (Cash out)
      m = line.match(/player "([^"]+)" stands up with a stack of (\d+)/i);
      if (m) getPlayer(m[1]).cashOut += parseInt(m[2], 10);

      // Admin manual stack update
      m = line.match(/updated the player "([^"]+)" stack from (\d+) to (\d+)/i);
      if (m) {
        const from = parseInt(m[2], 10);
        const to = parseInt(m[3], 10);
        if (to > from) getPlayer(m[1]).buyIn += (to - from);
        if (from > to) getPlayer(m[1]).cashOut += (from - to);
      }
    }
  }

  return Object.entries(players).map(([name, data]) => ({
    name,
    buyIn: data.buyIn,
    cashOut: data.cashOut
  })).filter(p => p.buyIn > 0 || p.cashOut > 0);
}

export default function App() {
  const [games, setGames] = useState(INITIAL_GAMES);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [editingGameId, setEditingGameId] = useState(null);

  // --- DERIVED STATS (ALL-TIME) ---
  const playerStats = useMemo(() => {
    const stats = {};
    games.forEach(game => {
      game.entries.forEach(entry => {
        if (!stats[entry.name]) {
          stats[entry.name] = { name: entry.name, buyIn: 0, cashOut: 0, gamesPlayed: 0, net: 0 };
        }
        stats[entry.name].buyIn += entry.buyIn;
        stats[entry.name].cashOut += entry.cashOut;
        stats[entry.name].net += (entry.cashOut - entry.buyIn);
        stats[entry.name].gamesPlayed += 1;
      });
    });
    return Object.values(stats).sort((a, b) => b.net - a.net);
  }, [games]);

  const totalMoneyInPlay = useMemo(() => {
    return games.reduce((sum, game) => sum + game.entries.reduce((s, e) => s + e.buyIn, 0), 0);
  }, [games]);

  // --- HANDLERS ---
  const handleCreateGame = () => {
    const newGame = {
      id: `game-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      entries: [
        { name: '', buyIn: 0, cashOut: 0 },
        { name: '', buyIn: 0, cashOut: 0 }
      ]
    };
    setGames([newGame, ...games]);
    setEditingGameId(newGame.id);
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const parsedEntries = parsePokerNowCSV(text);
      
      const newGame = {
        id: `game-${Date.now()}`,
        // Use file creation date if available, otherwise today
        date: file.lastModified ? new Date(file.lastModified).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        entries: parsedEntries.length > 0 ? parsedEntries : [
          { name: '', buyIn: 0, cashOut: 0 },
          { name: '', buyIn: 0, cashOut: 0 }
        ]
      };
      
      setGames([newGame, ...games]);
      setEditingGameId(newGame.id);
    };
    reader.readAsText(file);
    event.target.value = null; // reset input
  };

  const handleUpdateGame = (updatedGame) => {
    setGames(games.map(g => g.id === updatedGame.id ? updatedGame : g));
  };

  const handleDeleteGame = (id) => {
    setGames(games.filter(g => g.id !== id));
    if (editingGameId === id) setEditingGameId(null);
  };

  // --- RENDERERS ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-emerald-500/30">
      {/* Navbar */}
      <nav className="bg-slate-900 border-b border-slate-800 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400 font-bold text-xl tracking-tight">
            <DollarSign className="w-6 h-6" />
            <span>HomeGame Tracker</span>
          </div>
          <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg">
            <button 
              onClick={() => { setActiveTab('dashboard'); setEditingGameId(null); }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'dashboard' && !editingGameId ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </button>
            <button 
              onClick={() => { setActiveTab('games'); setEditingGameId(null); }}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
                (activeTab === 'games' || editingGameId) ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Sessions</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {editingGameId ? (
          <GameEditor 
            game={games.find(g => g.id === editingGameId)} 
            onSave={handleUpdateGame}
            onBack={() => setEditingGameId(null)}
            onDelete={() => handleDeleteGame(editingGameId)}
          />
        ) : activeTab === 'dashboard' ? (
          <Dashboard stats={playerStats} totalSessions={games.length} totalMoney={totalMoneyInPlay} />
        ) : (
          <GamesList games={games} onCreate={handleCreateGame} onFileUpload={handleFileUpload} onEdit={setEditingGameId} />
        )}
      </main>
    </div>
  );
}

// ==========================================
// COMPONENT: DASHBOARD
// ==========================================
function Dashboard({ stats, totalSessions, totalMoney }) {
  const topWinner = stats.length > 0 && stats[0].net > 0 ? stats[0] : null;
  const topLoser = stats.length > 0 && stats[stats.length - 1].net < 0 ? stats[stats.length - 1] : null;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* Top Level Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard title="Total Sessions" value={totalSessions} icon={<History className="w-5 h-5 text-blue-400" />} />
        <MetricCard title="Total Money Wagered" value={`$${totalMoney}`} icon={<DollarSign className="w-5 h-5 text-emerald-400" />} />
        <MetricCard 
          title="Top Shark" 
          value={topWinner ? topWinner.name : '-'} 
          subtitle={topWinner ? `+$${topWinner.net}` : ''}
          icon={<Users className="w-5 h-5 text-amber-400" />} 
        />
        <MetricCard 
          title="Biggest Donor" 
          value={topLoser ? topLoser.name : '-'} 
          subtitle={topLoser ? `-$${Math.abs(topLoser.net)}` : ''}
          valueColor="text-rose-400"
          icon={<Users className="w-5 h-5 text-rose-400" />} 
        />
      </div>

      {/* Leaderboard */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-100">All-Time Leaderboard</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-950/50 text-slate-400 text-sm">
                <th className="p-4 font-medium">Rank</th>
                <th className="p-4 font-medium">Player</th>
                <th className="p-4 font-medium text-right">Games</th>
                <th className="p-4 font-medium text-right">Total In</th>
                <th className="p-4 font-medium text-right">Total Out</th>
                <th className="p-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {stats.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-500">No data available yet. Play some games!</td>
                </tr>
              ) : (
                stats.map((player, index) => (
                  <tr key={player.name} className="hover:bg-slate-800/20 transition-colors">
                    <td className="p-4 font-medium text-slate-500">#{index + 1}</td>
                    <td className="p-4 font-semibold text-slate-200">{player.name}</td>
                    <td className="p-4 text-right text-slate-400">{player.gamesPlayed}</td>
                    <td className="p-4 text-right text-slate-400">${player.buyIn}</td>
                    <td className="p-4 text-right text-slate-400">${player.cashOut}</td>
                    <td className={`p-4 text-right font-bold ${player.net > 0 ? 'text-emerald-400' : player.net < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      {player.net > 0 ? '+' : ''}{player.net === 0 ? '$0' : `$${player.net}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, valueColor = "text-slate-100" }) {
  return (
    <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl shadow-lg relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
      <h3 className={`text-2xl font-bold ${valueColor}`}>{value}</h3>
      {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

// ==========================================
// COMPONENT: GAMES LIST
// ==========================================
function GamesList({ games, onCreate, onFileUpload, onEdit }) {
  const fileInputRef = useRef(null);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-100">Poker Sessions</h2>
        <div className="flex flex-wrap gap-3">
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={onFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button 
            onClick={onCreate}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            <Plus className="w-4 h-4" />
            Log New Session
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map(game => {
          const totalBuyIn = game.entries.reduce((sum, e) => sum + e.buyIn, 0);
          const totalCashOut = game.entries.reduce((sum, e) => sum + e.cashOut, 0);
          const isBalanced = totalBuyIn === totalCashOut;
          
          return (
            <div 
              key={game.id} 
              onClick={() => onEdit(game.id)}
              className="bg-slate-900 border border-slate-800 p-5 rounded-xl cursor-pointer hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/10 transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-slate-200">{new Date(game.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</h3>
                  <p className="text-sm text-slate-500">{game.entries.length} Players</p>
                </div>
                {isBalanced ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                )}
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-slate-400">Total Pot: <span className="font-semibold text-slate-200">${totalBuyIn}</span></span>
                <span className="text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 text-xs font-medium">
                  View Ledger <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          );
        })}
        {games.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
            No sessions logged yet. Create your first game!
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENT: GAME EDITOR & SETTLEMENTS
// ==========================================
function GameEditor({ game, onSave, onBack, onDelete }) {
  const [date, setDate] = useState(game.date);
  const [entries, setEntries] = useState(game.entries);

  // Derived calculations for the current session
  const { totalBuyIn, totalCashOut, isBalanced, settlements } = useMemo(() => {
    let tBuyIn = 0;
    let tCashOut = 0;
    const nets = [];

    entries.forEach((e, index) => {
      // Ensure numeric values
      const buyIn = Number(e.buyIn) || 0;
      const cashOut = Number(e.cashOut) || 0;
      
      tBuyIn += buyIn;
      tCashOut += cashOut;
      
      const net = cashOut - buyIn;
      if (e.name.trim() !== '') {
        nets.push({ name: e.name, net, id: index });
      }
    });

    const balanced = tBuyIn === tCashOut && tBuyIn > 0;
    let trans = [];

    // Settlement Algorithm (Greedy)
    if (balanced) {
      let debtors = nets.filter(p => p.net < 0).map(p => ({ ...p, amount: Math.abs(p.net) })).sort((a,b) => b.amount - a.amount);
      let creditors = nets.filter(p => p.net > 0).map(p => ({ ...p, amount: p.net })).sort((a,b) => b.amount - a.amount);
      
      let d = 0;
      let c = 0;
      
      while (d < debtors.length && c < creditors.length) {
        let debtor = debtors[d];
        let creditor = creditors[c];
        
        let amount = Math.min(debtor.amount, creditor.amount);
        
        if (amount > 0) {
          trans.push({ from: debtor.name, to: creditor.name, amount });
        }
        
        debtor.amount -= amount;
        creditor.amount -= amount;
        
        if (debtor.amount === 0) d++;
        if (creditor.amount === 0) c++;
      }
    }

    return { totalBuyIn: tBuyIn, totalCashOut: tCashOut, isBalanced: balanced, settlements: trans };
  }, [entries]);

  // Handlers
  const handleEntryChange = (index, field, value) => {
    const newEntries = [...entries];
    newEntries[index][field] = value;
    setEntries(newEntries);
    onSave({ ...game, date, entries: newEntries });
  };

  const handleAddRow = () => {
    const newEntries = [...entries, { name: '', buyIn: 0, cashOut: 0 }];
    setEntries(newEntries);
    onSave({ ...game, date, entries: newEntries });
  };

  const handleRemoveRow = (index) => {
    const newEntries = entries.filter((_, i) => i !== index);
    setEntries(newEntries);
    onSave({ ...game, date, entries: newEntries });
  };

  const handleDateChange = (e) => {
    setDate(e.target.value);
    onSave({ ...game, date: e.target.value, entries });
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-800 rounded-full transition-colors text-slate-400 hover:text-slate-200">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Session Ledger</h2>
            <div className="flex items-center gap-2 mt-1">
              <input 
                type="date" 
                value={date} 
                onChange={handleDateChange}
                className="bg-slate-800/50 border border-slate-700 text-slate-300 text-sm rounded-md px-2 py-1 outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>
        </div>
        <button 
          onClick={onDelete}
          className="text-rose-400 hover:text-rose-300 hover:bg-rose-400/10 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 self-start sm:self-auto"
        >
          <Trash2 className="w-4 h-4" />
          Delete Session
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Ledger Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 bg-slate-950/50 border-b border-slate-800 flex justify-between items-center">
             <div className="flex gap-4">
               <div className="text-sm">
                 <span className="text-slate-500 block mb-1">Total Buy-ins</span>
                 <span className="font-bold text-lg text-slate-200">${totalBuyIn}</span>
               </div>
               <div className="text-sm">
                 <span className="text-slate-500 block mb-1">Total Cashed Out</span>
                 <span className={`font-bold text-lg ${isBalanced ? 'text-slate-200' : 'text-rose-400'}`}>${totalCashOut}</span>
               </div>
             </div>
             <div>
                {totalBuyIn > 0 && isBalanced ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium border border-emerald-500/20">
                    <CheckCircle2 className="w-4 h-4" /> Ledger Balanced
                  </span>
                ) : totalBuyIn > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 text-sm font-medium border border-rose-500/20">
                    <AlertCircle className="w-4 h-4" /> Unbalanced (${Math.abs(totalBuyIn - totalCashOut)} diff)
                  </span>
                ) : null}
             </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-900 text-slate-400 text-sm border-b border-slate-800">
                  <th className="p-4 font-medium w-1/3">Player Name</th>
                  <th className="p-4 font-medium w-1/4">Buy In ($)</th>
                  <th className="p-4 font-medium w-1/4">Cash Out ($)</th>
                  <th className="p-4 font-medium text-right w-1/6">Net</th>
                  <th className="p-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {entries.map((entry, index) => {
                  const net = (Number(entry.cashOut) || 0) - (Number(entry.buyIn) || 0);
                  return (
                    <tr key={index} className="hover:bg-slate-800/20 group">
                      <td className="p-3">
                        <input 
                          type="text" 
                          placeholder="Player name..."
                          value={entry.name}
                          onChange={(e) => handleEntryChange(index, 'name', e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all placeholder:text-slate-600"
                        />
                      </td>
                      <td className="p-3">
                        <input 
                          type="number" 
                          min="0"
                          value={entry.buyIn || ''}
                          onChange={(e) => handleEntryChange(index, 'buyIn', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500 transition-all"
                        />
                      </td>
                      <td className="p-3">
                        <input 
                          type="number" 
                          min="0"
                          value={entry.cashOut || ''}
                          onChange={(e) => handleEntryChange(index, 'cashOut', e.target.value === '' ? 0 : Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 outline-none focus:border-emerald-500 transition-all"
                        />
                      </td>
                      <td className={`p-3 text-right font-bold ${net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                        {net > 0 ? '+' : ''}{net}
                      </td>
                      <td className="p-3 text-right">
                        <button 
                          onClick={() => handleRemoveRow(index)}
                          className="text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="p-4 border-t border-slate-800 bg-slate-900/50">
            <button 
              onClick={handleAddRow}
              className="text-sm font-medium text-slate-400 hover:text-emerald-400 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Player Row
            </button>
          </div>
        </div>

        {/* Settlement Panel */}
        <div className="lg:col-span-1">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl h-full flex flex-col">
            <div className="p-5 border-b border-slate-800 bg-slate-950/50">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-400" />
                Settlements
              </h3>
              <p className="text-xs text-slate-500 mt-1">Who pays who to square up.</p>
            </div>
            
            <div className="p-5 flex-1 flex flex-col">
              {!isBalanced || totalBuyIn === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-3 py-8">
                  <AlertCircle className="w-10 h-10 text-slate-700" />
                  <p className="text-sm">Ledger must be balanced before settlements can be calculated.</p>
                </div>
              ) : settlements.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500 space-y-3 py-8">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500/50" />
                  <p className="text-sm">Everyone broke even! No payouts needed.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {settlements.map((tx, i) => (
                    <div key={i} className="flex items-center justify-between p-3 bg-slate-950 border border-slate-800 rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-rose-400 text-sm">{tx.from}</span>
                        <ArrowRight className="w-4 h-4 text-slate-600" />
                        <span className="font-semibold text-emerald-400 text-sm">{tx.to}</span>
                      </div>
                      <span className="font-bold text-slate-200">${tx.amount}</span>
                    </div>
                  ))}
                  <div className="mt-6 pt-4 border-t border-slate-800">
                     <p className="text-xs text-slate-500 text-center">Optimized to require minimum number of transactions.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}