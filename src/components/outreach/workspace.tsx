'use client';

import { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Bell,
  Building2,
  Check,
  ChevronRight,
  ClipboardList,
  Database,
  Download,
  FlaskConical,
  LayoutGrid,
  Mail,
  MapPin,
  Phone,
  Search,
  Settings2,
  Users,
  Zap,
  Clock,
  Archive,
  AlertCircle,
} from 'lucide-react';
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Data,
  Lead,
  stages,
  completion,
  isActive,
  priority,
  priorities,
  gaps,
  propertyValue,
  nextAction,
} from '@/lib/outreach/workflow';

const nav = [
  ['today', 'My day', LayoutGrid],
  ['properties', 'Properties', Building2],
  ['sites', 'Site intelligence', MapPin],
  ['research', 'Research desk', FlaskConical],
  ['email', 'BDR email queue', Mail],
  ['sdr', 'SDR call queue', Phone],
  ['pipeline', 'Pipeline', ClipboardList],
  ['removed', 'Hidden & archived', Archive],
  ['team', 'Team & workflow', Users],
] as const;

function Pill({ stage }: { stage: string }) {
  return (
    <span className={'pill ' + stage}>
      <i />
      {stages[stage] || stage}
    </span>
  );
}

function Picker({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const headings: Record<string, [string, string]> = {
  sites: ['Understand the site.', 'Geometry, owner posture, power and field evidence alongside the sales workflow.'],
  today: ['A clear plan. Every day.', 'Your next actions, prioritized and ready to work.'],
  properties: ['Your next parking partners.', 'Every property, contact and source in one place.'],
  removed: ['Hidden & archived properties', 'Removed from team queues. Restore a property whenever it becomes relevant again.'],
  research: ['Turn locations into conversations.', 'Find the operator. Verify the decision-maker. Complete the brief.'],
  email: ['BDRs start the conversation.', 'Review the research, email the property contact and keep the next step clear.'],
  sdr: ['Make every call count.', 'Prepared handoffs with the right context and a clear next step.'],
  pipeline: ['From parking lot to partner.', 'Track the work from first research to a qualified opportunity.'],
  team: ['One team. A connected workflow.', 'Set the owners and keep the next step unambiguous.'],
};

export default function Workspace({ initialData }: { initialData: Data }) {
  const [data] = useState<Data>(initialData);
  const [view, setView] = useState('today');
  const [owner, setOwner] = useState('all');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [gapFilter, setGapFilter] = useState('all');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [taskTab, setTaskTab] = useState('open');
  const [page, setPage] = useState(0);

  const owners = useMemo(
    () => [...new Set(Object.values(data.settings).filter((v) => typeof v === 'string'))] as string[],
    [data.settings],
  );

  const relevant = data.leads.filter((l) => isActive(l) && (owner === 'all' || l.assignee === owner));
  const visibleTasks = data.tasks.filter((t) => data.leads.some((l) => l.id === t.lead_id && isActive(l)));
  const tasks = visibleTasks
    .filter((t) => (owner === 'all' || t.owner === owner) && (taskTab === 'done' ? t.done === 1 : t.done === 0))
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        priority(data.leads.find((l) => l.id === a.lead_id)!) - priority(data.leads.find((l) => l.id === b.lead_id)!),
    );

  const scoped = view === 'removed' ? data.leads.filter((l) => !isActive(l) && (owner === 'all' || l.assignee === owner)) : relevant;
  const leads = scoped
    .filter(
      (l) =>
        (view !== 'research' || ['research', 'verify'].includes(l.stage)) &&
        (view !== 'sdr' || ['sdr', 'followup'].includes(l.stage)) &&
        (view !== 'email' || ['ready', 'email_followup', 'email_reply'].includes(l.stage)) &&
        (filter === 'all' || l.stage === filter) &&
        (priorityFilter === 'all' || priority(l) === Number(priorityFilter)) &&
        (gapFilter === 'all' || (gapFilter === 'missing' ? gaps(l).length > 0 : gaps(l).length === 0)) &&
        `${l.raw.name} ${l.raw.address} ${propertyValue(l, 'operator')} ${l.contact_name} ${l.id}`.toLowerCase().includes(q.toLowerCase()),
    )
    .sort((a, b) => priority(a) - priority(b) || a.id.localeCompare(b.id));

  const counts = Object.fromEntries(Object.keys(stages).map((s) => [s, relevant.filter((l) => l.stage === s).length]));

  function go(v: string) {
    setView(v);
    setFilter('all');
    setQ('');
    setPriorityFilter('all');
    setGapFilter('all');
    setPage(0);
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '238px' } as React.CSSProperties}>
      <Sidebar className="xp-sidebar">
        <SidebarHeader>
          <div className="logo">
            <span className="logo-mark">
              x<span>p</span>
            </span>
            <span>
              xoompark<span className="logo-dot">.</span>
            </span>
          </div>
          <div className="workspace-label">
            <span className="workspace-square">SF</span>
            <div>
              Supply workspace<small>San Francisco</small>
            </div>
            <ChevronRight size={15} />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-caption">WORKSPACE</div>
          <SidebarMenu>
            {nav.map(([id, label, Icon]) => (
              <SidebarMenuItem key={id}>
                <SidebarMenuButton isActive={view === id} onClick={() => go(id)} className="nav-link">
                  <Icon />
                  <span>{label}</span>
                  {id === 'properties' && <small>{data.leads.filter(isActive).length}</small>}
                  {id === 'sdr' && counts.sdr > 0 && <small>{counts.sdr}</small>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-tip">
            <span>
              <Zap size={17} /> Built for the next step
            </span>
            <p>Source enrichment → BDR review & email → SDR call.</p>
            <button onClick={() => go('team')}>
              See how it works <ArrowUpRight size={14} />
            </button>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="sync">
            <i /> Inventory imported
            <small>{data.leads.length} properties · Sep 7, 2026</small>
          </div>
          <div className="profile">
            <span className="avatar dark">XP</span>
            <div>
              XoomPark team<small>Private preview · role simulation</small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="xp-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <SidebarTrigger />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{nav.find((n) => n[0] === view)?.[1]}</strong>
          </div>
          <div className="top-actions">
            <span className="live">
              <i /> Live workspace
            </span>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
            </button>
            <span className="avatar">XP</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> SAN FRANCISCO OPERATIONS
              </div>
              <h1>{headings[view][0]}</h1>
              <p>{headings[view][1]}</p>
            </div>
            <div className="heading-actions">
              <Button className="secondary" onClick={() => go('properties')}>
                <Building2 /> Explore properties <ArrowUpRight />
              </Button>
            </div>
          </div>
          <div className="context-bar">
            <div>
              <MapPin size={16} />
              <strong>San Francisco, CA</strong>
              <span className="divider" />
              {data.leads.length} imported locations
            </div>
            <div>
              <Clock size={15} />
              {new Date(data.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              <span className="divider" />
              <Picker
                label="View team member"
                value={owner}
                onChange={setOwner}
                options={[{ value: 'all', label: 'All team members' }, ...owners.map((v) => ({ value: v, label: v }))]}
              />
            </div>
          </div>
          {view !== 'team' && (
            <div className="stats">
              {[
                [relevant.length, 'Properties in scope', 'From your SF inventory', Building2, 'neutral'],
                [counts.research + counts.verify, 'Need research', 'Decision-maker verification', Search, 'amber'],
                [counts.ready + counts.email_followup + counts.email_reply, 'BDR email queue', 'Drafts, replies and follow-ups', Mail, 'green'],
                [counts.sdr + counts.followup, 'In SDR queue', 'Calls and follow-ups', Phone, 'purple'],
              ].map(([n, t, s, I, c]) => {
                const Icon = I as typeof Building2;
                return (
                  <div className="stat" key={String(t)}>
                    <div>
                      <span>{String(t)}</span>
                      <Icon size={18} />
                    </div>
                    <strong>{String(n).padStart(2, '0')}</strong>
                    <small className={String(c)}>
                      <i />
                      {String(s)}
                    </small>
                  </div>
                );
              })}
            </div>
          )}
          {view === 'today' && (
            <div className="day-layout">
              <section className="panel task-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Your action queue <span className="count">{tasks.length}</span>
                    </h2>
                    <p>One action per operator and stage. Highest priority first.</p>
                  </div>
                  <span className="pill ready">
                    <Zap size={12} /> Daily plan
                  </span>
                </div>
                <div className="task-toolbar">
                  <Tabs value={taskTab} onValueChange={(v) => setTaskTab(String(v))}>
                    <TabsList className="bg-transparent p-0 gap-5 h-auto">
                      <TabsTrigger value="open" className="px-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                        To do{' '}
                        <span className="ml-1 rounded bg-[#edf3ef] px-1.5 text-[10px] text-[#48715b]">
                          {visibleTasks.filter((t) => !t.done && (owner === 'all' || t.owner === owner)).length}
                        </span>
                      </TabsTrigger>
                      <TabsTrigger value="done" className="px-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                        Completed
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button variant="ghost" className="text-[11px] text-[#83909a] gap-1.5 p-0 h-auto">
                    <Settings2 size={15} /> Refresh plan
                  </Button>
                </div>
                <div className="task-list">
                  {tasks.length === 0 ? (
                    <div className="empty-state">
                      <Check />
                      <h3>{taskTab === 'done' ? 'No completed actions yet' : 'You’re all caught up'}</h3>
                      <p>{taskTab === 'done' ? 'Completed reviews and handoffs appear here.' : 'Switch team member or explore the inventory.'}</p>
                    </div>
                  ) : (
                    tasks.map((t) => {
                      const l = data.leads.find((l) => l.id === t.lead_id);
                      if (!l) return null;
                      return (
                        <button className="task-card" key={t.id} onClick={() => setSelected(l)}>
                          <span className={'task-icon ' + l.stage}>
                            {l.stage === 'sdr' ? <Phone size={19} /> : ['ready', 'email_followup', 'email_reply'].includes(l.stage) ? <Mail size={19} /> : <Search size={19} />}
                          </span>
                          <div className="task-copy">
                            <div className="task-meta">
                              <span className={priority(l) === 1 ? 'priority high' : 'priority'}>{priorities[priority(l) - 1]}</span>
                              <span>{propertyValue(l, 'operator')}</span>
                              {t.group_count > 1 && <span>+{t.group_count - 1} related</span>}
                            </div>
                            <h3>{l.raw.name}</h3>
                            <p>{t.title}</p>
                            <div className="task-bottom">
                              <span className="mini-avatar">{t.owner.slice(0, 2).toUpperCase()}</span>
                              {t.owner}
                              <span>·</span>
                              <span>{t.day < data.day ? 'Carried forward' : 'Today'}</span>
                            </div>
                          </div>
                          <ChevronRight className="task-arrow" size={18} />
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
              <aside className="right-rail">
                <div className="focus-card">
                  <div className="focus-top">
                    <span>
                      <Zap size={16} /> TODAY’S FOCUS
                    </span>
                    <span>01</span>
                  </div>
                  <h2>
                    Find the person.
                    <br />
                    Unlock the property.
                  </h2>
                  <p>Start with the official operator source. A front-desk number is a route in, not a confirmed decision-maker.</p>
                  <Button onClick={() => { go('research'); setOwner(data.settings.researcher); }}>
                    Open research desk <ArrowRight size={16} />
                  </Button>
                  <div className="focus-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <section className="panel workflow-card">
                  <h2>The handoff, simplified</h2>
                  {[
                    ['1', 'Automated first pass', 'Source checks collect candidates. Full AI enrichment is not connected yet.', 'research'],
                    ['2', 'BDR review & email', 'Verify details, email the property and track replies.', 'ready'],
                    ['3', 'SDR call', 'Confirm interest, capacity and commercial terms.', 'sdr'],
                  ].map(([n, t, d, c]) => (
                    <div className="flow-step" key={n}>
                      <span className={c}>{n}</span>
                      <div>
                        <h3>{t}</h3>
                        <p>{d}</p>
                      </div>
                    </div>
                  ))}
                  <button className="text-link" onClick={() => go('team')}>
                    View workflow rules <ArrowUpRight size={15} />
                  </button>
                </section>
                <div className="source-note">
                  <Database size={17} />
                  <div>
                    Your inventory is the starting point.
                    <p>Public prices and facility capacity are not confirmed fleet offers.</p>
                  </div>
                </div>
              </aside>
            </div>
          )}
          {['properties', 'research', 'email', 'sdr', 'removed'].includes(view) && (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>
                    {view === 'removed' ? 'Hidden & archived' : view === 'email' ? 'BDR email outreach' : view === 'sdr' ? 'Call-ready handoffs' : view === 'research' ? 'Research inventory' : 'Property inventory'}{' '}
                    <span className="count">{leads.length}</span>
                  </h2>
                  <p>Select a location for its evidence, contacts and next action.</p>
                </div>
                <a className="export-link" href="/api/export">
                  <Download size={16} /> Export CSV
                </a>
              </div>
              <div className="inventory-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <Input aria-label="Search properties" placeholder="Search properties, operators or contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <Picker
                  label="Filter by stage"
                  value={filter}
                  onChange={setFilter}
                  options={[{ value: 'all', label: 'All stages' }, ...Object.entries(stages).map(([value, label]) => ({ value, label }))]}
                />
              </div>
              <div className="inventory-filters">
                <Picker
                  label="Filter by priority"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  options={[{ value: 'all', label: 'All priorities' }, ...priorities.map((label, i) => ({ value: String(i + 1), label }))]}
                />
                <Picker
                  label="Filter missing information"
                  value={gapFilter}
                  onChange={setGapFilter}
                  options={[
                    { value: 'all', label: 'All information' },
                    { value: 'missing', label: 'Has missing / unconfirmed info' },
                    { value: 'complete', label: 'All tracked details recorded' },
                  ]}
                />
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
                    <TableRow key={l.id} className="property-row" onClick={() => setSelected(l)}>
                      <TableCell>
                        <button className="property-name" onClick={() => setSelected(l)}>
                          {l.raw.name}
                        </button>
                        <div className="muted">
                          {l.raw.address} · {propertyValue(l, 'operator')}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span>{l.contact_name || 'Decision-maker needed'}</span>
                        <div className="muted">{l.email || l.phone || 'No contact route yet'}</div>
                      </TableCell>
                      <TableCell>{isActive(l) ? <Pill stage={l.stage} /> : <span className="pill">{l.visibility}</span>}</TableCell>
                      <TableCell>
                        <div className="owner-cell">
                          <span className="mini-avatar">{l.assignee.slice(0, 2).toUpperCase()}</span>
                          {l.assignee}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="priority">{priorities[priority(l) - 1]}</span>
                      </TableCell>
                      <TableCell>
                        {gaps(l).length === 0 ? (
                          <span className="info-complete">All tracked details recorded</span>
                        ) : (
                          <div className="gap-summary">
                            <strong>
                              <AlertCircle size={14} />
                              {gaps(l).length} details need attention
                            </strong>
                            <div className="gap-chips">
                              {gaps(l).slice(0, 3).map((f) => (
                                <span key={f.key}>
                                  {f.label} {f.status === 'missing' ? 'missing' : 'unconfirmed'}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="completeness">
                          <Progress value={completion(l)} />
                          <span>{completion(l)}%</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {leads.length === 0 && (
                <div className="empty-state">
                  <Phone />
                  <h3>{view === 'email' ? 'No properties queued for email yet' : view === 'sdr' ? 'No calls handed off yet' : 'No matching properties'}</h3>
                  <p>{view === 'email' ? 'Open a property with a published business email and choose Queue for BDR email.' : view === 'sdr' ? 'Open a property with a phone route and send the brief to SDR.' : 'Try another search or stage.'}</p>
                </div>
              )}
              <div className="table-footer">
                <span>
                  Showing {leads.length ? page * 20 + 1 : 0}–{Math.min((page + 1) * 20, leads.length)} of {leads.length}
                </span>
                <div>
                  <Button variant="outline" disabled={!page} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" disabled={(page + 1) * 20 >= leads.length} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </section>
          )}
          {view === 'pipeline' && (
            <div className="kanban">
              {Object.entries(stages).map(([key, label]) => (
                <section className="kanban-column" key={key}>
                  <h2>
                    <Pill stage={key} />
                    <span>{counts[key]}</span>
                  </h2>
                  {relevant
                    .filter((l) => l.stage === key)
                    .slice(0, 15)
                    .map((l) => (
                      <button key={l.id} className="kanban-card" onClick={() => setSelected(l)}>
                        <small>
                          {propertyValue(l, 'operator')} · {l.id}
                        </small>
                        <h3>{l.raw.name}</h3>
                        <p>{l.contact_name || 'Decision-maker needed'}</p>
                        <footer>
                          <span className="mini-avatar">{l.assignee.slice(0, 2).toUpperCase()}</span>
                          {l.assignee}
                          <ChevronRight size={15} />
                        </footer>
                      </button>
                    ))}
                  {counts[key] > 15 && (
                    <button className="text-link" onClick={() => { go('properties'); setFilter(key); }}>
                      View all {counts[key]} <ArrowRight size={14} />
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}
          {view === 'team' && (
            <div className="team-layout">
              <section className="panel settings-panel">
                <h2>Who owns the next step?</h2>
                <p className="muted">Preview role names, not authenticated employee accounts.</p>
                <form style={{ display: 'grid', gap: 18, marginTop: 28 }}>
                  {[
                    ['researcher', 'Research owner'],
                    ['bdr1', 'BDR · territory A'],
                    ['bdr2', 'BDR · territory B'],
                    ['sdr', 'SDR call owner'],
                  ].map(([key, label]) => (
                    <label key={key} style={{ display: 'grid', gap: 8, fontSize: 13, color: '#68808a' }}>
                      {label}
                      <Input name={key} defaultValue={String(data.settings[key as keyof typeof data.settings])} readOnly />
                    </label>
                  ))}
                  <label style={{ display: 'grid', gap: 8, fontSize: 13, color: '#68808a' }}>
                    Daily operator groups per person
                    <Input name="dailyLimit" type="number" defaultValue={data.settings.dailyLimit} readOnly />
                  </label>
                </form>
              </section>
              <section className="panel settings-panel">
                <h2>How work moves</h2>
                {[
                  ['01', 'A daily action queue', 'A dated plan is created when the workspace opens. Unfinished work carries forward.'],
                  ['02', 'AI-first research is the target', 'AI should fill sourced property details: address, owner/operator, facility type, spaces, hours, access, PUDO, staging, accessibility and contact routes.'],
                  ['03', 'BDRs review and email', 'BDRs verify the details, resolve missing information, prepare and send emails from their own inbox, log sent messages and replies, and follow up.'],
                  ['04', 'SDRs own the calls', 'SDRs receive the research brief and BDR email history. They call to identify or qualify the decision-maker, resolve open questions and record the next step.'],
                  ['05', 'Fewer duplicate conversations', 'Daily tasks group operator records. Updates affect only the selected property; portfolio-wide approval is never assumed.'],
                ].map(([n, t, d]) => (
                  <div className="rule" key={n}>
                    <b>{n}</b>
                    <div>
                      <h3>{t}</h3>
                      <p>{d}</p>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          )}
          <footer className="page-footer">
            <span>XoomPark Supply Operations</span>
            <span>Source snapshot: September 7, 2026 · {data.leads.length} records</span>
          </footer>
        </main>
      </SidebarInset>
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <SheetContent className="detail-sheet">
          <SheetHeader>
            <SheetTitle>Property workspace</SheetTitle>
            <SheetDescription>Research, review and hand off with context.</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="detail-body">
              <h2>{selected.raw.name}</h2>
              <div className="detail-topline">
                <Pill stage={selected.stage} />
                <span className="muted">{selected.raw.address}</span>
              </div>
              <div className="next-action">
                <Zap size={18} />
                <div>
                  <strong>Next action</strong>
                  <p>{nextAction(selected)}</p>
                </div>
              </div>
              <section className="detail-section">
                <h3>Contact</h3>
                <div className="detail-info-grid">
                  <div>
                    <small>Contact name</small>
                    <span>{selected.contact_name || 'Decision-maker needed'}</span>
                  </div>
                  <div>
                    <small>Role</small>
                    <span>{selected.contact_role || '—'}</span>
                  </div>
                  <div>
                    <small>Business email</small>
                    <span>{selected.email || '—'}</span>
                  </div>
                  <div>
                    <small>Phone</small>
                    <span>{selected.phone || '—'}</span>
                  </div>
                </div>
              </section>
              <section className="detail-section">
                <h3>Property details</h3>
                <div className="detail-info-grid">
                  {Object.entries(selected.property_details ?? {}).map(([k, v]) => (
                    <div key={k}>
                      <small>{k.replaceAll('_', ' ')}</small>
                      <span>{v || '—'}</span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="detail-section">
                <h3>Missing information</h3>
                {gaps(selected).length === 0 ? (
                  <p className="info-complete">All tracked details recorded</p>
                ) : (
                  <div className="gap-chips">
                    {gaps(selected).map((f) => (
                      <span key={f.key} className={f.status}>
                        {f.label} · {f.status}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}