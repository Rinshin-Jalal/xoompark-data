'use client';

import Link from 'next/link';
import { Compass, Sparkles, ClipboardList, FlaskConical, Mail, ArrowRight, BarChart3 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const STEPS: { icon: typeof Compass; title: string; href: string | null; desc: string }[] = [
  { icon: Compass, title: 'Find', href: '/source', desc: 'Discover parking lots. Paste a URL, search with Exa, or add manually.' },
  { icon: Sparkles, title: 'Enrich', href: null, desc: 'AI fills in stalls, hours, clearance, operator and phone automatically.' },
  { icon: ClipboardList, title: 'Qualify', href: '/work-queue', desc: 'Fill the 7-field checklist. Disqualify junk lots.' },
  { icon: FlaskConical, title: 'Research', href: '/research-desk', desc: 'Find the decision-maker: name, email, phone.' },
  { icon: Mail, title: 'Contact', href: '/bdr-email', desc: 'Reach out by email, then call.' },
  { icon: ArrowRight, title: 'Promote', href: null, desc: 'When they respond, hit "Promote to Deal".' },
  { icon: BarChart3, title: 'Deal', href: '/pipeline', desc: 'Move the prospect: Qualifying → Proposal → Negotiating → Onboarding → Live.' },
];

// The full workspace flow, explained in 7 steps. Opened from the sidebar.
export function FlowGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>How the workspace flows</DialogTitle>
          <DialogDescription>From finding a lot to closing a deal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex gap-3">
              <b className="text-[#3b7a57] text-sm shrink-0 w-4">{i + 1}</b>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-[#171717] flex items-center gap-1.5">
                  <s.icon size={14} className="text-[#3b7a57]" /> {s.title}
                </h3>
                <p className="text-sm text-[#6b6868] leading-relaxed">{s.desc}</p>
                {s.href && (
                  <Link href={s.href} onClick={onClose} className="text-xs text-[#3b7a57] hover:underline">
                    Open {s.title} →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}