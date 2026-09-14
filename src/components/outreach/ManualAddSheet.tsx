'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';

// Full manual-add drawer — all the fields a BDR can capture, matching
// AddLocationFormInput. Tri-state fields use a Yes/No/Unknown select.
export function ManualAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [address, setAddress] = useState('');
  const [capacity, setCapacity] = useState('');
  const [hours, setHours] = useState('');
  const [clearance, setClearance] = useState('');
  const [ingressEgress, setIngressEgress] = useState('');
  const [rates, setRates] = useState('');
  const [notes, setNotes] = useState('');
  const [addedBy, setAddedBy] = useState('');
  const [access247, setAccess247] = useState<string>('');
  const [fenced, setFenced] = useState<string>('');
  const [lit, setLit] = useState<string>('');

  const tri = (v: string): boolean | null | undefined => (v === 'yes' ? true : v === 'no' ? false : v === 'unknown' ? null : undefined);

  function reset() {
    setName(''); setSourceUrl(''); setAddress(''); setCapacity(''); setHours('');
    setClearance(''); setIngressEgress(''); setRates(''); setNotes(''); setAddedBy('');
    setAccess247(''); setFenced(''); setLit('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !sourceUrl.trim()) {
      toast.error('Name and source URL are required');
      return;
    }
    startTransition(async () => {
      try {
        const { addSourcedLocation } = await import('@/app/dashboard/admin/parking-sourcing/actions');
        const r = await addSourcedLocation({
          name: name.trim(),
          sourceUrl: sourceUrl.trim(),
          address: address.trim() || undefined,
          capacityText: capacity.trim() || undefined,
          hoursText: hours.trim() || undefined,
          clearanceText: clearance.trim() || undefined,
          ingressEgress: ingressEgress.trim() || undefined,
          priceText: rates.trim() || undefined,
          notes: notes.trim() || undefined,
          addedBy: addedBy.trim() || undefined,
          access247: tri(access247),
          fenced: tri(fenced),
          lit: tri(lit),
        } as never);
        if (!r.ok) throw new Error('Failed to add');
        toast.success(`Added "${name.trim()}"`);
        reset();
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      }
    });
  }

  const inputCls = 'w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717] focus:outline-none focus:border-[#3b7a57] transition-colors duration-150';
  const labelCls = 'block text-xs text-[#6b6868] mb-1';

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="detail-sheet">
        <SheetHeader>
          <SheetTitle>Add a lot manually</SheetTitle>
          <SheetDescription>Capture the details you have. Name and source URL are required.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="detail-body space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={labelCls}>Name *</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="150 Division Lot" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Source URL *</span>
              <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://spothero.com/..." className={inputCls} />
            </label>
            <label className="col-span-2">
              <span className={labelCls}>Address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="150 Division St, Miami FL" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Capacity (stalls)</span>
              <input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 200" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Hours</span>
              <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 24/7" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Clearance</span>
              <input value={clearance} onChange={(e) => setClearance(e.target.value)} placeholder={'e.g. 6\'8"'} className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>Rates</span>
              <input value={rates} onChange={(e) => setRates(e.target.value)} placeholder="e.g. $10/day" className={inputCls} />
            </label>
            <label className="col-span-2">
              <span className={labelCls}>Ingress / egress</span>
              <input value={ingressEgress} onChange={(e) => setIngressEgress(e.target.value)} placeholder="e.g. one-way in, separate exit" className={inputCls} />
            </label>
            <label>
              <span className={labelCls}>24/7 access</span>
              <select value={access247} onChange={(e) => setAccess247(e.target.value)} className={inputCls}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Checked — couldn't tell</option>
              </select>
            </label>
            <label>
              <span className={labelCls}>Fenced</span>
              <select value={fenced} onChange={(e) => setFenced(e.target.value)} className={inputCls}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Checked — couldn't tell</option>
              </select>
            </label>
            <label>
              <span className={labelCls}>Lit</span>
              <select value={lit} onChange={(e) => setLit(e.target.value)} className={inputCls}>
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="unknown">Checked — couldn't tell</option>
              </select>
            </label>
            <label>
              <span className={labelCls}>Added by</span>
              <input value={addedBy} onChange={(e) => setAddedBy(e.target.value)} placeholder="Your name" className={inputCls} />
            </label>
            <label className="col-span-2">
              <span className={labelCls}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything worth noting…" className="w-full px-3 py-2 border border-[#e5e3e3] rounded-md text-sm text-[#171717] focus:outline-none focus:border-[#3b7a57]" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-md border border-[#e5e3e3] text-[#171717] hover:bg-[#f5f4f4] transition-colors duration-150">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] transition-colors duration-150 disabled:opacity-60">
              {pending ? 'Adding…' : 'Add lot'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}