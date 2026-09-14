'use client';

import { useMemo, useState } from 'react';
import { Check, Zap, Settings2, ArrowUpRight, Database } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StatCards } from '@/components/spectrumui/charts/stat-cards';
import { TaskRows } from '@/components/spectrumui/blocks/ai-assistants/task-rows';
import { useData } from '@/components/outreach/DataContext';
import { useDetail } from '@/components/outreach/DetailContext';
import { isActive, priority, priorities, propertyValue } from '@/lib/outreach/workflow';
import { calculateScore } from '@/lib/outreach/sla';

const WORKFLOW_RULES = [
  ['01', 'A daily action queue', 'A dated plan is created when the workspace opens. Unfinished work carries forward.'],
  ['02', 'AI-first research is the target', 'AI should fill sourced property details: address, owner/operator, facility type, spaces, hours, access, PUDO, staging, accessibility and contact routes.'],
  ['03', 'BDRs review and email', 'BDRs verify the details, resolve missing information, prepare and send emails from their own inbox, log sent messages and replies, and follow up.'],
  ['04', 'SDRs own the calls', 'SDRs receive the research brief and BDR email history. They call to identify or qualify the decision-maker, resolve open questions and record the next step.'],
  ['05', 'Fewer duplicate conversations', 'Daily tasks group operator records. Updates affect only the selected property; portfolio-wide approval is never assumed.'],
];

export function MyDayView() {
  const data = useData();
  const { open } = useDetail();
  const [owner, setOwner] = useState('all');
  const [taskTab, setTaskTab] = useState('open');
  const [showRules, setShowRules] = useState(false);

  const owners = useMemo(
    () => [...new Set(Object.values(data.settings).filter((v) => typeof v === 'string'))] as string[],
    [data.settings],
  );

  const relevant = data.leads.filter((l) => isActive(l) && (owner === 'all' || l.assignee === owner));
  const visibleTasks = data.tasks.filter((t) => data.leads.some((l) => l.id === t.lead_id && isActive(l)));
  const tasks = visibleTasks
    .filter((t) => (owner === 'all' || t.owner === owner) && (taskTab === 'done' ? t.done === 1 : t.done === 0))
    .sort((a, b) => {
      const la = data.leads.find((l) => l.id === a.lead_id);
      const lb = data.leads.find((l) => l.id === b.lead_id);
      return (lb ? calculateScore(lb) : 0) - (la ? calculateScore(la) : 0);
    });

  const counts = Object.fromEntries(
    Object.keys({ research: 1, verify: 1, ready: 1, email_followup: 1, email_reply: 1, sdr: 1, followup: 1, qualified: 1, hold: 1 }).map((s) => [
      s,
      relevant.filter((l) => l.stage === s).length,
    ]),
  );

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span /> SUPPLY OPERATIONS
          </div>
          <h1>A clear plan. Every day.</h1>
          <p>Your next actions, prioritized and ready to work.</p>
        </div>
      </div>

      <div className="context-bar">
        <div>
          <strong>All markets</strong>
          <span className="divider" />
          {data.leads.length} imported locations
        </div>
        <div>
          {new Date(data.day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          <span className="divider" />
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="border-0 bg-transparent text-[13px] text-[#171717]">
            <option value="all">All team members</option>
            {owners.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="mb-7">
        <StatCards
          columns={4}
          cards={[
            { label: 'Properties in scope', value: relevant.length, caption: 'From your inventory' },
            { label: 'Need research', value: counts.research + counts.verify, caption: 'Decision-maker verification' },
            { label: 'BDR email queue', value: counts.ready + counts.email_followup + counts.email_reply, caption: 'Drafts, replies and follow-ups' },
            { label: 'In SDR queue', value: counts.sdr + counts.followup, caption: 'Calls and follow-ups' },
          ]}
        />
      </div>

      <div className="day-layout">
        <section className="panel task-panel">
          <div className="panel-heading">
            <div>
              <h2>Your action queue <span className="count">{tasks.length}</span></h2>
              <p>One action per operator and stage. Highest priority first.</p>
            </div>
            <span className="pill ready"><Zap size={12} /> Daily plan</span>
          </div>
          <div className="task-toolbar">
            <Tabs value={taskTab} onValueChange={(v) => setTaskTab(String(v))}>
              <TabsList className="bg-transparent p-0 gap-5 h-auto">
                <TabsTrigger value="open" className="px-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none">
                  To do <span className="ml-1 rounded bg-[#edf3ef] px-1.5 text-[10px] text-[#48715b]">{visibleTasks.filter((t) => !t.done && (owner === 'all' || t.owner === owner)).length}</span>
                </TabsTrigger>
                <TabsTrigger value="done" className="px-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none">Completed</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="ghost" className="text-[11px] text-[#6b6868] gap-1.5 p-0 h-auto"><Settings2 size={15} /> Refresh plan</Button>
          </div>
          <div className="task-list">
            {tasks.length === 0 ? (
              <div className="empty-state">
                <Check />
                <h3>{taskTab === 'done' ? 'No completed actions yet' : 'You’re all caught up'}</h3>
                <p>{taskTab === 'done' ? 'Completed reviews and handoffs appear here.' : 'Switch team member or explore the inventory.'}</p>
              </div>
            ) : (
              <TaskRows
                className="max-w-none rounded-none border-0 shadow-none"
                onTaskClick={(task) => {
                  const l = data.leads.find((l) => l.id === task.lead_id);
                  if (l) open(l);
                }}
                tasks={tasks.map((t) => {
                  const l = data.leads.find((l) => l.id === t.lead_id);
                  return {
                    id: t.id,
                    lead_id: t.lead_id,
                    title: l?.raw.name ?? '',
                    detail: t.title,
                    status: (t.done ? 'completed' : 'queued') as 'completed' | 'queued',
                    note: l ? `${t.owner} · ${propertyValue(l, 'operator')} · ${priorities[priority(l) - 1]}` : undefined,
                  };
                })}
              />
            )}
          </div>
        </section>
        <aside className="right-rail">
          <section className="panel workflow-card">
            <h2>The handoff, simplified</h2>
            {[
              ['1', 'Automated first pass', 'Source checks collect candidates. Full AI enrichment is not connected yet.', 'research'],
              ['2', 'BDR review & email', 'Verify details, email the property and track replies.', 'ready'],
              ['3', 'SDR call', 'Confirm interest, capacity and commercial terms.', 'sdr'],
            ].map(([n, t, d, c]) => (
              <div className="flow-step" key={n}>
                <span className={c}>{n}</span>
                <div><h3>{t}</h3><p>{d}</p></div>
              </div>
            ))}
            <button className="text-link" onClick={() => setShowRules(true)}>View workflow rules <ArrowUpRight size={15} /></button>
          </section>
          <div className="source-note">
            <Database size={17} />
            <div>Your inventory is the starting point.<p>Public prices and facility capacity are not confirmed fleet offers.</p></div>
          </div>
        </aside>
      </div>

      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How work moves</DialogTitle>
            <DialogDescription>The workflow rules that keep the pipeline moving.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {WORKFLOW_RULES.map(([n, t, d]) => (
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