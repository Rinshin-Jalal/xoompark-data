// BD Pipeline types — isolated from platform types, never imported by platform code

export type ProspectSide = 'provider' | 'operator';

export const PROSPECT_STAGES = [
  'IDENTIFIED',
  'CONTACTED',
  'QUALIFYING',
  'PROPOSAL',
  'NEGOTIATING',
  'ONBOARDING',
  'LIVE',
  'LOST',
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const PROSPECT_SOURCES = [
  'INBOUND',
  'OUTBOUND',
  'REFERRAL',
  'CONFERENCE',
  'COLD_OUTREACH',
  'OTHER',
] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

// Mirrors platform ServiceType values but kept isolated
export const BD_SERVICE_TYPES = ['STAGE', 'CHARGE', 'PUDO', 'WASH', 'SERVICE'] as const;
export type BDServiceType = (typeof BD_SERVICE_TYPES)[number];

export const PROVIDER_TYPES = [
  'PARKING_OPERATOR',
  'PROPERTY_OWNER',
  'MUNICIPALITY',
  'INDIVIDUAL',
  'OTHER',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const INFRA_TYPES = [
  'PARKING_GARAGE',
  'SURFACE_LOT',
  'HOTEL_PROPERTY',
  'COMMERCIAL_BUILDING',
  'CURBSIDE',
  'WAREHOUSE',
  'OTHER',
] as const;
export type InfraType = (typeof INFRA_TYPES)[number];

export const FLEET_TYPES = ['ROBOTAXI', 'AV_VAN', 'DELIVERY_BOT', 'HEAVY_TRUCK', 'OTHER'] as const;
export type FleetType = (typeof FLEET_TYPES)[number];

export interface ProviderDetails {
  providerType: ProviderType | '';
  infraType: InfraType | '';
  estimatedSpaces: number | null;
  estimatedLocations: number | null;
  servicesInterested: BDServiceType[];
  currentlyMonetized: boolean | null;
}

export interface OperatorDetails {
  fleetType: FleetType | '';
  fleetSize: number | null;
  servicesNeeded: BDServiceType[];
  operatingMarkets: string;
  currentSolution: string;
  apiReady: boolean | null;
  estimatedMonthlyVolume: number | null;
  targetGoLive: string;
}

/** All timestamps serialised to ISO strings for React prop passing */
export interface Prospect {
  id: string;
  side: ProspectSide;
  stage: ProspectStage;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  city: string;
  description: string;
  source: ProspectSource | '';
  assignedTo: string;
  lastContactedAt: string | null;
  nextFollowUp: string | null;
  tags: string[];
  providerDetails: ProviderDetails | null;
  operatorDetails: OperatorDetails | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ProspectNote {
  id: string;
  body: string;
  authorEmail: string;
  authorName: string;
  createdAt: string;
}

// ── Display maps ──────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<ProspectStage, string> = {
  IDENTIFIED: 'Identified',
  CONTACTED: 'Contacted',
  QUALIFYING: 'Qualifying',
  PROPOSAL: 'Proposal Sent',
  NEGOTIATING: 'Negotiating',
  ONBOARDING: 'Onboarding',
  LIVE: 'Live',
  LOST: 'Lost',
};

export const SOURCE_LABELS: Record<ProspectSource, string> = {
  INBOUND: 'Inbound',
  OUTBOUND: 'Outbound',
  REFERRAL: 'Referral',
  CONFERENCE: 'Conference',
  COLD_OUTREACH: 'Cold Outreach',
  OTHER: 'Other',
};

export const INFRA_LABELS: Record<InfraType, string> = {
  PARKING_GARAGE: 'Parking Garage',
  SURFACE_LOT: 'Surface Lot',
  HOTEL_PROPERTY: 'Hotel Property',
  COMMERCIAL_BUILDING: 'Commercial Building',
  CURBSIDE: 'Curbside',
  WAREHOUSE: 'Warehouse',
  OTHER: 'Other',
};

export const FLEET_LABELS: Record<FleetType, string> = {
  ROBOTAXI: 'Robotaxi',
  AV_VAN: 'AV Van',
  DELIVERY_BOT: 'Delivery Bot',
  HEAVY_TRUCK: 'Heavy Truck',
  OTHER: 'Other',
};

export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  PARKING_OPERATOR: 'Parking Operator',
  PROPERTY_OWNER: 'Property Owner',
  MUNICIPALITY: 'Municipality',
  INDIVIDUAL: 'Individual',
  OTHER: 'Other',
};

export const SERVICE_LABELS: Record<BDServiceType, string> = {
  STAGE: 'Stage',
  CHARGE: 'Charge',
  PUDO: 'PUDO',
  WASH: 'Wash',
  SERVICE: 'Service',
};

export const STAGE_COLORS: Record<ProspectStage, string> = {
  IDENTIFIED: 'bg-slate-100 text-slate-600 border-slate-200',
  CONTACTED: 'bg-sky-50 text-sky-700 border-sky-200',
  QUALIFYING: 'bg-blue-50 text-blue-700 border-blue-200',
  PROPOSAL: 'bg-violet-50 text-violet-700 border-violet-200',
  NEGOTIATING: 'bg-amber-50 text-amber-700 border-amber-200',
  ONBOARDING: 'bg-orange-50 text-orange-700 border-orange-200',
  LIVE: 'bg-green-50 text-green-700 border-green-200',
  LOST: 'bg-red-50 text-red-600 border-red-200',
};
