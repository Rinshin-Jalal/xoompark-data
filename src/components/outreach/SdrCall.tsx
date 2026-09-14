'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Phone, ThumbsUp, Voicemail, XCircle, UserX } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { propertyValue } from '@/lib/outreach/workflow';
import { advanceStage, clearContact } from '@/lib/outreach/actions';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';

// Dialing HUD: call script on top, disposition matrix on the bottom. Each
// disposition auto-submits and loads the next call — no modal, no save button.
export function SdrCall({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currentId, setCurrentId] = useState<string | null>(null);

  const current = leads.find((l) => l.id === currentId) ?? leads[0];

  function script(l: Lead): string {
    const stalls = l.raw.stall_count || 'commercial';
    const name = l.contact_name || 'there';
    return `Hi ${name}, this is [your name] from XoomPark. I'm calling about the ${stalls}-stall lot at ${l.raw.name}. We're exploring an overnight fleet parking arrangement — do you have a moment to discuss permitted fleet use and available capacity?`;
  }

  function run(fn: () => Promise<void>, ok: string) {
    if (!current) return;
    startTransition(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed');
      }
    });
  }

  const dispositions = [
    { key: '1', label: 'Connected · Interested', icon: ThumbsUp, cls: 'bg-[#111] text-white', act: () => run(() => advanceStage(current!.id, 'responded'), 'Interested → responded') },
    { key: '2', label: 'Left Voicemail', icon: Voicemail, cls: 'bg-[#f5f4f4] text-[#171717]', act: () => run(() => advanceStage(current!.id, 'called'), 'Voicemail logged') },
    { key: '3', label: 'Gatekeeper / No Answer', icon: XCircle, cls: 'bg-[#f5f4f4] text-[#171717]', act: () => run(() => advanceStage(current!.id, 'called'), 'Rolled to tomorrow') },
    { key: '4', label: 'Wrong Contact', icon: UserX, cls: 'bg-[#fff3cd] text-[#5c4a1a]', act: () => run(() => clearContact(current!.id), 'Contact cleared → research') },
  ];

  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Call Queue <span className="count">{leads.length}</span></h2>
            <p>Lots needing a call.</p>
          </div>
        </div>
        <div className="wq-picker">
          {leads.map((l) => (
            <button
              key={l.id}
              onClick={() => setCurrentId(l.id)}
              className={'wq-pick' + (l.id === current?.id ? ' active' : '')}
            >
              <span className="truncate">{l.raw.name}</span>
              <span className="wq-pick-meta">{l.contact_name || 'no contact'}</span>
            </button>
          ))}
          {leads.length === 0 && (
            <div className="empty-state">
              <Check />
              <h3>No calls queued</h3>
              <p>Nothing needs a call right now.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        {current ? (
          <>
            <div className="panel-heading">
              <div>
                <h2>{current.raw.name}</h2>
                <p className="muted">{current.contact_name || 'No contact'} · {current.phone || 'no phone'} · {propertyValue(current, 'operator')}</p>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <ConnectionsBar lead={current} />

              <div className="detail-section">
                <h3>Call script</h3>
                <p className="script">{script(current)}</p>
              </div>

              <div className="detail-section">
                <h3>Disposition</h3>
                <div className="grid grid-cols-2 gap-2">
                  {dispositions.map((d) => (
                    <button
                      key={d.key}
                      disabled={pending}
                      onClick={d.act}
                      className={`flex items-center gap-2 px-3 py-3 rounded-md text-sm font-medium transition-opacity disabled:opacity-60 ${d.cls}`}
                    >
                      <d.icon size={16} />
                      <span className="text-left">{d.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Phone />
            <h3>No calls queued</h3>
            <p>Lots that replied to BDR email will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}