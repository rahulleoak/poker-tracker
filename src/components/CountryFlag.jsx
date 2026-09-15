import React from 'react';

/**
 * High-quality vector SVG flags for cross-platform rendering (Windows-safe).
 */
export default function CountryFlag({ code, className = 'w-4 h-3 rounded-[2px] shadow-sm inline-block shrink-0' }) {
  const c = String(code || '').trim().toUpperCase();

  switch (c) {
    case 'CA': // Canada
      return (
        <svg className={className} viewBox="0 0 64 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="16" height="32" fill="#D80027" />
          <rect x="16" width="32" height="32" fill="#F0F0F0" />
          <rect x="48" width="16" height="32" fill="#D80027" />
          <path
            d="M32 6L33.6 11.2L38 9.6L36.8 14.4L41.6 16L36.8 17.6L38 22.4L33.6 20.8L32.8 26H31.2L30.4 20.8L26 22.4L27.2 17.6L22.4 16L27.2 14.4L26 9.6L30.4 11.2L32 6Z"
            fill="#D80027"
          />
        </svg>
      );

    case 'US': // United States
      return (
        <svg className={className} viewBox="0 0 64 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* 13 Red/White Stripes */}
          {[...Array(13)].map((_, i) => (
            <rect key={i} y={(i * 34) / 13} width="64" height={34 / 13} fill={i % 2 === 0 ? '#D80027' : '#F0F0F0'} />
          ))}
          {/* Blue Canton */}
          <rect width="28" height={(7 * 34) / 13} fill="#0052B4" />
          {/* Simple star dots representation */}
          <circle cx="6" cy="4.5" r="1.2" fill="#FFFFFF" />
          <circle cx="14" cy="4.5" r="1.2" fill="#FFFFFF" />
          <circle cx="22" cy="4.5" r="1.2" fill="#FFFFFF" />
          <circle cx="10" cy="9" r="1.2" fill="#FFFFFF" />
          <circle cx="18" cy="9" r="1.2" fill="#FFFFFF" />
          <circle cx="6" cy="13.5" r="1.2" fill="#FFFFFF" />
          <circle cx="14" cy="13.5" r="1.2" fill="#FFFFFF" />
          <circle cx="22" cy="13.5" r="1.2" fill="#FFFFFF" />
        </svg>
      );

    case 'SG': // Singapore
      return (
        <svg className={className} viewBox="0 0 64 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="19" fill="#D80027" />
          <rect y="19" width="64" height="19" fill="#F0F0F0" />
          {/* Crescent */}
          <circle cx="12" cy="9.5" r="6" fill="#FFFFFF" />
          <circle cx="14.2" cy="9.5" r="5" fill="#D80027" />
          {/* 5 Stars */}
          <circle cx="15.5" cy="6" r="1" fill="#FFFFFF" />
          <circle cx="18.5" cy="8" r="1" fill="#FFFFFF" />
          <circle cx="17.5" cy="11.5" r="1" fill="#FFFFFF" />
          <circle cx="13.5" cy="11.5" r="1" fill="#FFFFFF" />
          <circle cx="12.5" cy="8" r="1" fill="#FFFFFF" />
        </svg>
      );

    case 'EU': // Eurozone
      return (
        <svg className={className} viewBox="0 0 64 42" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="42" fill="#0052B4" />
          <circle cx="32" cy="8" r="1.8" fill="#FFDA44" />
          <circle cx="44" cy="15" r="1.8" fill="#FFDA44" />
          <circle cx="48" cy="21" r="1.8" fill="#FFDA44" />
          <circle cx="44" cy="27" r="1.8" fill="#FFDA44" />
          <circle cx="32" cy="34" r="1.8" fill="#FFDA44" />
          <circle cx="20" cy="27" r="1.8" fill="#FFDA44" />
          <circle cx="16" cy="21" r="1.8" fill="#FFDA44" />
          <circle cx="20" cy="15" r="1.8" fill="#FFDA44" />
        </svg>
      );

    case 'GB': // United Kingdom
      return (
        <svg className={className} viewBox="0 0 64 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="34" fill="#0052B4" />
          {/* Diagonals */}
          <line x1="0" y1="0" x2="64" y2="34" stroke="#F0F0F0" strokeWidth="6" />
          <line x1="64" y1="0" x2="0" y2="34" stroke="#F0F0F0" strokeWidth="6" />
          <line x1="0" y1="0" x2="64" y2="34" stroke="#D80027" strokeWidth="2.5" />
          <line x1="64" y1="0" x2="0" y2="34" stroke="#D80027" strokeWidth="2.5" />
          {/* Cross */}
          <rect x="26" width="12" height="34" fill="#F0F0F0" />
          <rect y="11" width="64" height="12" fill="#F0F0F0" />
          <rect x="28" width="8" height="34" fill="#D80027" />
          <rect y="13" width="64" height="8" fill="#D80027" />
        </svg>
      );

    case 'AU': // Australia
      return (
        <svg className={className} viewBox="0 0 64 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="34" fill="#0052B4" />
          {/* Mini Union Jack */}
          <rect width="32" height="17" fill="#00247D" />
          <line x1="0" y1="0" x2="32" y2="17" stroke="#FFFFFF" strokeWidth="3" />
          <line x1="32" y1="0" x2="0" y2="17" stroke="#FFFFFF" strokeWidth="3" />
          <rect x="13" width="6" height="17" fill="#FFFFFF" />
          <rect y="5.5" width="32" height="6" fill="#FFFFFF" />
          <rect x="14" width="4" height="17" fill="#CF142B" />
          <rect y="6.5" width="32" height="4" fill="#CF142B" />
          {/* Southern Cross stars */}
          <circle cx="16" cy="25" r="2.5" fill="#FFFFFF" />
          <circle cx="48" cy="8" r="1.5" fill="#FFFFFF" />
          <circle cx="54" cy="15" r="1.5" fill="#FFFFFF" />
          <circle cx="44" cy="20" r="1.5" fill="#FFFFFF" />
          <circle cx="48" cy="27" r="1.5" fill="#FFFFFF" />
        </svg>
      );

    case 'IN': // India
      return (
        <svg className={className} viewBox="0 0 64 42" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="14" fill="#FF9933" />
          <rect y="14" width="64" height="14" fill="#FFFFFF" />
          <rect y="28" width="64" height="14" fill="#128807" />
          <circle cx="32" cy="21" r="5" stroke="#000080" strokeWidth="1" />
          <circle cx="32" cy="21" r="1.5" fill="#000080" />
        </svg>
      );

    case 'JP': // Japan
      return (
        <svg className={className} viewBox="0 0 64 42" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="64" height="42" fill="#FFFFFF" />
          <circle cx="32" cy="21" r="12" fill="#D80027" />
        </svg>
      );

    case 'CH': // Switzerland
      return (
        <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" fill="#D80027" />
          <rect x="13" y="6" width="6" height="20" fill="#FFFFFF" />
          <rect x="6" y="13" width="20" height="6" fill="#FFFFFF" />
        </svg>
      );

    default:
      return (
        <span className="inline-flex items-center justify-center bg-zinc-800 border border-white/20 text-[10px] font-mono font-bold px-1.5 py-0.5 text-zinc-300">
          {c.slice(0, 2)}
        </span>
      );
  }
}
