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
  error?: string;
}

export interface ParcelConfig {
  id: string;
  label?: string;
  enabled?: boolean;
}


