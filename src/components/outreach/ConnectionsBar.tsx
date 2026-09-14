'use client';

import { Building2, User, Briefcase, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { Lead } from '@/lib/outreach/workflow';

// 32px horizontal metadata ribbon — shows the operator context so a BDR never
// cold-outreaches into an active negotiation. Lockout state (amber) comes from
// the future company_accounts layer; for now it renders the clean state.
export function ConnectionsBar({ lead, lotCount }: { lead: Lead; lotCount?: number }) {
  const company = lead.property_details?.operator ?? lead.raw.operator ?? '';
  const contact = lead.contact_name;
  const role = lead.contact_role;
  const lockout = lead.raw.lockout;

  if (lockout) {
    return (
      <div className="connections-bar locked">
        <span className="conn-item">
          <ShieldAlert size={13} />
          COLD OUTREACH RESTRICTED · Active deal in stage [{lockout}]
        </span>
      </div>
    );
  }

  return (
    <div className="connections-bar">
      <span className="conn-item">
        <Building2 size={13} />
        {company || 'Unknown operator'}{lotCount != null && lotCount > 1 ? ` (${lotCount} lots)` : ''}
      </span>
      <span className="conn-sep" />
      <span className="conn-item">
        <User size={13} />
        {contact ? `${contact}${role ? ` (${role})` : ''}` : 'No contact yet'}
      </span>
      <span className="conn-sep" />
      <span className="conn-item">
        <Briefcase size={13} />
        Deal: None
      </span>
      <span className="conn-clear">
        <ShieldCheck size={13} />
        Outreach Clear
      </span>
    </div>
  );
}

// Lockout variant — rendered when a portfolio deal is in flight.
export function ConnectionsBarLocked({ lead, owner }: { lead: Lead; owner: string }) {
  return (
    <div className="connections-bar locked">
      <span className="conn-item">
        <ShieldAlert size={13} />
        COLD OUTREACH RESTRICTED · Active Deal (Owner: {owner})
      </span>
    </div>
  );
}