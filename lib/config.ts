import fs from 'fs';
import path from 'path';
import { ParcelConfig } from './types';

export function getTrackedParcels(): ParcelConfig[] {
  const parcels: ParcelConfig[] = [];
  const seen = new Set<string>();

  // 1. Load from environment variable TRACKING_IDS
  const envIds = process.env.TRACKING_IDS;
  if (envIds) {
    const items = envIds.split(',').map((s) => s.trim()).filter(Boolean);
    for (const item of items) {
      const [id, ...labelParts] = item.split(':');
      const cleanId = id.trim().toUpperCase();
      const label = labelParts.join(':').trim() || undefined;
      if (cleanId && !seen.has(cleanId)) {
        seen.add(cleanId);
        parcels.push({ id: cleanId, label, enabled: true });
      }
    }
  }

  // 2. Load from parcels.json if it exists
  try {
    const configPath = path.join(process.cwd(), 'parcels.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      const jsonList: Array<{ id: string; label?: string; enabled?: boolean }> = JSON.parse(raw);
      if (Array.isArray(jsonList)) {
        for (const item of jsonList) {
          const cleanId = (item.id || '').trim().toUpperCase();
          if (cleanId && !seen.has(cleanId) && item.enabled !== false) {
            seen.add(cleanId);
            parcels.push({
              id: cleanId,
              label: item.label,
              enabled: true
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to parse parcels.json:', err);
  }

  return parcels;
}

