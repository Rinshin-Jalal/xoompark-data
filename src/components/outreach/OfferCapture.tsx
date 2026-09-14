'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Tag } from 'lucide-react';
import type { CommercialOffer, OfferSource, OfferStatus, PricingModel, TermType, Confidence } from '@/lib/sourcing/types';
import { OFFER_SOURCES, OFFER_STATUSES, PRICING_MODELS, TERM_TYPES, CONFIDENCE_LEVELS, OFFER_SOURCE_LABELS, OFFER_STATUS_LABELS, PRICING_MODEL_LABELS, TERM_TYPE_LABELS, rateTier, RATE_TIER_LABELS } from '@/lib/sourcing/types';
import { saveOffer, getOffers } from '@/lib/outreach/actions';

const inputCls = 'w-full h-9 px-2.5 border border-[#e5e3e3] rounded-md text-sm text-[#171717] focus:outline-none focus:border-[#3b7a57] transition-colors duration-150';
const labelCls = 'text-xs text-[#6b6868]';

// Commercial offers (pricing + terms) per lot. Manual entry first — AI
// extraction later. Numeric rate stored, tiers derived in the UI.
export function OfferCapture({ lotId }: { lotId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [offers, setOffers] = useState<CommercialOffer[]>([]);
  const [open, setOpen] = useState(false);

  const [rate, setRate] = useState('');
  const [spaces, setSpaces] = useState('');
  const [term, setTerm] = useState('');
  const [cancellation, setCancellation] = useState('30');
  const [model, setModel] = useState<PricingModel>('per_stall_monthly');
  const [status, setStatus] = useState<OfferStatus>('indicative');
  const [source, setSource] = useState<OfferSource>('call');
  const [termType, setTermType] = useState<TermType>('unknown');
  const [confidence, setConfidence] = useState<Confidence>('medium');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    let cancelled = false;
    getOffers(lotId).then((o) => { if (!cancelled) setOffers(o); }).catch(() => {});
    return () => { cancelled = true; };
  }, [lotId]);

  function submit() {
    if (!rate && !notes.trim()) { toast.error('Enter a rate or a note'); return; }
    startTransition(async () => {
      try {
        await saveOffer(lotId, {
          source,
          captured_by: 'manual',
          status,
          pricing_model: model,
          currency: 'USD',
          monthly_rate_per_stall: rate ? Number(rate) : null,
          minimum_spaces: spaces ? Number(spaces) : null,
          term_months: term ? Number(term) : null,
          term_type: termType,
          cancellation_notice_days: cancellation ? Number(cancellation) : null,
          start_date: null,
          confidence,
          needs_human_review: false,
          notes,
          raw_source_text: notes,
        });
        toast.success('Offer saved');
        setRate(''); setSpaces(''); setTerm(''); setNotes('');
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    });
  }

  return (
    <section className="detail-section">
      <div className="flex items-center justify-between">
        <h3>Offers</h3>
        <button
          onClick={() => setOpen((v) => !v)}
          className="px-2.5 py-1 text-xs rounded-md border border-[#e5e3e3] text-[#171717] hover:border-[#3b7a57] inline-flex items-center gap-1"
        >
          <Plus size={13} /> Log offer
        </button>
      </div>

      {offers.length === 0 ? (
        <p className="muted">No offers yet.</p>
      ) : (
        <div className="offer-list">
          {offers.map((o) => (
            <div key={o.id} className="offer-card">
              <div className="flex items-center justify-between">
                <strong className="text-sm">
                  {o.monthly_rate_per_stall != null ? `$${o.monthly_rate_per_stall}/stall` : 'Custom terms'}
                  <span className="offer-tier"> · {RATE_TIER_LABELS[rateTier(o.monthly_rate_per_stall)]}</span>
                </strong>
                <span className="offer-status">{OFFER_STATUS_LABELS[o.status]}</span>
              </div>
              <div className="offer-meta">
                <span>{PRICING_MODEL_LABELS[o.pricing_model]}</span>
                <span>· {TERM_TYPE_LABELS[o.term_type]}</span>
                {o.term_months != null && <span>· {o.term_months}mo</span>}
                {o.cancellation_notice_days != null && <span>· {o.cancellation_notice_days}d notice</span>}
                {o.minimum_spaces != null && <span>· {o.minimum_spaces} stalls</span>}
                <span>· {OFFER_SOURCE_LABELS[o.source]}</span>
              </div>
              {o.notes && <p className="offer-notes">{o.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="offer-form">
          <div className="form-grid">
            <label>
              <span className={labelCls}>Rate / stall / mo ($)</span>
              <input type="number" min="0" step="0.5" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="10" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Stalls offered</span>
              <input type="number" min="0" value={spaces} onChange={(e) => setSpaces(e.target.value)} placeholder="50" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Term (months)</span>
              <input type="number" min="0" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="12" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Cancellation (days)</span>
              <input type="number" min="0" value={cancellation} onChange={(e) => setCancellation(e.target.value)} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Pricing model</span>
              <select value={model} onChange={(e) => setModel(e.target.value as PricingModel)} className={inputCls}>
                {PRICING_MODELS.map((m) => <option key={m} value={m}>{PRICING_MODEL_LABELS[m]}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as OfferStatus)} className={inputCls}>
                {OFFER_STATUSES.map((s) => <option key={s} value={s}>{OFFER_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Source</span>
              <select value={source} onChange={(e) => setSource(e.target.value as OfferSource)} className={inputCls}>
                {OFFER_SOURCES.map((s) => <option key={s} value={s}>{OFFER_SOURCE_LABELS[s]}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Term type</span>
              <select value={termType} onChange={(e) => setTermType(e.target.value as TermType)} className={inputCls}>
                {TERM_TYPES.map((t) => <option key={t} value={t}>{TERM_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
            <label>
              <span className={labelCls}>Confidence</span>
              <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)} className={inputCls}>
                {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <label>
            <span className={labelCls}>Notes / raw terms</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. $15/stall under 50, $12 over 100, month-to-month after 6mo" className={`${inputCls} h-auto py-2`} />
          </label>
          <button
            disabled={pending}
            onClick={submit}
            className="px-3 py-1.5 text-xs rounded-md bg-[#3b7a57] text-white hover:bg-[#2f6145] inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            <Tag size={13} /> Save offer
          </button>
        </div>
      )}
    </section>
  );
}