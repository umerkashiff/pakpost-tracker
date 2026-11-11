export interface TrackingEvent {
  date: string;
  time: string;
  location: string;
  status: string;
}

export type StatusCategory = 'DELIVERED' | 'IN_TRANSIT' | 'BOOKED' | 'ATTEMPT_FAILED' | 'PENDING' | 'ERROR';

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
  error?: string;
}

export interface ParcelConfig {
  id: string;
  label?: string;
  enabled?: boolean;
}
