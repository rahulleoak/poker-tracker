import { HelpCircle } from 'lucide-react';

export default function InfoTooltip({ label, content, text, children, className = '' }) {
  const tooltipText = content || text;

  return (
    <span className={`group relative inline-flex items-center gap-1.5 cursor-help ${className}`}>
      {children || (
        <>
          {label && (
            <span className="border-b border-dotted border-zinc-500 group-hover:border-cyan-400 transition-colors text-xs font-mono">
              {label}
            </span>
          )}
          <HelpCircle className="w-3.5 h-3.5 text-zinc-500 group-hover:text-cyan-400 transition-colors shrink-0" />
        </>
      )}

      {/* Tooltip Popover Box */}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus-within:block z-50 w-64 p-3 text-xs font-normal text-zinc-200 bg-black/95 border border-white/20 shadow-2xl pointer-events-none text-left tracking-normal leading-relaxed backdrop-blur-xl font-sans">
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-white/20"></span>
        {tooltipText}
      </span>
    </span>
  );
}
