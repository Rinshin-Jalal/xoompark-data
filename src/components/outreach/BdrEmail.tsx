'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Mail, Copy, Send } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';
import { propertyValue, draftEmail } from '@/lib/outreach/workflow';
import { logEmailSent } from '@/lib/outreach/actions';
import { ConnectionsBar } from '@/components/outreach/ConnectionsBar';

// Email composer: pre-filled template, copy draft, log sent + auto-follow-up.
export function BdrEmail({ leads }: { leads: Lead[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<'fleet' | 'consulting'>('fleet');

  const current = leads.find((l) => l.id === currentId) ?? leads[0];
  const draft = current ? draftEmail(current, campaign) : null;

  async function copy() {
    if (!current || !draft) return;
    try {
      await navigator.clipboard.writeText(`To: ${current.email}\nSubject: ${draft.subject}\n\n${draft.body}`);
      toast.success('Draft copied — send from your email, then log it here');
    } catch {
      toast.error('Select and copy the draft below');
    }
  }

  function logSent() {
    if (!current) return;
    startTransition(async () => {
      try {
        await logEmailSent(current.id);
        toast.success('Email logged → follow-up in 3 days');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to log');
      }
    });
  }

  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Email Queue <span className="count">{leads.length}</span></h2>
            <p>Lots ready for BDR email.</p>
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
              <span className="wq-pick-meta">{l.email || 'no email'}</span>
            </button>
          ))}
          {leads.length === 0 && (
            <div className="empty-state">
              <Check />
              <h3>No emails queued</h3>
              <p>Lots with a saved contact will appear here.</p>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        {current && draft ? (
          <>
            <div className="panel-heading">
              <div>
                <h2>{current.raw.name}</h2>
                <p className="muted">To: {current.email || 'no email'} · {propertyValue(current, 'operator')}</p>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <ConnectionsBar lead={current} />

              <div className="detail-section">
                <div className="flex items-center gap-3 mb-3">
                  <h3 style={{ margin: 0 }}>Prepare the email</h3>
                  <select
                    value={campaign}
                    onChange={(e) => setCampaign(e.target.value as 'fleet' | 'consulting')}
                    className="ml-auto px-2 py-1.5 text-xs border border-[#e5e3e3] rounded-md text-[#171717]"
                  >
                    <option value="fleet">Overnight fleet parking</option>
                    <option value="consulting">AV-ready property consulting</option>
                  </select>
                </div>
                <p className="muted mb-3">Editable template. This does not send an email.</p>
                <label className="block mb-2">
                  <span className="text-xs text-[#3e3b3b]">Subject</span>
                  <input
                    value={draft.subject}
                    readOnly
                    className="w-full mt-1 px-3 py-2 border border-[#e5e3e3] rounded-lg text-sm text-[#171717]"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-[#3e3b3b]">Body</span>
                  <textarea
                    value={draft.body}
                    readOnly
                    rows={10}
                    className="w-full mt-1 px-3 py-2 border border-[#e5e3e3] rounded-lg text-sm text-[#171717] leading-relaxed"
                  />
                </label>
                <div className="detail-actions">
                  <button
                    onClick={copy}
                    disabled={!current.email}
                    className="px-4 py-2 text-sm rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Copy size={14} /> Copy draft
                  </button>
                  <button
                    onClick={logSent}
                    disabled={pending || !current.email}
                    className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    {pending ? 'Logging…' : <><Send size={14} /> Log sent + follow-up</>}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <Mail />
            <h3>No emails queued</h3>
            <p>Lots with a saved contact will appear here.</p>
          </div>
        )}
      </section>
    </div>
  );
}