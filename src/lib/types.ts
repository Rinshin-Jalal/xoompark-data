import { Timestamp } from 'firebase/firestore';
import type { TaskKey } from './tasks';

export type ServiceType = 'STAGE' | 'CHARGE' | 'PUDO' | 'WASH' | 'SERVICE';
export type MeteringType = 'TIME_METERED' | 'ENERGY_METERED';
export type ResourceType = 'PARKING_STALL' | 'EV_CONNECTOR' | 'CURB_BERTH' | 'WASH_BAY' | 'SERVICE_BAY';
export type ProviderStatus = 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';
export type OperatorStatus = 'ACTIVE' | 'SUSPENDED';
export type SiteStatus = 'ACTIVE' | 'SUSPENDED';
export type ResourceStatus = 'DRAFT' | 'ACTIVE' | 'OUT_OF_SERVICE' | 'RETIRED';
export type OfferingStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED' | 'RETIRED';
export type AssetStatus = 'ACTIVE' | 'INACTIVE' | 'RETIRED';
export type AssetType = 'ROBOTAXI' | 'AV_VAN' | 'DELIVERY_BOT' | 'HEAVY_TRUCK' | 'OTHER';
export type ReservationState = 'HELD' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'EXPIRED';
export type HoldState = 'ACTIVE' | 'CONVERTED' | 'RELEASED' | 'EXPIRED';
export type BookingState = 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type SessionState = 'OPEN' | 'CLOSED' | 'ABANDONED';
export type SettlementState = 'PENDING' | 'EXPORTED' | 'SETTLED' | 'DISPUTED';

export interface GeoPoint { lat: number; lng: number; }
export interface Dimensions { lengthM: number; widthM: number; heightM?: number; }
export interface Money { amount: number; currency: string; }

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  roles: ('provider' | 'operator')[];
  providerId: string | null;
  operatorId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Provider {
  id: string;
  uid: string;
  legalName: string;
  displayName: string;
  type: 'PARKING_OPERATOR' | 'PROPERTY_OWNER' | 'MUNICIPALITY' | 'INDIVIDUAL' | 'OTHER';
  contactEmail: string;
  contactPhone: string;
  status: ProviderStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Site {
  id: string;
  providerId: string;
  uid: string;
  name: string;
  address: string;
  placeId: string;
  location: GeoPoint;
  geohash: string;
  geofence: GeoPoint[];
  timezone: string;
  status: SiteStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Resource {
  id: string;
  siteId: string;
  providerId: string;
  uid: string;
  resourceType: ResourceType;
  name: string;
  location: GeoPoint;
  geohash: string;
  capacity: number;
  dimensions: Dimensions;
  attributes: Record<string, unknown>;
  status: ResourceStatus;
  ledgerVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface OfferingRate {
  currency: string;
  perMinute: number | null;
  perHour: number | null;
  perKwh: number | null;
  freeMinutes: number;
  minCharge: number;
  maxCharge: number | null;
}

export interface WeeklyWindow {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

export interface OfferingPolicy {
  maxDurationMinutes: number;
  arrivalGraceMinutes: number;
  cancelCutoffMinutes: number;
  eligibleOperatorIds: 'ALL' | string[];
  eligibleAssetTypes: 'ALL' | AssetType[];
  bookableWindow: { always: true } | { weeklyWindows: WeeklyWindow[] };
}

export interface Offering {
  id: string;
  resourceId: string;
  siteId: string;
  providerId: string;
  uid: string;
  serviceType: ServiceType;
  meteringType: MeteringType;
  title: string;
  description: string;
  status: OfferingStatus;
  bookable: boolean;
  geohash: string;
  rate: OfferingRate;
  policy: OfferingPolicy;
  customTasks?: TaskKey[];  // additional tasks appended to TASK_REGISTRY[serviceType] at hold time
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Operator {
  id: string;
  uid: string;
  displayName: string;
  type: 'AV_FLEET' | 'INDIVIDUAL_OWNER' | 'DELIVERY_FLEET' | 'ROBOTICS' | 'OTHER';
  contactEmail: string;
  website: string;
  status: OperatorStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Asset {
  id: string;
  operatorId: string;
  uid: string;
  displayName: string;
  assetType: AssetType;
  licensePlate: string;
  dimensions: Dimensions;
  status: AssetStatus;
  createdAt: Timestamp;
}

export interface OperatorApiKey {
  id: string;
  operatorId: string;
  uid: string;
  label: string;
  keyHash: string;
  keyPrefix?: string;
  status: 'ACTIVE' | 'REVOKED';
  role: 'booking_agent' | 'operator_admin';
  scopes: ServiceType[];
  sourceChannel: string;
  createdAt: Timestamp;
  lastUsedAt?: Timestamp | null;
  revokedAt?: Timestamp | null;
}

export interface Reservation {
  id: string;
  locator: string;
  operatorId: string;
  providerId: string;
  assetId: string;
  offeringId: string;
  resourceId: string;
  siteId: string;
  requestedStart: Timestamp;
  requestedEnd: Timestamp;
  state: ReservationState;
  holdId: string | null;
  bookingId: string | null;
  sessionId: string | null;
  checkInToken: string | null;
  formOfPaymentRef: string | null;
  rateSnapshot: OfferingRate;
  policySnapshot: Pick<OfferingPolicy, 'maxDurationMinutes' | 'arrivalGraceMinutes' | 'cancelCutoffMinutes'>;
  quotedCost: Money;
  serviceType: ServiceType;
  meteringType: MeteringType;
  sourceChannel: string;
  apiKeyId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  tasksSnapshot: TaskKey[];
  tasksSnapshotVersion: number;
  openIssueCount: number;
}

export type ReservationEventType =
  | 'HELD' | 'CONFIRMED' | 'ACTIVE' | 'COMPLETED'
  | 'CANCELLED' | 'NO_SHOW' | 'HOLD_EXPIRED' | 'ABANDONED';

export interface ReservationEvent {
  id: string;
  type: ReservationEventType;
  at: Timestamp;
  actorUid: string;
  data: Record<string, unknown>;
}

export interface ResourceHold {
  id: string;
  reservationId: string;
  operatorId: string;
  assetId: string;
  start: Timestamp;
  end: Timestamp;
  state: HoldState;
  expiresAt: Timestamp;
  idempotencyKey: string;
  createdAt: Timestamp;
}

export interface ResourceBooking {
  id: string;
  reservationId: string;
  operatorId: string;
  providerId: string;
  assetId: string;
  start: Timestamp;
  end: Timestamp;
  state: BookingState;
  createdAt: Timestamp;
}

export interface Session {
  id: string;
  reservationId: string;
  resourceId: string;
  operatorId: string;
  providerId: string;
  assetId: string;
  checkInAt: Timestamp;
  checkOutAt: Timestamp | null;
  state: SessionState;
}

export interface UsageRecord {
  id: string;
  sessionId: string;
  reservationId: string;
  providerId: string;
  operatorId: string;
  serviceType: ServiceType;
  meteringType: MeteringType;
  quantityMinutes: number | null;
  quantityKwh: number | null;
  rateSnapshot: OfferingRate;
  computedCost: Money;
  quotedCost: Money;
  exceedsQuote: boolean;
  occupancyStart: Timestamp;
  occupancyEnd: Timestamp;
  sourceChannel: string;
  settlementState: SettlementState;
  finalizedAt: Timestamp;
}

export interface IdempotencyRecord {
  principalId: string;
  key: string;
  requestHash: string;
  result: unknown;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export type MetroCode = 'sf' | 'sd' | 'miami' | 'austin' | 'dallas' | 'phoenix' | 'vegas';
export type SiteFindingStatus = 'new' | 'walk-list' | 'walked' | 'contacted' | 'rejected' | 'signed';

export interface SiteFinding {
  id: string;
  metro: MetroCode;
  osmId: string;
  lat: number;
  lon: number;
  name: string;
  type: string;
  capacity: number | null;
  capacitySource: string;
  areaSqm: number | null;

  // Scored data (refreshed on re-run)
  storageScore: number;
  stagingScore: number;
  nearestAnchor: string;
  anchorMi: number;
  depotMi?: number;
  residentialFlag: string;
  resDistanceM: number | null;
  ownerDirectCandidate: boolean;
  access?: string;
  fee?: string;
  walkList?: boolean;
  closedAtNight: boolean;

  // Manual fields (preserved across re-runs)
  status: SiteFindingStatus;
  capacityActual?: number;
  clearanceHeight?: string;
  powerAvailable?: boolean;
  notesInternal?: string;
  photos?: string[];

  // Enrichment (owner/address/land use) — editable; a manual edit wins over
  // the next refresh's freshly-scraped/enriched value.
  address?: string;
  owner?: string;
  ownerMailing?: string;
  landUse?: string;
  parcelId?: string;
  zoning?: string;
  openingHours?: string;

  // Timestamps
  lastScoredAt: Timestamp;
  updatedAt: Timestamp;
  createdAt: Timestamp;
}

export interface ProximityBand {
  maxMi: number;
  score: number;
}

export interface Anchor {
  name: string;
  lat: number;
  lon: number;
  kind: string;
}

export interface Depot {
  name: string;
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface ScoringWeights {
  proximity: number;
  geometry: number;
  capacity: number;
  commercial: number;
  depot?: number;
}

export interface GeometryScores {
  surface: number;
  multiStorey: number;
  underground: number;
  untagged: number;
}

export interface CommercialScores {
  ownerDirect: number;
  paid: number;
  unknown: number;
}

export interface CapacityThresholds {
  storage: { min: number; max: number };
  staging: { min: number; max: number };
}

export interface FinderConfig {
  metro: MetroCode;
  name: string;

  bbox: BBox;
  anchors: Anchor[];
  referenceDepot?: Depot;

  storageWeights: ScoringWeights;
  stagingWeights: ScoringWeights;

  proximityBands: ProximityBand[];
  geometryScores: GeometryScores;
  commercialScores: CommercialScores;
  capacityThresholds: CapacityThresholds;

  walkListThreshold: number;
  residentialPenalty: number;
  residentialBuffer: number;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ===== Charging sites (AFDC) =====

export type ChargingStationStatus = 'available' | 'planned' | 'temporarily_unavailable' | 'unknown';
export type ChargingAccessCode = 'public' | 'private' | 'unknown';

/** Normalized AFDC record. Not persisted as-is — see SavedChargingLocation. */
export interface ChargingSite {
  afdcId: number;
  name: string;
  network: string | null;

  streetAddress: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number;
  lng: number;

  dcFastPorts: number;
  level2Ports: number;
  connectors: string[];

  /** kW, descending. Absent means unreported — never 0; 0 would read as a dead station. */
  powerKw: number[];
  maxPowerKw: number | null;

  access: ChargingAccessCode;
  accessHours: string | null;
  is247: boolean;

  status: ChargingStationStatus;
  pricing: string | null;
  facilityType: string | null;
  ownerType: string | null;
  updatedAt: string | null;

  distanceMiles: number | null;
}

/**
 * Clearance status describes how the number was obtained, not just whether
 * it exists. 'unknown' status must be treated the same as no Clearance at
 * all by any filter — see clearanceFit() in lib/clearance.ts.
 */
export type ClearanceStatus = 'measured' | 'signposted' | 'unknown';

export interface Clearance {
  /** Integer inches. One unit, no free text — see lib/clearance.ts header. */
  inches: number;
  status: ClearanceStatus;
  measuredBy?: string;
  /** ISO date string — a survey date, not a write timestamp. */
  measuredAt?: string;
}

export type ClearanceFit = 'fits' | 'too-low' | 'unverified';

/**
 * How the DC connectors are physically mounted. AFDC carries no mounting data,
 * so this is field-verified like clearance — null means never recorded.
 * 'overhead' = suspended/retractable dispensers above the space (matters for
 * tall vehicles and automated connection); 'ground' = floor/wall dispensers.
 */
export type PortMounting = 'overhead' | 'ground';

/**
 * Our data layer on top of an AFDC station. Keyed to the AFDC station id
 * (names change; ids don't) — see afdc-eng-team-message.md.
 *
 * AFDC fields are a cached snapshot for display, refreshed opportunistically;
 * clearance and notes are ours and a refresh must never overwrite them.
 * Team-shared, not per-user — matches SiteFinding's admin-collection pattern
 * elsewhere in this module (open decision per Greg's message; revisit if the
 * team wants per-BDR lists).
 */
export interface SavedChargingLocation {
  id: string;
  afdcId: number;

  // Cached AFDC snapshot (refreshed on save/refresh, never authoritative for our fields below)
  name: string;
  lat: number;
  lng: number;
  network: string | null;
  streetAddress: string | null;
  city: string | null;
  state: string | null;
  dcFastPorts: number;
  maxPowerKw: number | null;

  // Ours
  clearance: Clearance | null;
  notes: string | null;
  /** Property owner, from the assessor -> LinkedIn outreach lookup — see lib/outreach.ts. */
  ownerName: string | null;
  /** Field-verified connector mounting — see PortMounting above. */
  portMounting: PortMounting | null;
  savedBy: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── Task Verification ──────────────────────────────────────────────────────────

export interface TaskProof {
  storagePath:   string;
  capturedAt:    Timestamp | null;
  uploadedAt:    Timestamp;
  uploadedByUid: string;
}

export interface TaskLog {
  id:          string;
  taskKey:     TaskKey;
  outcome:     'DONE' | 'NOT_APPLICABLE';
  reason:      string | null;
  note:        string | null;
  actorUid:    string;
  actorKind:   'PROVIDER';
  providerId:  string;
  siteId:      string;
  proof:       TaskProof | null;
  capturedAt:  Timestamp | null;
  recordedAt:  Timestamp;
  geo:         { lat: number; lng: number } | null;
}

export type IssueCode =
  | 'ASSET_NO_SHOW'
  | 'ACCESS_DENIED'
  | 'WRONG_SPOT'
  | 'EQUIPMENT_FAULT'
  | 'DAMAGE'
  | 'OTHER';

export const ISSUE_CODE_LABELS: Record<IssueCode, string> = {
  ASSET_NO_SHOW:   'Asset No-Show',
  ACCESS_DENIED:   'Access Denied',
  WRONG_SPOT:      'Wrong Spot',
  EQUIPMENT_FAULT: 'Equipment Fault',
  DAMAGE:          'Damage',
  OTHER:           'Other',
};

export interface ReservationIssue {
  id:         string;
  taskKey:    TaskKey | null;
  code:       IssueCode;
  reason:     string;
  actorUid:   string;
  actorKind:  'PROVIDER';
  providerId: string;
  siteId:     string;
  proof:      TaskProof | null;
  capturedAt: Timestamp | null;
  recordedAt: Timestamp;
  resolution: null | {
    state: 'RESOLVED' | 'WAIVED' | 'WITHDRAWN';
    byUid: string;
    at:    Timestamp;
    note:  string | null;
  };
}
