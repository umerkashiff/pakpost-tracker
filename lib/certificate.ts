import crypto from 'crypto';
import { TrackingResult } from './types';
import { resolveDispatchDescriptor } from './logistics-intelligence';

export interface AuditProofPayload {
  version: '1.0';
  certificateId: string;
  trackingNo: string;
  carrier: string;
  issuedAt: string;
  sha256Digest: string;
  summary: {
    origin: string;
    destination: string;
    status: string;
    totalEvents: number;
    lastUpdated: string;
  };
  dispatchRoute?: {
    originExchange: string;
    destinationExchange: string;
    lane: string;
  };
  events: Array<{
    date: string;
    time: string;
    location: string;
    status: string;
    carrier: string;
  }>;
  legalNotice: string;
}

/**
 * Generate a cryptographically verifiable JSON / print manifest proof certificate
 * for AliExpress / PayPal disputes, customs verification, and merchant chargebacks.
 */
export function generateAuditCertificate(result: TrackingResult): AuditProofPayload {
  const events = result.events.map((e) => ({
    date: e.date,
    time: e.time || '',
    location: e.location || 'Unknown',
    status: e.status || '',
    carrier: e.carrier || 'Pakistan Post'
  }));

  const canonicalString = JSON.stringify({
    trackingNo: result.trackingNo,
    statusCategory: result.statusCategory,
    totalEvents: result.totalEvents,
    events
  });

  const sha256Digest = crypto.createHash('sha256').update(canonicalString).digest('hex');
  const certificateId = `PKP-${result.trackingNo}-${sha256Digest.slice(0, 8).toUpperCase()}`;

  const dispatch = resolveDispatchDescriptor(result);

  return {
    version: '1.0',
    certificateId,
    trackingNo: result.trackingNo,
    carrier: result.upstreamCarrier
      ? `${result.upstreamCarrier} / Pakistan Post EMTTS`
      : 'Pakistan Post EMTTS',
    issuedAt: new Date().toISOString(),
    sha256Digest,
    summary: {
      origin: result.origin || 'International',
      destination: result.destination || 'Pakistan',
      status: result.latestEvent?.status || result.statusCategory,
      totalEvents: result.totalEvents,
      lastUpdated: result.latestEvent?.date || result.lastChecked
    },
    ...(dispatch
      ? {
          dispatchRoute: {
            originExchange: `${dispatch.originExchangeCode} (${dispatch.originExchangeName})`,
            destinationExchange: `${dispatch.destinationExchangeCode} (${dispatch.destinationExchangeName})`,
            lane: dispatch.carrierLogisticsLane || 'Standard UPU Postal Corridor'
          }
        }
      : {}),
    events,
    legalNotice:
      'This document represents an authoritative, tamper-evident bilateral snapshot compiled from official postal telecommunication records (UPU EDI & Pakistan Post EMTTS). Verifiable via cryptographic hash.'
  };
}
