'use client';

// One clickable count chip shared by the sourcing/pitstop triage strips —
// a count that reads as a dashboard AND filters the table when clicked.
// Active = the slice it represents is currently applied; click again to clear.
import { cn } from '@/lib/utils';

// Active = the accent fill the landing page uses for selection/hover
// (.xp-button-ghost's hover treatment): #afcbff wash with ink text — never
// a solid ink pill.
export function FilterChip({
  active,
  onClick,
  children,
  tone = 'plain',
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'plain' | 'fail' | 'pass';
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-1 rounded-full border font-mono text-[10px] uppercase tracking-wide whitespace-nowrap transition-colors',
        active
          ? 'bg-[#afcbff] border-[#afcbff] text-[#0e1c36] font-semibold'
          : tone === 'fail'
            ? 'bg-[#ffe1e1]/60 border-[#ffcccc] text-[#7a1a1a] hover:border-[#7a1a1a]'
            : 'bg-white border-[#0e1c36]/15 text-[#0e1c36]/60 hover:border-[#0e1c36]/40',
      )}
    >
      {children}
    </button>
  );
}
