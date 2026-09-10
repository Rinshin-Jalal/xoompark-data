'use client';

import { useState } from 'react';
import { OUTREACH_STATES, OUTREACH_STATE_LABELS } from '@/lib/sourcing/types';
import type { OutreachRecord, SourcedParkingLocation } from '@/lib/sourcing/types';
import { exportOutreachCsv } from '../actions';

type Row = { lot: SourcedParkingLocation; outreach: OutreachRecord };

const STATE_COLORS: Record<string, string> = {
  ready: 'bg-slate-100 text-slate-700 border-slate-200',
  sent: 'bg-sky-50 text-sky-700 border-sky-200',
  called: 'bg-blue-50 text-blue-700 border-blue-200',
  responded: 'bg-amber-50 text-amber-700 border-amber-200',
  quoted: 'bg-green-50 text-green-700 border-green-200',
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DailyReportClient({ rows }: { rows: Row[] }) {
  const [downloading, setDownloading] = useState(false);

  // counts by state
  const counts = OUTREACH_STATES.reduce(
    (acc, s) => {
      acc[s] = rows.filter((r) => r.outreach.outreachState === s).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  const total = rows.length;
  const inquiryCount = rows.filter((r) => r.outreach.inquirySent).length;
  const callCount = rows.filter((r) => r.outreach.callMade).length;
  const formCount = rows.filter((r) => r.outreach.formSubmitted).length;

  async function handleDownload() {
    setDownloading(true);
    try {
      const csv = await exportOutreachCsv();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `outreach-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {OUTREACH_STATES.map((s) => (
          <div
            key={s}
            className="border border-[#0e1c36]/12 bg-white p-4 rounded"
          >
            <div className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">
              {OUTREACH_STATE_LABELS[s]}
            </div>
            <div className="text-2xl font-bold text-[#0e1c36] mt-1">
              {counts[s] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Activity summary */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="border border-[#0e1c36]/12 bg-white p-3 rounded">
          <div className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Total outreach</div>
          <div className="text-lg font-bold text-[#0e1c36]">{total}</div>
        </div>
        <div className="border border-[#0e1c36]/12 bg-white p-3 rounded">
          <div className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Inquiries sent</div>
          <div className="text-lg font-bold text-[#0e1c36]">{inquiryCount}</div>
        </div>
        <div className="border border-[#0e1c36]/12 bg-white p-3 rounded">
          <div className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Calls made</div>
          <div className="text-lg font-bold text-[#0e1c36]">{callCount}</div>
        </div>
        <div className="border border-[#0e1c36]/12 bg-white p-3 rounded">
          <div className="text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Forms submitted</div>
          <div className="text-lg font-bold text-[#0e1c36]">{formCount}</div>
        </div>
      </div>

      {/* Export button */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#0e1c36]/50">
          {total} lot{total === 1 ? '' : 's'} with outreach records
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-4 py-2 text-sm font-mono uppercase tracking-wide border border-[#0e1c36]/25 rounded text-[#0e1c36] hover:bg-[#0e1c36]/5 disabled:opacity-50"
        >
          {downloading ? 'Exporting…' : 'Export CSV ↗'}
        </button>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="border border-[#0e1c36]/12 bg-white p-10 text-center text-sm text-[#0e1c36]/50">
          No outreach records yet. Start by claiming a lot in the Work Queue.
        </div>
      ) : (
        <div className="border border-[#0e1c36]/12 bg-white overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0e1c36]/10 text-left">
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Lot</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Contact</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Inquiry</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">State</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Offer</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">BDR</th>
                <th className="px-3 py-2 text-[10px] font-mono uppercase tracking-wide text-[#0e1c36]/40">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.outreach.id} className="border-b border-[#0e1c36]/6 last:border-b-0 hover:bg-[#0e1c36]/[.02]">
                  <td className="px-3 py-2">
                    <a
                      href={r.lot.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#0e1c36] hover:text-[#1a3a7a] hover:underline font-medium max-w-[14rem] truncate block"
                      title={r.lot.name}
                    >
                      {r.lot.name}
                    </a>
                    <span className="text-[10px] text-[#0e1c36]/40">{r.lot.locality ?? r.lot.source}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-[#0e1c36]/80">{r.outreach.contactName || '—'}</span>
                    {r.outreach.contactRole && (
                      <span className="text-[10px] text-[#0e1c36]/40 ml-1">({r.outreach.contactRole})</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1.5">
                      {r.outreach.inquirySent && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EAF7F0] text-[#16805A]">email</span>}
                      {r.outreach.callMade && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EAF7F0] text-[#16805A]">call</span>}
                      {r.outreach.formSubmitted && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#EAF7F0] text-[#16805A]">form</span>}
                      {!r.outreach.inquirySent && !r.outreach.callMade && !r.outreach.formSubmitted && (
                        <span className="text-[#0e1c36]/30">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full border whitespace-nowrap ${STATE_COLORS[r.outreach.outreachState] ?? ''}`}
                    >
                      {OUTREACH_STATE_LABELS[r.outreach.outreachState]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[#0e1c36]/70">
                    {r.outreach.offerSpaces != null ? `${r.outreach.offerSpaces} spaces` : '—'}
                    {r.outreach.offerPrice && <span className="ml-1">· {r.outreach.offerPrice}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#0e1c36]/70">{r.outreach.bdrOwner || '—'}</td>
                  <td className="px-3 py-2 text-xs text-[#0e1c36]/50" title={r.outreach.updatedAt}>
                    {formatWhen(r.outreach.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
