import React from 'react';

export default function MetricCard({ title, value, subtitle, icon, valueColor = "text-slate-100" }) {
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
