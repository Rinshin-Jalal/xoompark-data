// Plain assert-based tests, runnable with `node --experimental-strip-types`.
// Covers the outreach pure logic: score/SLA, roles gating, and the daily plan.
import assert from 'node:assert/strict';
import { calculateScore, isOverdue, slaWarning, sortByScore } from '../sla.ts';
import { canAccess, ROLE_ROUTES } from '../roles.ts';
import { plan, nextAction, gaps, completion, draftEmail } from '../workflow.ts';
import type { Lead } from '../workflow.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lot-1',
    raw: {
      id: 'lot-1',
      name: 'Test Lot',
      address: '123 Main St',
      operator: 'Test Operator',
      contact_name: '',
      email: '',
      phone: '',
      priority: '2',
      status: 'draft',
      requested_spaces: '20',
      next_action: '',
      contact_group: 'Test Operator',
      contact_source: '',
      stall_count: '50',
      is_24_7: '',
      is_fenced: '',
      is_lit: '',
      ingress_egress: '',
      clearance_text: '',
      price_text: '',
      hours_text: '',
      source_name: 'manual',
      company_account_id: 'test-operator',
      next_touch_at: '',
    },
    stage: 'research',
    assignee: 'Rinshin',
    contact_name: '',
    contact_role: '',
    email: '',
    phone: '',
    verified: 0,
    evidence: '',
    notes: '',
    due: '',
    updated: '',
    revision: 0,
    research: null,
    property_details: {},
    property_evidence: '',
    property_sources: {},
    ...overrides,
  };
}

// ── Score / SLA ────────────────────────────────────────────────────────────

test('calculateScore: qualified beats research', () => {
  const qualified = makeLead({ stage: 'qualified' });
  const research = makeLead({ stage: 'research' });
  assert.ok(calculateScore(qualified) > calculateScore(research));
});

test('calculateScore: big lot beats small lot at same stage', () => {
  const big = makeLead({ stage: 'research', raw: { ...makeLead().raw, stall_count: '200' } });
  const small = makeLead({ stage: 'research', raw: { ...makeLead().raw, stall_count: '10' } });
  assert.ok(calculateScore(big) > calculateScore(small));
});

test('calculateScore: overdue follow-up scores higher', () => {
  const overdue = makeLead({
    stage: 'email_followup',
    raw: { ...makeLead().raw, next_touch_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() },
  });
  const fresh = makeLead({ stage: 'email_followup' });
  assert.ok(calculateScore(overdue) > calculateScore(fresh));
});

test('isOverdue: true when next_touch_at passed', () => {
  const past = makeLead({ raw: { ...makeLead().raw, next_touch_at: new Date(Date.now() - 1000).toISOString() } });
  const future = makeLead({ raw: { ...makeLead().raw, next_touch_at: new Date(Date.now() + 1000).toISOString() } });
  assert.equal(isOverdue(past), true);
  assert.equal(isOverdue(future), false);
});

test('slaWarning: overdue follow-up', () => {
  const l = makeLead({
    stage: 'email_followup',
    raw: { ...makeLead().raw, next_touch_at: new Date(Date.now() - 1000).toISOString() },
  });
  assert.equal(slaWarning(l), 'Follow-up overdue');
});

test('sortByScore: descending order', () => {
  const leads = [
    makeLead({ id: 'a', stage: 'research' }),
    makeLead({ id: 'b', stage: 'qualified' }),
    makeLead({ id: 'c', stage: 'verify' }),
  ];
  const sorted = sortByScore(leads);
  assert.equal(sorted[0].id, 'b'); // qualified first
});

// ── Roles ──────────────────────────────────────────────────────────────────

test('canAccess: admin sees everything', () => {
  assert.equal(canAccess(['admin'], '/sdr-call'), true);
  assert.equal(canAccess(['admin'], '/team'), true);
});

test('canAccess: bdr does not see sdr routes', () => {
  assert.equal(canAccess(['bdr'], '/work-queue'), true);
  assert.equal(canAccess(['bdr'], '/sdr-call'), false);
  assert.equal(canAccess(['bdr'], '/pipeline'), false);
});

test('canAccess: sdr does not see bdr routes', () => {
  assert.equal(canAccess(['sdr'], '/sdr-call'), true);
  assert.equal(canAccess(['sdr'], '/work-queue'), false);
  assert.equal(canAccess(['sdr'], '/bdr-email'), false);
});

test('canAccess: multi-role union', () => {
  assert.equal(canAccess(['bdr', 'sdr'], '/work-queue'), true);
  assert.equal(canAccess(['bdr', 'sdr'], '/sdr-call'), true);
});

test('canAccess: empty roles sees nothing', () => {
  assert.equal(canAccess([], '/'), false);
});

test('ROLE_ROUTES: every role can see home', () => {
  for (const routes of Object.values(ROLE_ROUTES)) {
    assert.ok(routes.includes('/'));
  }
});

// ── Plan / next action ─────────────────────────────────────────────────────

test('plan: generates one task per operator+stage group', () => {
  const base = makeLead().raw;
  const leads = [
    makeLead({ id: 'a', stage: 'research', raw: { ...base, operator: 'Op A', contact_group: 'Op A' } }),
    makeLead({ id: 'b', stage: 'research', raw: { ...base, operator: 'Op A', contact_group: 'Op A' } }),
    makeLead({ id: 'c', stage: 'research', raw: { ...base, operator: 'Op B', contact_group: 'Op B' } }),
  ];
  const tasks = plan(leads, '2026-09-12', 12);
  // Op A (2 lots) + Op B (1 lot) = 2 groups
  assert.equal(tasks.length, 2);
  const opA = tasks.find((t) => t.lead_id === 'a');
  assert.equal(opA?.group_count, 2);
});

test('plan: skips hold and qualified', () => {
  const leads = [
    makeLead({ id: 'a', stage: 'hold' }),
    makeLead({ id: 'b', stage: 'qualified' }),
    makeLead({ id: 'c', stage: 'research' }),
  ];
  const tasks = plan(leads, '2026-09-12', 12);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].lead_id, 'c');
});

test('nextAction: research stage asks for contact', () => {
  const l = makeLead({ stage: 'research' });
  assert.match(nextAction(l), /Find the person responsible/);
});

test('nextAction: sdr stage asks to call', () => {
  const l = makeLead({ stage: 'sdr', phone: '(415) 555-0142' });
  assert.match(nextAction(l), /Call/);
});

// ── Gaps / completion ──────────────────────────────────────────────────────

test('gaps: empty contact + property fields are gaps', () => {
  const l = makeLead();
  const g = gaps(l);
  assert.ok(g.length > 0);
  assert.ok(g.some((f) => f.key === 'contact_name'));
});

test('completion: low for a mostly-empty lead', () => {
  assert.ok(completion(makeLead()) < 50);
});

test('draftEmail: fleet campaign mentions the lot name', () => {
  const l = makeLead({ contact_name: 'Greg', verified: 1 });
  const draft = draftEmail(l, 'fleet');
  assert.match(draft.subject, /Test Lot/);
  assert.match(draft.body, /Hi Greg/);
});

console.log('done');