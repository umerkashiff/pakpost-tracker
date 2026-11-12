export interface TrackingEvent {
  date: string;
  time: string;
  location: string;
  status: string;
  carrier?: string;
  timestamp?: number;
}

export type StatusCategory = 'DELIVERED' | 'IN_TRANSIT' | 'BOOKED' | 'ATTEMPT_FAILED' | 'PENDING' | 'ERROR';

export type HandoffStatus = 'UPSTREAM_TRANSIT' | 'HANDED_OFF_DOMESTIC' | 'DOMESTIC_ONLY';

export type UpstreamProviderRoute =
  | 'domestic-emtts'
  | 'cainiao-direct'
  | 'spring-gds'
  | 'postnl-consumer'
  | 'direct-upu'
  | 'parcelsapp';

export interface ParcelRouteProfile {
  carrierId: string;
  carrierName: string;
  upstreamRoute: UpstreamProviderRoute;
  originCountry?: string;
  countryCode?: string;
  pinnedAt: string;
}

export interface ParcelSourceSnapshot {
  emttsEvents: TrackingEvent[];
  emttsOrigin?: string;
  emttsDestination?: string;
  emttsUpdatedAt?: string;
  upstreamEvents: TrackingEvent[];
  upstreamCarrierId?: string;
  upstreamCarrierName?: string;
  upstreamOriginCountry?: string;
  upstreamRoute?: UpstreamProviderRoute;
  upstreamUpdatedAt?: string;
}

export interface ParcelAlertState {
  highestTimestamp: number;
  lastStatusCategory: StatusCategory;
  seenCheckpoints: string[];
  signature: string;
  updatedAt: string;
}

export interface TrackingResult {
  trackingNo: string;
  label?: string;
  origin: string;
  destination: string;
  found: boolean;
  statusCategory: StatusCategory;
  latestEvent: TrackingEvent | null;
  totalEvents: number;
  events: TrackingEvent[];
  lastChecked: string;
  upstreamCarrier?: string;
  handoffStatus?: HandoffStatus;
  isUpdated?: boolean;
  routeProfile?: ParcelRouteProfile;
  dispatchDescriptor?: {
    originExchangeCode: string;
    originExchangeName: string;
    destinationExchangeCode: string;
    destinationExchangeName: string;
    mailClass: string;
    carrierLogisticsLane?: string;
  };
  beatPrediction?: {
    isDomesticBeatActive: boolean;
    beatWindow?: string;
    deliveryOffice?: string;
    dutyPayableAtDoor: boolean;
    actionNote?: string;
  };
  sourceHealth?: {
    emttsOk: boolean;
    upstreamOk: boolean;
    usedCachedEmtts?: boolean;
    usedCachedUpstream?: boolean;
  };
  error?: string;
}

export interface ParcelConfig {
  id: string;
  label?: string;
  enabled?: boolean;
}


