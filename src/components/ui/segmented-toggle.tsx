'use client';

// Segmented toggle — beui.dev's Tabs pattern (spring layoutId sliding
// indicator) over the landing page's palette: quiet hairline track, white
// active pill, ink text. One shared layoutId morphs the pill between
// options instead of hard-swapping backgrounds.
import { useId } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  const layoutId = useId();
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-[#0e1c36]/12 bg-[#0e1c36]/[.04] p-0.5',
        className,
      )}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative rounded-md px-3 py-1 text-xs font-mono uppercase tracking-[.08em] transition-colors',
              active ? 'text-[#0e1c36]' : 'text-[#0e1c36]/50 hover:text-[#0e1c36]',
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-md border border-[#0e1c36]/10 bg-white shadow-sm"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
