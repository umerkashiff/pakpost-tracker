'use client';

import { useState, useEffect, useRef } from 'react';
import { Settings, Trash2, ArrowUpRight, X, ArrowDown, ArrowUp, RefreshCw, Check } from 'lucide-react';
import GradientASCII from '@/components/GradientASCII';
import { TrackingResult } from '@/lib/types';

interface TrackedItem {
  id: string;
  label?: string;
}

type ActiveView = 'search' | 'result' | 'daily';

export default function Home() {
  const [trackingId, setTrackingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active view: 'search' | 'result' | 'daily'
  const [view, setView] = useState<ActiveView>('search');

  // Daily tracking list
  const [trackedParcels, setTrackedParcels] = useState<TrackedItem[]>([]);
  const [isServerDiscordSet, setIsServerDiscordSet] = useState(false);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [copiedVercel, setCopiedVercel] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Load initial data
  useEffect(() => {
    const savedWebhook = localStorage.getItem('pakpost_discord_webhook');
    if (savedWebhook) {
      setWebhookUrl(savedWebhook);
    }

    fetch('/api/parcels')
      .then((r) => r.json())
      .then((data) => {
        setIsServerDiscordSet(Boolean(data.hasDiscord));

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
            // Ignore parse errors
          }
        }

        setTrackedParcels(combined);
      })
      .catch(() => {});
  }, []);

  // Listen to wheel events to transition between search and daily view
  useEffect(() => {
    let timeout: NodeJS.Timeout | null = null;

    const handleWheel = (e: WheelEvent) => {
      if (showSettings) return;
      if (view === 'result') return; // In result view, wheel scrolls inside the modal if needed

      if (Math.abs(e.deltaY) < 25) return;

      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (view === 'search' && e.deltaY > 25) {
          setView('daily');
        } else if (view === 'daily' && e.deltaY < -25) {
          setView('search');
        }
      }, 40);
    };

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (showSettings || view === 'result') return;
      const deltaY = touchStartY - e.changedTouches[0].clientY;
      if (view === 'search' && deltaY > 35) {
        setView('daily');
      } else if (view === 'daily' && deltaY < -35) {
        setView('search');
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      if (timeout) clearTimeout(timeout);
    };
  }, [view, showSettings]);

  const hasWebhookConfigured = Boolean(isServerDiscordSet || webhookUrl.trim());

  const handleTrack = async (idToTrack?: string) => {
    const targetId = (idToTrack || trackingId).trim().toUpperCase();
    if (!targetId) return;

    setLoading(true);
    setError(null);
    setResult(null);

    // Transition view to result so user sees the translucent result box unblurring
    setView('result');

    try {
      const res = await fetch(`/api/track?id=${encodeURIComponent(targetId)}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || 'Failed to fetch tracking data');
      } else {
        setResult(data);
      }
    } catch {
      setError('Connection failed. Please check network.');
    } finally {
      setLoading(false);
    }
  };

  const isAlreadyTracked = (idToCheck: string) => {
    return trackedParcels.some((p) => p.id.toUpperCase() === idToCheck.toUpperCase());
  };

  const handleAddToDailyTracking = () => {
    if (!result) return;

    if (!hasWebhookConfigured) {
      setShowSettings(true);
      setSettingsFeedback('Please set your Discord Webhook URL below to enable daily tracking.');
      return;
    }

    const cleanId = result.trackingNo.toUpperCase();
    if (isAlreadyTracked(cleanId)) return;

    const updated = [...trackedParcels, { id: cleanId, label: result.label || undefined }];
    setTrackedParcels(updated);
    localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(updated));

    fetch('/api/parcels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add', id: cleanId, label: result.label || undefined })
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

  const handleSaveWebhook = (val?: string) => {
    const value = (val !== undefined ? val : webhookUrl).trim();
    setWebhookUrl(value);
    if (value) {
      localStorage.setItem('pakpost_discord_webhook', value);
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
        setSettingsFeedback(`Checked ${data.totalParcels} parcel(s) and dispatched to Discord.`);
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
    <main
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans select-none"
    >
      {/* 1. Background ASCII Layer */}
      <div className="absolute inset-0 w-full h-full z-0 overflow-hidden pointer-events-auto">
        <GradientASCII
          colors={['#0d9488', '#5eead4', '#f0fdfa']}
          shape="pinch"
          characters=" .:-=+*#%@"
          cellSize={16}
          density={0.8}
        />
      </div>

      {/* 2. Top Right Settings Pill */}
      <div className="absolute top-5 right-5 z-40">
        <button
          onClick={() => {
            setSettingsFeedback(null);
            setShowSettings(true);
          }}
          className="px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/20 text-neutral-300 hover:text-white transition flex items-center gap-1.5 shadow-lg"
        >
          <Settings className="w-3.5 h-3.5" />
          Settings
        </button>
      </div>

      {/* 3. Centered Interactive Container */}
      <div className="relative z-10 w-full h-full flex items-center justify-center p-4">
        {/* VIEW A: Search Bar (Centered) */}
        <div
          className={`absolute w-full max-w-md transition-all duration-500 ease-out transform ${
            view === 'search'
              ? 'opacity-100 blur-none scale-100 pointer-events-auto'
              : 'opacity-0 blur-md scale-95 pointer-events-none'
          }`}
        >
          <div className="backdrop-blur-xl bg-black/60 border border-white/20 shadow-2xl rounded-2xl p-6 space-y-4">
            <div className="space-y-1">
              <label
                htmlFor="mainTrackingInput"
                className="block text-xs font-mono uppercase tracking-wider text-neutral-400"
              >
                Tracking ID
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrack();
                }}
                className="flex items-center gap-2"
              >
                <input
                  id="mainTrackingInput"
                  type="text"
                  value={trackingId}
                  onChange={(e) => setTrackingId(e.target.value.toUpperCase())}
                  placeholder="e.g. LT880952265NL"
                  className="flex-1 px-4 py-2.5 text-sm font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-white focus:ring-1 focus:ring-white transition"
                  required
                  autoFocus={view === 'search'}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-white hover:bg-neutral-200 text-black rounded-xl text-xs font-mono uppercase tracking-wider font-bold transition disabled:opacity-50 shadow-md"
                >
                  Track
                </button>
              </form>
            </div>

            {/* Quick sample prompt */}
            <div className="pt-1 flex items-center justify-between text-[11px] font-mono text-neutral-400">
              <span>Sample:</span>
              <button
                type="button"
                onClick={() => {
                  setTrackingId('LT880952265NL');
                  handleTrack('LT880952265NL');
                }}
                className="underline hover:text-white transition"
              >
                LT880952265NL
              </button>
            </div>
          </div>
        </div>

        {/* VIEW B: Result Glass Box (Unblurs into view when tracked) */}
        <div
          className={`absolute w-full max-w-lg transition-all duration-500 ease-out transform ${
            view === 'result'
              ? 'opacity-100 blur-none scale-100 pointer-events-auto'
              : 'opacity-0 blur-md scale-95 pointer-events-none'
          }`}
        >
          <div className="backdrop-blur-xl bg-black/75 border border-white/20 shadow-2xl rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            {/* Header / Dismiss */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-bold text-white">
                  {result ? result.trackingNo : trackingId}
                </span>
                {result?.label && (
                  <span className="text-xs font-mono text-neutral-400">({result.label})</span>
                )}
              </div>
              <button
                onClick={() => setView('search')}
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition"
                title="Back to search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-neutral-400 text-xs font-mono">
                <RefreshCw className="w-5 h-5 animate-spin text-white" />
                <span>Querying Pakistan Post EMTTS...</span>
              </div>
            )}

            {error && !loading && (
              <div className="p-4 border border-red-500/40 bg-red-950/20 text-red-200 text-xs font-mono rounded-xl">
                {error}
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4">
                {/* Status Summary */}
                <div className="space-y-1.5 text-xs font-mono bg-white/5 border border-white/10 rounded-xl p-3.5">
                  <div className="flex">
                    <span className="w-24 text-neutral-400 uppercase">Status:</span>
                    <span className="font-semibold text-white">
                      {result.latestEvent?.status || 'No records found'}
                    </span>
                  </div>
                  {result.latestEvent?.location && (
                    <div className="flex">
                      <span className="w-24 text-neutral-400 uppercase">Location:</span>
                      <span className="text-neutral-200">{result.latestEvent.location}</span>
                    </div>
                  )}
                  {result.latestEvent && (
                    <div className="flex">
                      <span className="w-24 text-neutral-400 uppercase">Updated:</span>
                      <span className="text-neutral-300">
                        {result.latestEvent.date} {result.latestEvent.time && `• ${result.latestEvent.time}`}
                      </span>
                    </div>
                  )}
                  <div className="flex">
                    <span className="w-24 text-neutral-400 uppercase">Route:</span>
                    <span className="text-neutral-300">
                      {result.origin} → {result.destination}
                    </span>
                  </div>
                </div>

                {/* Checkpoint History */}
                {result.events.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-mono uppercase tracking-wider text-neutral-400 flex items-center justify-between">
                      <span>History ({result.events.length})</span>
                      <a
                        href={`https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(result.trackingNo)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-neutral-400 hover:text-white inline-flex items-center gap-1 text-[11px]"
                      >
                        ep.gov.pk <ArrowUpRight className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {[...result.events].reverse().map((ev, i) => (
                        <div
                          key={i}
                          className="text-xs font-mono border-l-2 border-white/30 pl-3 py-1 space-y-0.5"
                        >
                          <div className="font-semibold text-white">{ev.status}</div>
                          <div className="text-neutral-400 text-[11px]">
                            {ev.location} • {ev.date} {ev.time && `(${ev.time})`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add to Daily Tracking action (Hidden if already in list) */}
                <div className="pt-2 border-t border-white/10">
                  {isAlreadyTracked(result.trackingNo) ? (
                    <div className="text-xs font-mono text-neutral-400 flex items-center gap-1.5 py-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> In daily tracking list
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleAddToDailyTracking}
                      className="w-full py-2.5 bg-white hover:bg-neutral-200 text-black text-xs font-mono uppercase tracking-wider font-bold rounded-xl transition shadow-md"
                    >
                      + Add to Daily Tracking
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* VIEW C: Daily Tracking Box (Unblurs when scrolled beneath) */}
        <div
          className={`absolute w-full max-w-md transition-all duration-500 ease-out transform ${
            view === 'daily'
              ? 'opacity-100 blur-none scale-100 pointer-events-auto'
              : 'opacity-0 blur-md scale-95 pointer-events-none'
          }`}
        >
          <div className="backdrop-blur-xl bg-black/75 border border-white/20 shadow-2xl rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-white">
                Daily Tracking ({trackedParcels.length})
              </h2>
              <button
                onClick={() => setView('search')}
                className="text-xs font-mono text-neutral-400 hover:text-white flex items-center gap-1 transition"
              >
                <ArrowUp className="w-3.5 h-3.5" /> Search
              </button>
            </div>

            {trackedParcels.length === 0 ? (
              <div className="text-xs font-mono text-neutral-400 py-6 text-center">
                No parcels in daily tracking.
              </div>
            ) : (
              <div className="divide-y divide-white/10 border-y border-white/10">
                {trackedParcels.map((parcel) => (
                  <div
                    key={parcel.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs font-mono"
                  >
                    <div
                      onClick={() => {
                        setTrackingId(parcel.id);
                        handleTrack(parcel.id);
                      }}
                      className="cursor-pointer hover:underline"
                    >
                      <span className="font-bold text-white">{parcel.id}</span>
                      {parcel.label && (
                        <span className="ml-2 text-neutral-400">({parcel.label})</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTrackingId(parcel.id);
                          handleTrack(parcel.id);
                        }}
                        className="text-neutral-300 hover:text-white underline text-[11px]"
                      >
                        Track
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromTracking(parcel.id)}
                        className="text-neutral-500 hover:text-red-400 transition"
                        title="Remove from tracking"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. Bottom Scroll Indicator */}
      <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 z-30">
        {view === 'search' && (
          <button
            onClick={() => setView('daily')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-neutral-400 hover:text-white bg-black/40 backdrop-blur-md border border-white/10 transition shadow-md"
          >
            <span>Daily Tracking ({trackedParcels.length})</span>
            <ArrowDown className="w-3 h-3 animate-bounce" />
          </button>
        )}

        {view === 'daily' && (
          <button
            onClick={() => setView('search')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-neutral-400 hover:text-white bg-black/40 backdrop-blur-md border border-white/10 transition shadow-md"
          >
            <ArrowUp className="w-3 h-3" />
            <span>Back to Search</span>
          </button>
        )}

        {view === 'result' && (
          <button
            onClick={() => setView('search')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-neutral-400 hover:text-white bg-black/40 backdrop-blur-md border border-white/10 transition shadow-md"
          >
            <span>Back to Search</span>
          </button>
        )}
      </div>

      {/* 5. Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="backdrop-blur-2xl bg-black/85 border border-white/20 w-full max-w-md p-6 space-y-5 rounded-2xl shadow-2xl text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="webhook"
                className="block text-xs font-mono uppercase tracking-wider text-neutral-400"
              >
                Discord Webhook URL
              </label>
              <div className="flex gap-2">
                <input
                  id="webhook"
                  type="url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="flex-1 px-3 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white focus:outline-none focus:border-white"
                />
                <button
                  type="button"
                  onClick={() => handleSaveWebhook()}
                  className="px-3 py-2 bg-white text-black hover:bg-neutral-200 rounded-xl text-xs font-mono uppercase font-semibold transition"
                >
                  Save
                </button>
              </div>
              <p className="text-[11px] font-mono text-neutral-400">
                {isServerDiscordSet
                  ? 'Server environment variable DISCORD_WEBHOOK_URL is configured.'
                  : 'Daily updates will be posted to this Discord webhook.'}
              </p>
            </div>

            {trackedParcels.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-white/10 text-xs font-mono">
                <div className="flex items-center justify-between text-neutral-400">
                  <span className="uppercase tracking-wider">Vercel TRACKING_IDS Env</span>
                  <button
                    type="button"
                    onClick={handleCopyVercelString}
                    className="underline text-[11px] hover:text-white"
                  >
                    {copiedVercel ? 'Copied!' : 'Copy Value'}
                  </button>
                </div>
                <div className="p-2 bg-white/5 border border-white/10 rounded-lg text-[11px] break-all select-all text-neutral-400">
                  {trackedParcels.map((p) => (p.label ? `${p.id}:${p.label}` : p.id)).join(',')}
                </div>
              </div>
            )}

            <div className="space-y-1 pt-2 border-t border-white/10 text-xs font-mono text-neutral-400">
              <div>Schedule: Daily at 09:00 AM PKT (04:00 UTC)</div>
              <div>Engine: ep.gov.pk EMTTS</div>
            </div>

            {settingsFeedback && (
              <div className="p-2.5 text-xs font-mono border border-white/20 bg-white/5 rounded-xl">
                {settingsFeedback}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={testLoading}
                className="w-full py-2 border border-white/20 hover:bg-white/10 rounded-xl text-xs font-mono uppercase tracking-wider text-neutral-300 hover:text-white transition"
              >
                {testLoading ? 'Testing...' : 'Test Discord Webhook'}
              </button>

              <button
                type="button"
                onClick={handleRunCheckNow}
                disabled={runLoading}
                className="w-full py-2 bg-white text-black hover:bg-neutral-200 rounded-xl text-xs font-mono uppercase tracking-wider font-bold transition shadow-md"
              >
                {runLoading ? 'Running...' : 'Run Daily Check Now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
