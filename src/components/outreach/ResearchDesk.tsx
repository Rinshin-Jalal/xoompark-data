'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, User, Mail, Phone, Briefcase } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { propertyValue } from '@/lib/outreach/workflow';
import { saveContact } from '@/lib/outreach/actions';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';

// Split-pane master-detail: queue of lots needing decision-maker research on
// the left, the current lot + contact form on the right. Saving a contact
// moves the lot to `ready` (BDR email).
export function ResearchDesk({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const current = leads.find((l) => l.id === currentId) ?? leads[0];

  function save() {
    if (!current) return;
    if (!name.trim() && !email.trim() && !phone.trim()) {
      toast.error('Enter a name, email or phone');
      return;
    }
    startTransition(async () => {
      try {
        await saveContact(current.id, { name: name.trim(), role: role.trim(), email: email.trim(), phone: phone.trim() });
        toast.success('Contact saved → BDR email');
        setName(''); setRole(''); setEmail(''); setPhone('');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  const inputCls =
    'w-full mt-1 px-3 py-2 border border-[#e5e3e3] rounded-lg text-sm text-[#171717] placeholder-[#6b6868] focus:outline-none focus:border-[#3b7a57]';

  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Research Queue <span className="count">{leads.length}</span></h2>
            <p>Lots needing decision-maker research.</p>
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
              <span className="wq-pick-meta">{propertyValue(l, 'operator')}</span>
            </button>
          ))}
          {leads.length === 0 && (
            <div className="empty-state">
              <Check />
              <h3>Nothing to research</h3>
              <p>No lots need decision-maker discovery.</p>
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
                <p className="muted">{current.raw.address} · {propertyValue(current, 'operator')}</p>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <ConnectionsBar lead={current} />

              <div className="detail-section">
                <h3>Find the decision-maker</h3>
                <p className="muted">Start with the official operator source. A front-desk number is a route in, not a confirmed decision-maker.</p>
                <div className="form-grid" style={{ marginTop: 14 }}>
                  <label>
                    <span className="text-xs text-[#3e3b3b]">Name</span>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Greg Jensen" className={inputCls + ' pl-9'} />
                    </div>
                  </label>
                  <label>
                    <span className="text-xs text-[#3e3b3b]">Role</span>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                      <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Regional Ops Manager" className={inputCls + ' pl-9'} />
                    </div>
                  </label>
                  <label>
                    <span className="text-xs text-[#3e3b3b]">Email</span>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="gjensen@company.com" className={inputCls + ' pl-9'} />
                    </div>
                  </label>
                  <label>
                    <span className="text-xs text-[#3e3b3b]">Phone</span>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6b6868]" />
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(415) 555-0142" className={inputCls + ' pl-9'} />
                    </div>
                  </label>
                </div>
                <div className="detail-actions">
                  <button
                    disabled={pending}
                    onClick={save}
                    className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] disabled:opacity-60"
                  >
                    {pending ? 'Saving…' : 'Save contact → BDR email'}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Check />
            <h3>All caught up</h3>
            <p>No lots need decision-maker research.</p>
          </div>
        )}
      </section>
    </div>
  );
}