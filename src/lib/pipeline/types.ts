// Single source of truth for BD pipeline stages. bdProspects is camelCase
// (written by createProspectFromLot); parking_lots/lotProspectLinks are
// snake_case and only used for detail-view drill-down.
export const PIPELINE_STAGES = ['QUALIFYING', 'PROPOSAL', 'NEGOTIATING', 'ONBOARDING', 'LIVE', 'LOST'] as const;

export type ProspectStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<ProspectStage, string> = {
  QUALIFYING: 'Qualifying',
  PROPOSAL: 'Proposal',
  NEGOTIATING: 'Negotiating',
  ONBOARDING: 'Onboarding',
  LIVE: 'Live',
  LOST: 'Lost',
};

export interface BDProspect {
  id: string;
  side: 'provider';
  stage: ProspectStage;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  city: string;
  description: string;
  source: string;
  assignedTo: string;
  lastContactedAt: string | null;
  nextFollowUp: string | null;
  tags: string[];
  company_account_id: string;
  associated_lot_ids: string[];
  total_stalls_in_deal: number | null;
  deal_type: 'portfolio_master_agreement' | 'single_site';
  providerDetails: {
    providerType: string;
    infraType: string;
    estimatedSpaces: number | null;
    estimatedLocations: number | null;
    servicesInterested: string[];
    currentlyMonetized: boolean | null;
  };
  operatorDetails: null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  /** Set on every stage move — sales-cycle / stalled-deal reporting. */
  stageUpdatedAt?: string;
  /** Why the deal was lost (only when stage === 'LOST'). */
  lostReason?: string;
}
