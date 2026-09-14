'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { getEnrichment, verifyField } from '@/lib/outreach/actions';

type EnrichmentField = { field: string; value: string; confidence: number; snippet: string; verified: boolean };

// Field-level verification — the human-in-the-loop the experts flagged as the
// bottleneck. Each extracted field shows its evidence quote + confidence, with
// one-click Accept/Reject.
export function EnrichmentVerify({ lotId }: { lotId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enrichment, setEnrichment] = useState<{ fields: EnrichmentField[]; status: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEnrichment(lotId).then((e) => { if (!cancelled) setEnrichment(e); }).catch(() => {});
    return () => { cancelled = true; };
  }, [lotId]);

  function verify(field: string, verified: boolean) {
    startTransition(async () => {
      try {
        await verifyField(lotId, field, verified);
        toast.success(verified ? 'Verified' : 'Rejected');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed');
      }
    });
  }

  if (!enrichment) return null;

  return (
    <section className="detail-section">
      <h3>Enrichment</h3>
      {enrichment.fields.length === 0 ? (
        <p className="muted">No fields extracted yet. Run Enrich to scrape the source.</p>
      ) : (
        <div className="enrich-list">
          {enrichment.fields.map((f) => (
            <div key={f.field} className="enrich-field">
              <div className="flex items-center justify-between">
                <strong className="text-sm">{f.field.replaceAll('_', ' ')}</strong>
                <span className="enrich-confidence">{Math.round(f.confidence * 100)}%</span>
              </div>
              <p className="enrich-value">{f.value}</p>
              {f.snippet && <p className="enrich-snippet">“{f.snippet}”</p>}
              <div className="enrich-actions">
                {f.verified ? (
                  <span className="enrich-verified">✓ Verified</span>
                ) : (
                  <>
                    <button disabled={pending} onClick={() => verify(f.field, true)} className="enrich-accept">
                      <Check size={13} /> Accept
                    </button>
                    <button disabled={pending} onClick={() => verify(f.field, false)} className="enrich-reject">
                      <X size={13} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}