'use client';

import { useMemo, useState } from 'react';
import { Search, Download, AlertCircle, Phone } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { useData } from '@/components/outreach/DataContext';
import { useDetail } from '@/components/outreach/DetailContext';
import { isActive, priority, priorities, gaps, completion, propertyValue, stages } from '@/lib/outreach/workflow';

function Pill({ stage }: { stage: string }) {
  return <span className={'pill ' + stage}><i />{stages[stage] || stage}</span>;
}

export function PropertiesView({ removed = false }: { removed?: boolean }) {
  const data = useData();
  const { open } = useDetail();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [gapFilter, setGapFilter] = useState('all');
  const [page, setPage] = useState(0);

  const scoped = removed ? data.leads.filter((l) => !isActive(l)) : data.leads.filter(isActive);
  const leads = scoped
    .filter(
      (l) =>
        (filter === 'all' || l.stage === filter) &&
        (priorityFilter === 'all' || priority(l) === Number(priorityFilter)) &&
        (gapFilter === 'all' || (gapFilter === 'missing' ? gaps(l).length > 0 : gaps(l).length === 0)) &&
        `${l.raw.name} ${l.raw.address} ${propertyValue(l, 'operator')} ${l.contact_name}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));

  const selectCls = 'h-8 rounded-md border border-[#e5e3e3] px-3 text-[13px] text-[#171717] bg-white';

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> SUPPLY</div>
          <h1>{removed ? 'Hidden & archived' : 'Your next parking partners.'}</h1>
          <p>{removed ? 'Removed from team queues.' : 'Every property, contact and source in one place.'}</p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{removed ? 'Hidden & archived' : 'Property inventory'} <span className="count">{leads.length}</span></h2>
            <p>Select a location for its evidence, contacts and next action.</p>
          </div>
          <a className="export-link" href="/api/export"><Download size={16} /> Export CSV</a>
        </div>
        <div className="inventory-toolbar">
          <div className="search-field">
            <Search size={17} />
            <Input aria-label="Search properties" placeholder="Search properties, operators or contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={selectCls}>
            <option value="all">All stages</option>
            {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="inventory-filters">
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className={selectCls}>
            <option value="all">All priorities</option>
            {priorities.map((label, i) => <option key={i} value={String(i + 1)}>{label}</option>)}
          </select>
          <select value={gapFilter} onChange={(e) => setGapFilter(e.target.value)} className={selectCls}>
            <option value="all">All information</option>
            <option value="missing">Has missing / unconfirmed info</option>
            <option value="complete">All tracked details recorded</option>
          </select>
          <span className="muted">Sorted by priority · 1 is highest</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PROPERTY</TableHead>
              <TableHead>CONTACT</TableHead>
              <TableHead>STAGE</TableHead>
              <TableHead>OWNER</TableHead>
              <TableHead>PRIORITY</TableHead>
              <TableHead>MISSING INFORMATION</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.slice(page * 20, page * 20 + 20).map((l) => (
              <TableRow key={l.id} className="property-row" onClick={() => open(l)}>
                <TableCell>
                  <button className="property-name" onClick={() => open(l)}>{l.raw.name}</button>
                  <div className="muted">{l.raw.address} · {propertyValue(l, 'operator')}</div>
                </TableCell>
                <TableCell>
                  <span>{l.contact_name || 'Decision-maker needed'}</span>
                  <div className="muted">{l.email || l.phone || 'No contact route yet'}</div>
                </TableCell>
                <TableCell>{isActive(l) ? <Pill stage={l.stage} /> : <span className="pill">{l.visibility}</span>}</TableCell>
                <TableCell>
                  <div className="owner-cell"><span className="mini-avatar">{l.assignee.slice(0, 2).toUpperCase()}</span>{l.assignee}</div>
                </TableCell>
                <TableCell><span className="priority">{priorities[priority(l) - 1]}</span></TableCell>
                <TableCell>
                  {gaps(l).length === 0 ? (
                    <span className="info-complete">All tracked details recorded</span>
                  ) : (
                    <div className="gap-summary">
                      <strong><AlertCircle size={14} />{gaps(l).length} details need attention</strong>
                      <div className="gap-chips">{gaps(l).slice(0, 3).map((f) => <span key={f.key}>{f.label} {f.status === 'missing' ? 'missing' : 'unconfirmed'}</span>)}</div>
                    </div>
                  )}
                  <div className="completeness"><Progress value={completion(l)} /><span>{completion(l)}%</span></div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {leads.length === 0 && (
          <div className="empty-state"><Phone /><h3>No matching properties</h3><p>Try another search or stage.</p></div>
        )}
        <div className="table-footer">
          <span>Showing {leads.length ? page * 20 + 1 : 0}–{Math.min((page + 1) * 20, leads.length)} of {leads.length}</span>
          <div>
            <Button variant="outline" disabled={!page} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" disabled={(page + 1) * 20 >= leads.length} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </section>
    </>
  );
}