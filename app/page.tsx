'use client';

import { useState, useEffect } from 'react';
import { Search, Settings, Trash2, ArrowUpRight, X } from 'lucide-react';
import { TrackingResult } from '@/lib/types';

interface TrackedItem {
  id: string;
  label?: string;
}

export default function Home() {
  const [trackingId, setTrackingId] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Daily tracking list
  const [trackedParcels, setTrackedParcels] = useState<TrackedItem[]>([]);
  const [isServerDiscordSet, setIsServerDiscordSet] = useState(false);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);

  // Load initial data
  useEffect(() => {
    // 1. Load webhook from localStorage if saved
    const savedWebhook = localStorage.getItem('pakpost_discord_webhook');
    if (savedWebhook) {
      setWebhookUrl(savedWebhook);
    }

    // 2. Fetch server config & parcels
    fetch('/api/parcels')
      .then((r) => r.json())
      .then((data) => {
        setIsServerDiscordSet(Boolean(data.hasDiscord));

        // Merge server parcels with localStorage parcels
        const localSaved = localStorage.getItem('pakpost_tracked_parcels');
        let combined: TrackedItem[] = Array.isArray(data.parcels) ? data.parcels : [];

        if (localSaved) {
          try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (!combined.some((p) => p.id === item.id)) {
                  combined.push(item);
                }
              }
            }
          } catch {
            // Ignore corrupted local storage
          }
        }

        setTrackedParcels(combined);
      })
      .catch(() => {});
  }, []);

  const hasWebhookConfigured = Boolean(isServerDiscordSet || webhookUrl.trim());

  const handleTrack = async (idToTrack?: string, customLabel?: string) => {
    const targetId = (idToTrack || trackingId).trim().toUpperCase();
    if (!targetId) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const activeLabel = customLabel !== undefined ? customLabel : label;
      const res = await fetch(
        `/api/track?id=${encodeURIComponent(targetId)}${activeLabel ? `&label=${encodeURIComponent(activeLabel)}` : ''}`
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to fetch tracking data');
      } else {
        setResult(data);
      }
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const isAlreadyTracked = (idToCheck: string) => {
    return trackedParcels.some((p) => p.id.toUpperCase() === idToCheck.toUpperCase());
  };

  const handleAddToDailyTracking = async () => {
    if (!result) return;

    if (!hasWebhookConfigured) {
      setShowSettings(true);
      setSettingsFeedback('Please set your Discord Webhook URL below to enable daily tracking.');
      return;
    }

    const cleanId = result.trackingNo.toUpperCase();
    if (isAlreadyTracked(cleanId)) return;

    const updated = [...trackedParcels, { id: cleanId, label: result.label || label || undefined }];
    setTrackedParcels(updated);
    localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(updated));

    // Also inform server API (persists in dev)
    fetch('/api/parcels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', id: cleanId, label: result.label || label || undefined })
    }).catch(() => {});
  };

  const handleRemoveFromTracking = (idToRemove: string) => {
    const updated = trackedParcels.filter((p) => p.id.toUpperCase() !== idToRemove.toUpperCase());
    setTrackedParcels(updated);
    localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(updated));

    fetch('/api/parcels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove', id: idToRemove })
    }).catch(() => {});
  };

  const [copiedVercel, setCopiedVercel] = useState(false);

  const handleSaveWebhook = (urlValue?: string) => {
    const val = (urlValue !== undefined ? urlValue : webhookUrl).trim();
    setWebhookUrl(val);
    if (val) {
      localStorage.setItem('pakpost_discord_webhook', val);
      setSettingsFeedback('Webhook saved.');
    } else {
      localStorage.removeItem('pakpost_discord_webhook');
      setSettingsFeedback('Webhook cleared.');
    }
  };

  const handleCopyVercelString = () => {
    const str = trackedParcels
      .map((p) => (p.label ? `${p.id}:${p.label}` : p.id))
      .join(',');
    navigator.clipboard.writeText(str);
    setCopiedVercel(true);
    setTimeout(() => setCopiedVercel(false), 2000);
  };

  const handleTestWebhook = async () => {
    setTestLoading(true);
    setSettingsFeedback(null);
    try {
      const res = await fetch('/api/notify-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhookUrl: webhookUrl.trim() || undefined })
      });
      const data = await res.json();
      if (res.ok) {
        setSettingsFeedback('Test message sent to Discord successfully.');
      } else {
        setSettingsFeedback(data.error || 'Failed to send test message.');
      }
    } catch {
      setSettingsFeedback('Network error testing webhook.');
    } finally {
      setTestLoading(false);
    }
  };

  const handleRunCheckNow = async () => {
    setRunLoading(true);
    setSettingsFeedback(null);
    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      if (res.ok) {
        setSettingsFeedback(`Checked ${data.totalParcels} parcel(s) and sent updates to Discord.`);
      } else {
        setSettingsFeedback(data.error || 'Error running check.');
      }
    } catch {
      setSettingsFeedback('Network error executing check.');
    } finally {
      setRunLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white antialiased font-sans">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-10">
        {/* Header */}
        <header className="flex items-baseline justify-between border-b border-black dark:border-neutral-800 pb-4">
          <h1 className="text-xl font-bold tracking-tight uppercase">Pakistan Post Tracker</h1>
          <button
            onClick={() => {
              setSettingsFeedback(null);
              setShowSettings(true);
            }}
            className="text-xs uppercase tracking-wider font-mono text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white flex items-center gap-1"
          >
            <Settings className="w-3.5 h-3.5" />
            Settings
          </button>
        </header>

        {/* Search Form */}
        <section>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTrack();
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <label htmlFor="trackingId" className="block text-xs font-mono uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
                Tracking ID
              </label>
              <input
                id="trackingId"
                type="text"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                placeholder="e.g. LT880952265NL"
                className="w-full px-3 py-2 text-sm font-mono border border-black dark:border-neutral-700 bg-transparent text-black dark:text-white focus:outline-none focus:ring-1 focus:ring-black dark:focus:ring-white"
                required
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="label" className="block text-xs font-mono uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
                Label (Optional)
              </label>
              <input
                id="label"
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Netherlands Package"
                className="w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-800 bg-transparent text-black dark:text-white focus:outline-none focus:border-black dark:focus:border-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-black hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-mono uppercase tracking-wider font-semibold transition disabled:opacity-50"
            >
              {loading ? 'Tracking...' : 'Track'}
            </button>
          </form>

          {error && (
            <div className="mt-4 p-3 text-xs font-mono border border-black dark:border-neutral-700 text-black dark:text-white">
              {error}
            </div>
          )}
        </section>

        {/* Result Section */}
        {result && (
          <section className="border border-black dark:border-neutral-800 p-5 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <div>
                <span className="font-mono text-lg font-bold">{result.trackingNo}</span>
                {result.label && (
                  <span className="ml-2 text-xs font-mono text-neutral-500">
                    ({result.label})
                  </span>
                )}
              </div>
              <a
                href={`https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(result.trackingNo)}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-mono text-neutral-500 hover:text-black dark:hover:text-white inline-flex items-center gap-1"
              >
                ep.gov.pk <ArrowUpRight className="w-3 h-3" />
              </a>
            </div>

            {/* Status Summary */}
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex">
                <span className="w-24 text-neutral-500 uppercase">Status:</span>
                <span className="font-semibold">{result.latestEvent?.status || 'No records found'}</span>
              </div>
              {result.latestEvent?.location && (
                <div className="flex">
                  <span className="w-24 text-neutral-500 uppercase">Location:</span>
                  <span>{result.latestEvent.location}</span>
                </div>
              )}
              {result.latestEvent && (
                <div className="flex">
                  <span className="w-24 text-neutral-500 uppercase">Updated:</span>
                  <span>
                    {result.latestEvent.date} {result.latestEvent.time && `• ${result.latestEvent.time}`}
                  </span>
                </div>
              )}
              <div className="flex">
                <span className="w-24 text-neutral-500 uppercase">Route:</span>
                <span>{result.origin} → {result.destination}</span>
              </div>
            </div>

            {/* Checkpoints History */}
            {result.events.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                <div className="text-xs font-mono uppercase tracking-wider text-neutral-500">
                  History ({result.events.length})
                </div>
                <div className="space-y-2.5">
                  {[...result.events].reverse().map((ev, i) => (
                    <div key={i} className="text-xs font-mono border-l-2 border-neutral-300 dark:border-neutral-700 pl-3 py-0.5 space-y-0.5">
                      <div className="font-semibold">{ev.status}</div>
                      <div className="text-neutral-500">
                        {ev.location} • {ev.date} {ev.time && `(${ev.time})`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add to Daily Tracking Button (Hidden if already in list) */}
            <div className="pt-2">
              {isAlreadyTracked(result.trackingNo) ? (
                <div className="text-xs font-mono text-neutral-500">
                  ✓ In daily tracking list
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleAddToDailyTracking}
                  className="w-full py-2 border border-black dark:border-neutral-700 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-xs font-mono uppercase tracking-wider font-semibold transition"
                >
                  + Add to Daily Tracking
                </button>
              )}
            </div>
          </section>
        )}

        {/* Daily Tracking List */}
        <section className="space-y-3 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <div className="text-xs font-mono uppercase tracking-wider text-neutral-500">
            Daily Tracking ({trackedParcels.length})
          </div>

          {trackedParcels.length === 0 ? (
            <div className="text-xs font-mono text-neutral-400 py-3">
              No parcels in daily tracking. Track an ID and add it here.
            </div>
          ) : (
            <div className="divide-y divide-neutral-200 dark:divide-neutral-800 border-y border-neutral-200 dark:border-neutral-800">
              {trackedParcels.map((parcel) => (
                <div
                  key={parcel.id}
                  className="py-2.5 flex items-center justify-between gap-4 text-xs font-mono"
                >
                  <div
                    onClick={() => {
                      setTrackingId(parcel.id);
                      setLabel(parcel.label || '');
                      handleTrack(parcel.id, parcel.label);
                    }}
                    className="cursor-pointer hover:underline"
                  >
                    <span className="font-bold">{parcel.id}</span>
                    {parcel.label && (
                      <span className="ml-2 text-neutral-500">({parcel.label})</span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setTrackingId(parcel.id);
                        setLabel(parcel.label || '');
                        handleTrack(parcel.id, parcel.label);
                      }}
                      className="text-neutral-500 hover:text-black dark:hover:text-white"
                    >
                      Track
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveFromTracking(parcel.id)}
                      className="text-neutral-400 hover:text-black dark:hover:text-white"
                      title="Remove from daily tracking"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-black border border-black dark:border-neutral-700 w-full max-w-md p-6 space-y-5 text-black dark:text-white">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <h2 className="text-sm font-mono font-bold uppercase tracking-wider">Settings</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-neutral-500 hover:text-black dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="webhook" className="block text-xs font-mono uppercase tracking-wider text-neutral-600 dark:text-neutral-400">
                Discord Webhook URL
              </label>
              <div className="flex gap-2">
                <input
                  id="webhook"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="flex-1 px-3 py-2 text-xs font-mono border border-black dark:border-neutral-700 bg-transparent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleSaveWebhook()}
                  className="px-3 py-2 border border-black dark:border-neutral-700 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black text-xs font-mono uppercase font-semibold"
                >
                  Save
                </button>
              </div>
              <p className="text-[11px] font-mono text-neutral-500">
                {isServerDiscordSet
                  ? 'Server environment variable DISCORD_WEBHOOK_URL is configured.'
                  : 'Daily updates will be posted to this Discord webhook.'}
              </p>
            </div>

            {trackedParcels.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-neutral-200 dark:border-neutral-800 text-xs font-mono">
                <div className="flex items-center justify-between text-neutral-600 dark:text-neutral-400">
                  <span className="uppercase tracking-wider">Vercel TRACKING_IDS Env</span>
                  <button
                    type="button"
                    onClick={handleCopyVercelString}
                    className="underline text-[11px] hover:text-black dark:hover:text-white"
                  >
                    {copiedVercel ? 'Copied!' : 'Copy Value'}
                  </button>
                </div>
                <div className="p-2 border border-neutral-200 dark:border-neutral-800 text-[11px] break-all select-all text-neutral-500">
                  {trackedParcels.map((p) => (p.label ? `${p.id}:${p.label}` : p.id)).join(',')}
                </div>
              </div>
            )}

            <div className="space-y-1.5 pt-2 border-t border-neutral-200 dark:border-neutral-800 text-xs font-mono text-neutral-500">
              <div>Schedule: Daily at 09:00 AM PKT (04:00 UTC)</div>
              <div>Engine: ep.gov.pk EMTTS</div>
            </div>

            {settingsFeedback && (
              <div className="p-2.5 text-xs font-mono border border-black dark:border-neutral-700">
                {settingsFeedback}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={testLoading}
                className="w-full py-2 border border-black dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-xs font-mono uppercase tracking-wider"
              >
                {testLoading ? 'Testing...' : 'Test Discord Webhook'}
              </button>

              <button
                type="button"
                onClick={handleRunCheckNow}
                disabled={runLoading}
                className="w-full py-2 bg-black hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-mono uppercase tracking-wider font-semibold"
              >
                {runLoading ? 'Running...' : 'Run Daily Check Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
