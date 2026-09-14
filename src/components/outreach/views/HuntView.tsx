'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { useData } from '@/components/outreach/DataContext';
import { LOCALITIES } from '@/lib/sourcing/locality';
import { huntAggregatorLinks, HUNT_OFFICIAL_LINKS, HUNT_UNINGESTED_AGGREGATOR_LINKS } from '@/lib/sourcing/huntLinks';
import { quickAddLot, previewLot } from '@/lib/outreach/actions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function HuntView() {
  const data = useData();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<'url' | 'html' | 'manual'>('url');
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [htmlSource, setHtmlSource] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [preview, setPreview] = useState<{ name: string; address: string; source: string; count: number } | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  function handlePreview() {
    if (!url.trim()) return;
    startTransition(async () => {
      try {
        setPreview(await previewLot(url));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to parse');
      }
    });
  }

  function handleConfirmAdd() {
    if (!url.trim()) return;
    startTransition(async () => {
      try {
        const r = await quickAddLot(url);
        toast.success(r.message);
        setUrl('');
        setPreview(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      }
    });
  }

  async function handleHtmlImport() {
    if (!html.trim() || !htmlSource.trim()) {
      toast.error('Paste HTML and a source URL');
      return;
    }
    startTransition(async () => {
      try {
        const { parsePastedHtml, importPastedFacilities } = await import('@/app/dashboard/admin/parking-sourcing/actions');
        const parsed = await parsePastedHtml(html, htmlSource);
        if (!parsed.ok) throw new Error(parsed.error);
        const imported = await importPastedFacilities(parsed.results, htmlSource);
        if (!imported.ok) throw new Error(imported.error);
        toast.success(`Imported ${imported.imported} lot${imported.imported === 1 ? '' : 's'}${imported.merged ? `, merged ${imported.merged}` : ''}`);
        setHtml('');
        setHtmlSource('');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to import HTML');
      }
    });
  }

  async function handleManualAdd() {
    if (!manualName.trim() || !manualAddress.trim()) {
      toast.error('Name and address are required');
      return;
    }
    startTransition(async () => {
      try {
        const { addSourcedLocation } = await import('@/app/dashboard/admin/parking-sourcing/actions');
        const r = await addSourcedLocation({ name: manualName.trim(), address: manualAddress.trim() } as never);
        if (!r.ok) throw new Error('Failed to add');
        toast.success(`Added "${manualName.trim()}"`);
        setManualName('');
        setManualAddress('');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      }
    });
  }

  // Lot count per locality
  const counts = new Map<string, number>();
  for (const l of data.leads) {
    const loc = l.raw.locality || 'Unassigned';
    counts.set(loc, (counts.get(loc) ?? 0) + 1);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> SUPPLY</div>
          <h1>Find the next lot.</h1>
          <p>Locality-by-locality discovery of lots not yet in the system.</p>
        </div>
        <button onClick={() => setShowGuide(true)} className="px-4 py-2 text-sm rounded-md border border-[#e5e3e3] text-[#171717] hover:bg-[#f5f4f4] transition-colors duration-150">
          How to add a lot
        </button>
      </div>

      <div className="panel mb-6">
        <div className="panel-heading">
          <div>
            <h2>Add a lot</h2>
            <p>Paste a URL, paste HTML, or add manually.</p>
          </div>
        </div>
        <div className="p-4">
          <div className="flex gap-1 mb-4">
            {(['url', 'html', 'manual'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 ${
                  mode === m ? 'bg-[#111] text-white' : 'text-[#6b6868] hover:text-[#171717]'
                }`}
              >
                {m === 'url' ? 'Paste URL' : m === 'html' ? 'Paste HTML' : 'Manual'}
              </button>
            ))}
          </div>

          {mode === 'url' && (
            <div className="flex gap-2">
              <div className="search-field flex-1">
                <Search size={17} />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePreview(); }}
                  placeholder="Paste a URL or address…"
                  className="w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
                />
              </div>
              <button onClick={handlePreview} disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] inline-flex items-center gap-1.5 disabled:opacity-60">
                <Plus size={14} /> {pending ? 'Parsing…' : 'Add'}
              </button>
            </div>
          )}

          {mode === 'html' && (
            <div className="space-y-2">
              <textarea
                value={html}
                onChange={(e) => setHtml(e.target.value)}
                placeholder="Paste listing HTML here…"
                rows={5}
                className="w-full px-3 py-2 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
              />
              <input
                value={htmlSource}
                onChange={(e) => setHtmlSource(e.target.value)}
                placeholder="Source URL (where this HTML came from)"
                className="w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
              />
              <button onClick={handleHtmlImport} disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] inline-flex items-center gap-1.5 disabled:opacity-60">
                <Plus size={14} /> {pending ? 'Importing…' : 'Parse & import'}
              </button>
            </div>
          )}

          {mode === 'manual' && (
            <div className="space-y-2">
              <input
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Lot name"
                className="w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
              />
              <input
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="Address"
                className="w-full h-10 px-3 border border-[#e5e3e3] rounded-md text-sm text-[#171717]"
              />
              <button onClick={handleManualAdd} disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] inline-flex items-center gap-1.5 disabled:opacity-60">
                <Plus size={14} /> {pending ? 'Adding…' : 'Add lot'}
              </button>
            </div>
          )}
        </div>
      </div>

      <Dialog open={!!preview} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add this lot?</DialogTitle>
            <DialogDescription>Review the parsed details before adding.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-2 mt-2">
              <div><small className="text-[#6b6868]">Name</small><p className="text-sm text-[#171717]">{preview.name}</p></div>
              <div><small className="text-[#6b6868]">Address</small><p className="text-sm text-[#171717]">{preview.address || '—'}</p></div>
              <div><small className="text-[#6b6868]">Source</small><p className="text-sm text-[#171717]">{preview.source}</p></div>
              {preview.count > 1 && <p className="text-xs text-[#6b6868]">{preview.count} lots found — all will be imported.</p>}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setPreview(null)} className="px-4 py-2 text-sm rounded-md border border-[#e5e3e3] text-[#171717] hover:bg-[#f5f4f4] transition-colors duration-150">
              Cancel
            </button>
            <button onClick={handleConfirmAdd} disabled={pending} className="px-4 py-2 text-sm rounded-md bg-[#111] text-white hover:bg-[#333] transition-colors duration-150 disabled:opacity-60">
              {pending ? 'Adding…' : 'Confirm add'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {LOCALITIES.map((locality) => {
          const links = huntAggregatorLinks(locality);
          const count = counts.get(locality) ?? 0;
          return (
            <div key={locality} className="portfolio-card">
              <div className="portfolio-head">
                <span className="font-semibold text-[#171717]">{locality}</span>
                <span className="text-xs text-[#6b6868] ml-auto">{count} lots</span>
              </div>
              <div className="portfolio-lots">
                {links.map((l) => (
                  <a key={l.aggregator} href={l.url} target="_blank" rel="noreferrer" className="portfolio-lot">
                    <span>{l.aggregator}</span>
                    <span className="text-xs text-[#6b6868] inline-flex items-center gap-1">
                      {!l.verified && <span>type in search</span>}
                      <ExternalLink size={12} />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel mt-6">
        <div className="panel-heading">
          <div>
            <h2>Official sources</h2>
            <p>Municipal and operator sites for manual hunting.</p>
          </div>
        </div>
        <div className="p-4 grid sm:grid-cols-2 gap-2">
          {[...HUNT_OFFICIAL_LINKS, ...HUNT_UNINGESTED_AGGREGATOR_LINKS].map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="flex items-center justify-between px-3 py-2 border border-[#e5e3e3] rounded-md text-sm text-[#171717] hover:bg-[#f5f4f4]">
              <span>{l.label}</span>
              <ExternalLink size={13} className="text-[#6b6868]" />
            </a>
          ))}
        </div>
      </div>

      <Dialog open={showGuide} onOpenChange={setShowGuide}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How to add a lot</DialogTitle>
            <DialogDescription>The quick-add flow for BDRs.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {[
              ['1', 'Paste a URL or address', 'Paste a SpotHero, Parkopedia, or any listing URL — or just an address. The system parses it automatically.'],
              ['2', 'Review the details', 'A dialog shows the parsed name, address, and source. Check it looks right before adding.'],
              ['3', 'Confirm', 'Hit "Confirm add". The lot is created as a draft and lands in the Work Queue for the 7-field checklist.'],
              ['4', 'Hunt by locality', 'Use the locality cards below to open aggregator deep links and find lots not yet in the system.'],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3">
                <b className="text-[#3b7a57] text-sm shrink-0">{n}</b>
                <div>
                  <h3 className="text-sm font-medium text-[#171717]">{t}</h3>
                  <p className="text-sm text-[#6b6868] leading-relaxed">{d}</p>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}