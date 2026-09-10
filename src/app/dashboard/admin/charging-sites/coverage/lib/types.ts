// Shape of docs/robotaxi-charging-coverage/data.json, produced by
// scripts/robotaxi-charging-analysis.ts. Duplicated here (not imported from the
// script) because that script executes live network calls at module load —
// importing it would run the whole analysis again.

export interface Station {
  id: number;
  name: string;
  network: string | null;
  lat: number;
  lng: number;
  dcFastPorts: number;
  maxPowerKw: number | null;
}

export interface VersionRow {
  date: string;
  sqmi: number;
  insideCount: number;
  insidePorts: number;
  per100: number;
}

export interface PowerTiers {
  fast150Plus: number;
  under150: number;
  unknownPower: number;
}

export interface AreaResult {
  operator: string;
  metro: string;
  slug: string;
  boundaryDate: string;
  sqmi: number;
  dcFastInRadius: number;
  insideCount: number;
  insidePorts: number;
  per100: number;
  powerTiers: PowerTiers;
  networkBreakdown: Record<string, number>;
  gap: { thresholdMiles: number; gapPoints: number; totalPoints: number; gapAreaSqMiEst: number };
  stations: Station[];
  dailyVehicleCapacity: number;
  growth: VersionRow[];
}

export interface OperatorRollup {
  operator: string;
  metros: string[];
  totalSqMi: number;
  uniqueDcFastStations: number;
  uniqueDcFastPorts: number;
  per100: number;
  dailyVehicleCapacity: number;
}

export interface OverlapStation {
  id: number;
  name: string;
  network: string | null;
  lat: number;
  lng: number;
  dcFastPorts: number;
  maxPowerKw: number | null;
  sharedBy: string[];
}

export interface OverlapGroup {
  sharedBy: string[];
  stationCount: number;
  portCount: number;
  dailyVehicleCapacity: number;
}

export interface CoverageData {
  meta: {
    generatedAt: string;
    avMapDataRepo: string;
    avMapDataNote: string;
    afdcNote: string;
    gapThresholdMiles: number;
    fastTierKw: number;
    capacityAssumptions: {
      sessionMinutes: number;
      operatingHoursPerDay: number;
      sessionsPerPortPerDay: number;
      note: string;
    };
    excluded: { file: string; reason: string }[];
  };
  headline: {
    activeAreas: number;
    uniqueDcFastStations: number;
    uniqueDcFastPorts: number;
    dailyVehicleCapacity: number;
    powerTiers: PowerTiers;
    networkBreakdown: Record<string, number>;
    stationsSharedAcrossOperators: number;
  };
  perArea: AreaResult[];
  perOperator: OperatorRollup[];
  overlap: OverlapStation[];
  overlapByGroup: OverlapGroup[];
}
