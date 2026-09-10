// Pure workflow logic for the Outreach Desk — ported from the reference
// source (XoomPark-Outreach-Desk-Source.zip). Deliberately dependency-free so
// it's testable with plain node, same discipline as lib/sourcing/bdrView.ts.
// The Lead shape is produced by adapter.ts (Firebase → Lead); this module only
// derives stages, next actions, daily plans, gaps and email drafts from it.

export type Raw = Record<string, string>;
export type Research = {
  at: string;
  pages: {
    url: string;
    ok: boolean;
    error?: string;
    emails: string[];
    phones: string[];
  }[];
};
export type EmailDraft = {
  campaign: 'fleet' | 'consulting';
  subject: string;
  body: string;
};
export type EmailEvent = {
  id: string;
  lead_id: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  note: string;
  actor: string;
  created: string;
};
export type Lead = {
  id: string;
  raw: Raw;
  stage: string;
  assignee: string;
  contact_name: string;
  contact_role: string;
  email: string;
  phone: string;
  verified: number;
  evidence: string;
  notes: string;
  due: string;
  updated: string;
  revision: number;
  research: Research | null;
  email_draft?: EmailDraft;
  last_email_at?: string;
  last_email_outcome?: string;
  do_not_contact?: boolean;
  priority_rating?: number;
  visibility?: 'active' | 'hidden' | 'archived';
  visibility_reason?: string;
  visibility_changed_at?: string;
  property_details?: Record<string, string>;
  property_evidence?: string;
  property_sources?: Record<string, string>;
};
export type Task = {
  id: string;
  lead_id: string;
  owner: string;
  title: string;
  instruction: string;
  day: string;
  done: number;
  group_count: number;
};
export type Activity = {
  id: string;
  lead_id: string;
  actor: string;
  message: string;
  created: string;
};
export type Notice = {
  id: string;
  owner: string;
  message: string;
  day: string;
  seen: number;
};
export type Settings = {
  researcher: string;
  bdr1: string;
  bdr2: string;
  sdr: string;
  dailyLimit: number;
};
export type Data = {
  leads: Lead[];
  tasks: Task[];
  activity: Activity[];
  notifications: Notice[];
  email_events: EmailEvent[];
  settings: Settings;
  day: string;
};
export const defaults: Settings = {
  researcher: 'Rinshin',
  bdr1: 'BDR 1',
  bdr2: 'BDR 2',
  sdr: 'SDR team',
  dailyLimit: 12,
};
export const stages: Record<string, string> = {
  research: 'Research needed',
  verify: 'Verify contact',
  ready: 'BDR email',
  email_followup: 'Email follow-up',
  email_reply: 'Reply received',
  sdr: 'SDR call',
  followup: 'SDR follow-up',
  qualified: 'Qualified',
  hold: 'On hold',
};
export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export const priorities = ['1 · Highest', '2 · High', '3 · Medium', '4 · Low'];
export const propertyFields = [
  ['owner', 'Property owner'],
  ['operator', 'Current operator'],
  ['total_spaces', 'Facility capacity'],
  ['hours', 'Operating hours'],
  ['clearance', 'Vehicle clearance'],
  ['gate', 'Gate / entry access'],
  ['ev', 'EV charging'],
  ['pudo', 'Pickup / drop-off areas'],
  ['staging', 'Waiting / staging areas'],
  ['accessible_routes', 'Accessible parking / routes'],
] as const;
export function isActive(l: Lead) {
  return !l.visibility || l.visibility === 'active';
}
export function priority(l: Lead) {
  return (
    l.priority_rating || Math.min(4, Math.max(1, parseInt(l.raw.priority) || 3))
  );
}
export function propertyValue(l: Lead, key: string) {
  return l.property_details?.[key] ?? l.raw[key] ?? '';
}
export function informationStatus(
  value: unknown,
): 'missing' | 'unconfirmed' | 'recorded' {
  const v = String(value ?? '').trim();
  if (!v || /^(unknown|tbd|tbc|[-—?])$/i.test(v)) return 'missing';
  if (
    /not (verified|confirmed|published|captured|provided|available|listed)|unverified|unconfirmed|to (confirm|verify)|ask (attendant|operator)|needs? (confirmation|verification)|no .*(captured|published)/i.test(
      v,
    )
  )
    return 'unconfirmed';
  return 'recorded';
}
export function information(l: Lead) {
  return [
    ...(
      [
        ['contact_name', 'Contact name'],
        ['contact_role', 'Contact role'],
        ['email', 'Business email'],
        ['phone', 'Phone'],
        ['evidence', 'Contact source'],
      ] as const
    ).map(([key, label]) => ({
      key,
      label,
      group: 'Contact',
      status: informationStatus(l[key]),
    })),
    {
      key: 'verified',
      label: 'Decision-maker authority',
      group: 'Contact',
      status: l.verified ? ('recorded' as const) : ('unconfirmed' as const),
    },
    ...propertyFields.map(([key, label]) => ({
      key,
      label,
      group: 'Property',
      status: informationStatus(propertyValue(l, key)),
    })),
  ];
}
export function gaps(l: Lead) {
  return information(l).filter((f) => f.status !== 'recorded');
}
export function completion(l: Lead) {
  const fields = information(l);
  return Math.round(
    (fields.filter((f) => f.status === 'recorded').length / fields.length) *
      100,
  );
}
export function nextAction(l: Lead) {
  if (!isActive(l))
    return `This property is ${l.visibility}. Restore it to resume its previous workflow.`;
  if (l.do_not_contact)
    return 'Do not contact. The recipient asked to stop outreach.';
  if (l.stage === 'ready')
    return l.email
      ? `Email ${l.email}: ${l.verified ? 'introduce the offering and ask for a short conversation.' : 'confirm who manages this property before discussing the offering.'}`
      : 'Find a business email, or pass the published phone route to SDR.';
  if (l.stage === 'email_followup')
    return `Send the next email to ${l.email}; review the last message and any replies first.`;
  if (l.stage === 'email_reply')
    return 'Read the email reply, respond as the BDR, and hand off to SDR if a call is needed.';
  if (l.stage === 'hold')
    return 'Resolve policy or access restrictions before outreach.';
  if (l.stage === 'sdr')
    return `Call ${l.phone}. Confirm the decision-maker, overnight capacity, pricing and access.`;
  if (l.stage === 'followup')
    return 'Follow up on the last conversation and capture the outstanding terms.';
  if (l.stage === 'qualified')
    return 'Review confirmed commercial terms and prepare a proposal.';
  if (l.raw.status === 'Operator conflict' && !l.verified)
    return 'Resolve the current operator using the official property source and permit record.';
  if (!l.contact_name)
    return 'Find the person responsible for commercial parking; capture their name, role and direct contact.';
  if (!l.verified)
    return `Verify that ${l.contact_name} manages this location and can approve a fleet agreement.`;
  return 'Review the property research, prepare the BDR email and hand off to SDR when a call is needed.';
}
export function plan(leads: Lead[], day: string, limit: number): Task[] {
  const active = leads
    .filter(
      (l) =>
        isActive(l) &&
        !l.do_not_contact &&
        !['hold', 'qualified'].includes(l.stage) &&
        (!l.due || l.due <= day),
    )
    .sort(
      (a, b) =>
        Number(!!b.due) - Number(!!a.due) ||
        priority(a) - priority(b) ||
        a.id.localeCompare(b.id),
    );
  const groups = new Map<string, Lead[]>();
  for (const l of active) {
    const operatorGroup =
      l.property_details?.operator &&
      l.property_details.operator !== l.raw.operator
        ? l.property_details.operator
        : l.raw.contact_group || l.raw.operator;
    const k = `${l.assignee}|${operatorGroup}|${l.stage}`;
    groups.set(k, [...(groups.get(k) || []), l]);
  }
  const counts: Record<string, number> = {};
  const result: Task[] = [];
  for (const [key, group] of groups) {
    const l = group[0];
    if ((counts[l.assignee] || 0) >= limit) continue;
    counts[l.assignee] = (counts[l.assignee] || 0) + 1;
    result.push({
      id: `${day}:${key}`,
      lead_id: l.id,
      owner: l.assignee,
      title: nextAction(l),
      instruction: l.raw.next_action,
      day,
      done: 0,
      group_count: group.length,
    });
  }
  return result;
}
export function safeLink(v: string) {
  try {
    const u = new URL(v);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function assigned_to(l: Lead, s: Settings) {
  return [...propertyValue(l, 'operator')].reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  ) % 2
    ? s.bdr1
    : s.bdr2;
}
export function draftEmail(
  l: Lead,
  campaign: 'fleet' | 'consulting',
): EmailDraft {
  const greeting =
    l.verified && l.contact_name ? `Hi ${l.contact_name},` : 'Hello,';
  const routing = l.verified
    ? ''
    : `Are you the right person to speak with about ${l.raw.name} at ${l.raw.address}? If not, could you point me to the property or parking manager?\n\n`;
  return {
    campaign,
    subject:
      campaign === 'consulting'
        ? `AV-ready property planning for ${l.raw.name}`
        : `Overnight fleet parking at ${l.raw.name}`,
    body:
      campaign === 'consulting'
        ? `${greeting}\n\n${routing}I’m reaching out from XoomPark about a proposed consulting service to help properties plan for AVs, rideshare and delivery. The scope can include digitizing pickup/drop-off zones, waiting and staging areas, accessible parking and routes, and vehicle access rules.\n\nWould a short conversation about ${l.raw.name}’s current setup and priorities be useful? We would scope and price any project individually.\n\nBest,\n${l.assignee}`
        : `${greeting}\n\n${routing}I’m reaching out from XoomPark to explore an overnight fleet parking arrangement at ${l.raw.name}. Our working brief is ${l.raw.requested_spaces || '20'} spaces, with the access window and operating requirements to confirm.\n\nCould we discuss permitted fleet use, available capacity, overnight access and a written commercial quote? Published retail rates are only a reference.\n\nBest,\n${l.assignee}`,
  };
}