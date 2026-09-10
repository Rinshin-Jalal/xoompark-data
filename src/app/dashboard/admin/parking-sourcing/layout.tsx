'use client';

// Shared chrome for all three parking-sourcing screens (Review Table, Work
// Queue, Hunt) — a Next.js layout instead of repeating the same
// header/tab-bar/red-lines JSX in three page.tsx files. The tab bar here is
// the ONE navigation surface between the three screens and is never
// dismissible, unlike the old onboarding banner it replaces (see git history
// on TutorialWizard.tsx) — dismissing that banner used to make Hunt/Fill
// permanently unreachable. Moved up from workspace/layout.tsx so Review
// Table (the root route) shares the same header/tabs instead of rendering
// its own separate one.
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { BookOpen, Compass, Database, ExternalLink, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { huntAggregatorLinks, HUNT_OFFICIAL_LINKS, HUNT_UNINGESTED_AGGREGATOR_LINKS } from '@/lib/sourcing/huntLinks';
import { LOCALITIES } from '@/lib/sourcing/locality';
import { cn } from '@/lib/utils';

const RED_LINES = [
  'Never guess. Never estimate numbers. Never mark from memory.',
  'Street View/satellite observations: always note the source + approx date.',
  'Never override flood/residential auto-checks.',
  'Nothing gets deleted — ever.',
  'Friday goal is DEPTH on real fields, not row count. 40 fully-filled lots beat 200 half-empty ones.',
];

const REVIEW_TABLE_HREF = '/dashboard/admin/parking-sourcing';

const TABS = [
  {
    label: 'Review Table',
    href: REVIEW_TABLE_HREF,
    // No description — Greg wants this screen to read like a spreadsheet,
    // not a page with intro copy. The filter bar/table speak for themselves.
    description: null,
  },
  {
    label: 'Work Queue',
    href: '/dashboard/admin/parking-sourcing/workspace',
    description: 'Work the next lot in your queue, one field at a time — new here? Try Hunt first to find lots.',
  },
  {
    label: 'Hunt',
    href: '/dashboard/admin/parking-sourcing/workspace/hunt',
    description: 'Find brand-new lots not yet in the system, locality by locality.',
  },
  {
    label: 'Daily Report',
    href: '/dashboard/admin/parking-sourcing/daily-report',
    description: 'Outreach pipeline overview — counts by state, CSV export, daily numbers.',
  },
];

// The order a brand-new BDR should actually work the 3 tabs, each with a
// one-line "what to do first" note. References TABS by href for label text
// so this can't drift out of sync with the real tab bar (see docs/
// bdr-workflow.md §0.1 for the fuller written version of the same guidance).
const GETTING_STARTED_ORDER: { href: string; note: string }[] = [
  {
    href: '/dashboard/admin/parking-sourcing/workspace/hunt',
    note: 'Find new lots that aren’t in the system yet, locality by locality. Start here.',
  },
  {
    href: '/dashboard/admin/parking-sourcing/workspace',
    note: 'Work the field-by-field wizard on whatever lot is next in priority. Most of your day lives here.',
  },
  {
    href: REVIEW_TABLE_HREF,
    note: 'Admin-wide bulk view for browsing, filtering, and oversight. Not typically your daily driver.',
  },
];

// Always the same content, manually opened, never auto-shown or dismissed —
// deliberately NOT a step-gated wizard (see git history on TutorialWizard.tsx
// / the Fill track) so it can't duplicate a real screen or go stale the way
// the old onboarding banners did.
function GettingStartedDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <Dialog open={isOpen} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Getting started</DialogTitle>
          <DialogDescription>Three tabs, one job each. Work them in this order.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {GETTING_STARTED_ORDER.map((step, i) => {
            const tab = TABS.find((t) => t.href === step.href)!;
            return (
              <li key={step.href} className="flex gap-3 p-3 border border-[#0e1c36]/12 rounded">
                <span className="font-mono text-xs font-bold text-[#1a3a7a] shrink-0">{i + 1}</span>
                <div>
                  <Link
                    href={step.href}
                    onClick={onClose}
                    className="font-semibold text-[#0e1c36] hover:text-[#1a3a7a] hover:underline"
                  >
                    {tab.label} →
                  </Link>
                  <p className="text-sm text-[#0e1c36]/60 mt-0.5">{step.note}</p>
                </div>
              </li>
            );
          })}
        </ol>
        <div className="mt-2 pt-4 border-t border-[#0e1c36]/10">
          <p className="text-xs font-semibold text-[#7a1a1a] uppercase tracking-wide mb-2">Red lines</p>
          <ul className="space-y-1.5">
            {RED_LINES.map((line) => (
              <li key={line} className="text-xs text-[#0e1c36]/70 flex gap-1.5">
                <span className="text-[#7a1a1a] shrink-0">✕</span>
                {line}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceRegistryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-white rounded-lg shadow-xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-[#1a3a7a]" />
            <h2 className="text-lg font-bold text-[#0e1c36]">Source Registry</h2>
          </div>
          <button onClick={onClose} className="text-[#0e1c36]/40 hover:text-[#0e1c36]" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm text-[#0e1c36]/60 mb-4">
          All aggregator and official source links for hunting new lots. Pick a locality to see verified deep links,
          or use the fallbacks to search manually.
        </p>
        <div className="space-y-6">
          <div>
            <h3 className="font-semibold text-[#0e1c36] mb-2">Aggregators (5 from §0.5)</h3>
            <div className="space-y-3">
              {LOCALITIES.map((locality) => {
                const links = huntAggregatorLinks(locality);
                return (
                  <details key={locality} className="border border-[#0e1c36]/10 rounded p-3">
                    <summary className="font-medium text-[#0e1c36] cursor-pointer flex items-center gap-2">
                      {locality}
                      <span className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40 ml-auto">
                        {links.filter((l) => l.verified).length} verified
                      </span>
                    </summary>
                    <div className="mt-3 grid sm:grid-cols-2 gap-2">
                      {links.map((l) => (
                        <a
                          key={l.aggregator}
                          href={l.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between px-3 py-2 border border-[#0e1c36]/15 rounded text-sm hover:bg-[#0e1c36]/[.03]"
                        >
                          <span className="text-[#0e1c36]">{l.aggregator}</span>
                          <span className="flex items-center gap-1.5">
                            {!l.verified && <span className="text-[10px] text-[#0e1c36]/40">type in search</span>}
                            <ExternalLink className="h-3.5 w-3.5 text-[#0e1c36]/40" />
                          </span>
                        </a>
                      ))}
                    </div>
                  </details>
                );
              })}
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-[#0e1c36] mb-2">Official Sources + Un-ingested Aggregators (§4)</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {[...HUNT_OFFICIAL_LINKS, ...HUNT_UNINGESTED_AGGREGATOR_LINKS].map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between px-3 py-2 border border-[#0e1c36]/15 rounded text-sm hover:bg-[#0e1c36]/[.03]"
                >
                  <span className="text-[#0e1c36]">{l.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-[#0e1c36]/40 shrink-0 ml-2" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ParkingSourcingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [showSourceRegistry, setShowSourceRegistry] = useState(false);
  const [showGettingStarted, setShowGettingStarted] = useState(false);

  const activeTab = TABS.find((t) => t.href === pathname) ?? TABS[0];
  const isReviewTable = activeTab.href === REVIEW_TABLE_HREF;

  return (
    // Review Table's bulk-edit table needs the full available width; Work
    // Queue/Hunt are single-card layouts that read better capped narrower.
    <div className={cn('w-full', !isReviewTable && 'max-w-4xl')}>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-[#1a3a7a]" />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[.16em] text-[#0e1c36]/40">
              PARKING SOURCING
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGettingStarted(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-[.08em] text-[#1a3a7a] hover:text-[#0e1c36] hover:underline"
            >
              <Compass className="h-3.5 w-3.5" />
              Getting Started
            </button>
            <button
              onClick={() => setShowSourceRegistry(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-[.08em] text-[#1a3a7a] hover:text-[#0e1c36] hover:underline"
            >
              <Database className="h-3.5 w-3.5" />
              Source Registry
            </button>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-[#0e1c36]">{activeTab.label}</h1>
        {activeTab.description && <p className="text-sm text-[#0e1c36]/50 mt-1">{activeTab.description}</p>}
      </div>

      {/* Persistent tab bar — never dismissible, visible on all three screens */}
      <nav className="flex items-center gap-1 mb-6 border-b border-[#0e1c36]/12">
        {TABS.map((tab) => {
          const active = tab.href === activeTab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors',
                active
                  ? 'border-[#1a3a7a] text-[#1a3a7a]'
                  : 'border-transparent text-[#0e1c36]/50 hover:text-[#0e1c36] hover:border-[#0e1c36]/20',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}

      {/* Red lines — BDR field-research rules, not relevant to the admin
          bulk-edit Review Table. */}
      {!isReviewTable && (
        <section className="border-2 border-[#7a1a1a] bg-[#ffe1e1] p-6 mt-8">
          <div className="flex items-center gap-3 mb-4">
            <ShieldAlert className="h-6 w-6 text-[#7a1a1a] shrink-0" />
            <h2 className="text-lg font-bold text-[#7a1a1a]">Red lines</h2>
          </div>
          <ul className="space-y-3">
            {RED_LINES.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[#7a1a1a] font-semibold text-[15px]">
                <span className="shrink-0 mt-1">✕</span>
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceRegistryModal isOpen={showSourceRegistry} onClose={() => setShowSourceRegistry(false)} />
      <GettingStartedDialog isOpen={showGettingStarted} onClose={() => setShowGettingStarted(false)} />
    </div>
  );
}
