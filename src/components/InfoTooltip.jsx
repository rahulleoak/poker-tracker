import { HelpCircle } from 'lucide-react';

export default function InfoTooltip({ label, content, children, className = '' }) {
  return (
    <span className={`group relative inline-flex items-center gap-1.5 cursor-help ${className}`}>
      {children || (
        <>
          <span className="border-b border-dotted border-slate-500 group-hover:border-emerald-400 transition-colors">
            {label}
          </span>
          <HelpCircle className="w-3.5 h-3.5 text-slate-500 group-hover:text-emerald-400 transition-colors shrink-0" />
        </>
      )}

      {/* Tooltip Popover Box */}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus-within:block z-50 w-64 p-3 text-xs font-normal text-slate-200 bg-slate-950 border border-slate-700 rounded-xl shadow-2xl pointer-events-none text-left tracking-normal leading-relaxed">
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-700"></span>
        {content}
      </span>
    </span>
  );
}
