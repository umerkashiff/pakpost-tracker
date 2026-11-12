import { TrackingEvent, TrackingResult } from './types';

export interface DispatchDescriptor {
  originExchangeCode: string;
  originExchangeName: string;
  destinationExchangeCode: string;
  destinationExchangeName: string;
  mailClass: string;
  transitHubAirport?: string;
  transitHubCity?: string;
  carrierLogisticsLane?: string;
  confidence: 'verified_edi' | 'standard_bilateral' | 'domestic';
}

export interface PostmanBeatPrediction {
  isDomesticBeatActive: boolean;
  beatWindow?: string;
  deliveryOffice?: string;
  dutyPayableAtDoor: boolean;
  actionNote?: string;
}

// UPU International Office of Exchange Directory
const UPU_OFFICE_CATALOG: Record<string, { code: string; name: string; hubAirport?: string; hubCity?: string }> = {
  NLAMSA: { code: 'NLAMSA', name: 'Amsterdam Schiphol IMEC', hubAirport: 'AMS', hubCity: 'Amsterdam' },
  NLAMSB: { code: 'NLAMSB', name: 'Amsterdam PostNL Sorting', hubAirport: 'AMS', hubCity: 'Amsterdam' },
  NLDHGA: { code: 'NLDHGA', name: 'Den Haag PostNL IMEC', hubAirport: 'AMS', hubCity: 'The Hague' },
  CNBJSA: { code: 'CNBJSA', name: 'Beijing Capital Int Mail Exchange', hubAirport: 'PEK', hubCity: 'Beijing' },
  CNSGHA: { code: 'CNSGHA', name: 'Shanghai Pudong Exchange', hubAirport: 'PVG', hubCity: 'Shanghai' },
  GBLALA: { code: 'GBLALA', name: 'Langley Heathrow HWDC (Royal Mail)', hubAirport: 'LHR', hubCity: 'London' },
  USJFKA: { code: 'USJFKA', name: 'JFK New York ISC (USPS)', hubAirport: 'JFK', hubCity: 'New York' },
  DEFRAB: { code: 'DEFRAB', name: 'Frankfurt Airport IPZ (Deutsche Post)', hubAirport: 'FRA', hubCity: 'Frankfurt' },
  SGSINA: { code: 'SGSINA', name: 'Singapore Changi Airmail Transit', hubAirport: 'SIN', hubCity: 'Singapore' },
  AEDXBA: { code: 'AEDXBA', name: 'Dubai Airmail Transit Hub (Emirates)', hubAirport: 'DXB', hubCity: 'Dubai' },
  TRISTB: { code: 'TRISTB', name: 'Istanbul PTT Airmail Exchange', hubAirport: 'IST', hubCity: 'Istanbul' },
  PKISBA: { code: 'PKISBA', name: 'Islamabad International Mail Office', hubAirport: 'ISB', hubCity: 'Islamabad' },
  PKKHIA: { code: 'PKKHIA', name: 'Karachi Air Mail Exchange Office', hubAirport: 'KHI', hubCity: 'Karachi' },
  PKLHEA: { code: 'PKLHEA', name: 'Lahore Airport Mail Exchange', hubAirport: 'LHE', hubCity: 'Lahore' }
};

/**
 * Reassemble UPU dispatch descriptors from raw checkpoint observations
 */
export function resolveDispatchDescriptor(result: TrackingResult): DispatchDescriptor | null {
  const cleanId = (result.trackingNo || '').trim().toUpperCase();
  if (!cleanId || cleanId.endsWith('PK') || !result.found) {
    return null;
  }

  const countryCode = /^[A-Z]{2}\d{9}([A-Z]{2})$/.exec(cleanId)?.[1];
  const originCode = countryCode || 'INTL';

  // Detect destination IMO
  const allText = result.events.map((e) => `${e.status} ${e.location}`).join(' ').toLowerCase();
  let destKey = 'PKISBA';
  if (allText.includes('karachi') || allText.includes('khi')) {
    destKey = 'PKKHIA';
  } else if (allText.includes('lahore') || allText.includes('lhe')) {
    destKey = 'PKLHEA';
  }

  const destOffice = UPU_OFFICE_CATALOG[destKey] || UPU_OFFICE_CATALOG.PKISBA;

  // Detect origin exchange
  let originOffice = UPU_OFFICE_CATALOG.NLAMSA;
  let hubAirport = 'DOH / DXB';
  let hubCity = 'Doha / Dubai (Middle East Air Corridor)';
  let lane = 'Airmail Consignment via Middle East Freight Hub';

  if (originCode === 'NL') {
    originOffice = allText.includes('den haag') ? UPU_OFFICE_CATALOG.NLDHGA : UPU_OFFICE_CATALOG.NLAMSA;
    hubAirport = 'DOH';
    hubCity = 'Doha (Qatar Airways Cargo)';
    lane = 'PostNL Bilateral Direct Dispatch (AMS -> DOH -> ISB/KHI)';
  } else if (originCode === 'CN') {
    originOffice = allText.includes('shanghai') ? UPU_OFFICE_CATALOG.CNSGHA : UPU_OFFICE_CATALOG.CNBJSA;
    hubAirport = 'URC / DXB';
    hubCity = 'Urumqi / Dubai Air Cargo';
    lane = 'China Post Direct Consignment to Pakistan';
  } else if (originCode === 'GB') {
    originOffice = UPU_OFFICE_CATALOG.GBLALA;
    hubAirport = 'LHR / DXB';
    hubCity = 'Heathrow / Dubai';
    lane = 'Royal Mail Air Postal Dispatch (HWDC -> LHR -> PK)';
  } else if (originCode === 'US') {
    originOffice = UPU_OFFICE_CATALOG.USJFKA;
    hubAirport = 'JFK / DOH';
    hubCity = 'New York / Doha';
    lane = 'USPS Priority Air Dispatch';
  } else if (originCode === 'DE') {
    originOffice = UPU_OFFICE_CATALOG.DEFRAB;
    hubAirport = 'FRA / IST';
    hubCity = 'Frankfurt / Istanbul';
    lane = 'Deutsche Post IPZ Frankfurt Air Line';
  } else if (originCode === 'SG') {
    originOffice = UPU_OFFICE_CATALOG.SGSINA;
    hubAirport = 'SIN / BKK';
    hubCity = 'Singapore / Bangkok';
    lane = 'SingPost Air Corridor';
  } else {
    originOffice = {
      code: `${originCode}EXCH`,
      name: `${result.origin || originCode} Outward Office of Exchange`,
      hubAirport: 'TRANSIT',
      hubCity: 'International Air Transit'
    };
  }

  const isEms = cleanId.startsWith('E') || cleanId.startsWith('L');

  return {
    originExchangeCode: originOffice.code,
    originExchangeName: originOffice.name,
    destinationExchangeCode: destOffice.code,
    destinationExchangeName: destOffice.name,
    mailClass: isEms ? 'UPU ePacket / Express Airmail (EMS)' : 'UPU Standard Air Parcel',
    transitHubAirport: hubAirport,
    transitHubCity: hubCity,
    carrierLogisticsLane: lane,
    confidence: originCode === 'NL' || originCode === 'CN' ? 'verified_edi' : 'standard_bilateral'
  };
}

/**
 * Predict exact last-mile delivery beat & duty protocol for Pakistan Post
 */
export function predictPostmanBeat(result: TrackingResult): PostmanBeatPrediction | null {
  if (!result.found || result.events.length === 0) return null;

  const latest = result.latestEvent;
  if (!latest) return null;

  const allText = result.events.map((e) => `${e.status} ${e.location}`).join(' ').toLowerCase();
  const latestText = `${latest.status} ${latest.location}`.toLowerCase();

  const isDelivered = result.statusCategory === 'DELIVERED';
  if (isDelivered) {
    return {
      isDomesticBeatActive: false,
      dutyPayableAtDoor: false,
      actionNote: 'Parcel successfully delivered to addressee.'
    };
  }

  const isAtDeliveryOffice =
    latestText.includes('delivery office') ||
    latestText.includes('received at delivery') ||
    latestText.includes('dispatched to delivery office') ||
    latestText.includes('out for delivery');

  const isAtExchange =
    latestText.includes('office of exchange') ||
    latestText.includes('customs') ||
    latestText.includes('retention') ||
    allText.includes('office of exchange');

  if (isAtDeliveryOffice) {
    return {
      isDomesticBeatActive: true,
      beatWindow: '09:30 AM – 01:30 PM PKT (Official Delivery Beat)',
      deliveryOffice: latest.location || 'Local Sub-Post Office / GPO',
      dutyPayableAtDoor: true,
      actionNote: 'Out on morning beat. Have exact cash ready if customs duty receipt is attached.'
    };
  }

  if (isAtExchange) {
    return {
      isDomesticBeatActive: false,
      beatWindow: 'Clearing Inward Customs (24–48h window)',
      deliveryOffice: latest.location || 'International Mail Office',
      dutyPayableAtDoor: true,
      actionNote: 'Customs assessment in progress. Any duty assessed will be collected at door upon delivery.'
    };
  }

  return null;
}
