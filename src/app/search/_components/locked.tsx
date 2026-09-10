import Link from 'next/link';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one flagship site shown with FULL data on /search — the "this is
 * what's inside" proof in the teaser. Real, verified prod data (garage,
 * 10/11 fields). Everything else locks its fleet-relevant fields.
 * Lives here (not publicNetwork.ts) so client components never pull
 * firebase-admin into the browser bundle.
 */
export const DEMO_DOC_ID = 'addr:2201-north-miami-avenue-miami';
export const DEMO_SITE_ID = `sourcing:${DEMO_DOC_ID}`;

/**
 * Teaser treatment for fleet-relevant fields (clearance, capacity, gate,
 * EV, flood, rates): a lock chip instead of the value. Links to the
 * access flow — the teaser exists to make someone click this.
 * stopPropagation so it never triggers the parent card/map selection.
 */
export function LockedValue({ label = 'Unlock', className }: { label?: string; className?: string }) {
  return (
    <Link
      href="/auth"
      onClick={(e) => e.stopPropagation()}
      title="Unlock full site data"
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-[#1a3a7a]/40 bg-[#d7f9ff]/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[#1a3a7a] transition-colors hover:border-[#1a3a7a] hover:bg-[#d7f9ff]/40',
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      {label}
    </Link>
  );
}
