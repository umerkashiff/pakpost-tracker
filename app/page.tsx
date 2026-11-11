'use client';

import { useState, useEffect } from 'react';
import { Settings, Trash2, ArrowUpRight, X, ArrowDown, ArrowUp, RefreshCw, Check, Lock, Unlock } from 'lucide-react';
import GradientASCII from '@/components/GradientASCII';
import { TrackingResult } from '@/lib/types';

interface TrackedItem {
  id: string;
  label?: string;
}

type ActiveView = 'search' | 'result' | 'daily' | 'settings';

export default function Home() {
  const [trackingId, setTrackingId] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active view: 'search' | 'result' | 'daily' | 'settings'
  const [view, setView] = useState<ActiveView>('search');

  // Daily tracking list
  const [trackedParcels, setTrackedParcels] = useState<TrackedItem[]>([]);
  const [isServerDiscordSet, setIsServerDiscordSet] = useState(false);

  // Settings state (only Schedule & Webhook, locked by passcode "uwu123")
  const [passcode, setPasscode] = useState('');
  const [schedule, setSchedule] = useState('0 4 * * *');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const isUnlocked = passcode === 'uwu123';

  // Load initial data
  useEffect(() => {
    const savedWebhook = localStorage.getItem('pakpost_discord_webhook');
    if (savedWebhook) {
      setWebhookUrl(savedWebhook);
    }
    const savedSchedule = localStorage.getItem('pakpost_schedule');
    if (savedSchedule) {
      setSchedule(savedSchedule);
    }

    fetch('/api/parcels')
      .then((r) => r.json())
      .then((data) => {
        setIsServerDiscordSet(Boolean(data.hasDiscord));
        if (data.schedule && !savedSchedule) {
          setSchedule(data.schedule);
        }

        // Local list is the source of truth once it exists, so deletions persist across reloads.
        const localSaved = localStorage.getItem('pakpost_tracked_parcels');
        let localList: TrackedItem[] | null = null;

        if (localSaved !== null) {
          try {
            const parsed = JSON.parse(localSaved);
            if (Array.isArray(parsed)) localList = parsed;
          } catch {
            // Ignore parse error
          }
        }

        let finalList: TrackedItem[];
        if (localList !== null) {
          finalList = localList;
        } else {
          finalList = Array.isArray(data.parcels)
            ? data.parcels.map((p: TrackedItem) => ({ id: p.id, label: p.label }))
            : [];
          localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(finalList));
        }

        setTrackedParcels(finalList);
      })
      .catch(() => {});
  }, []);

  // Smooth scroll detection between search and daily tracking
  useEffect(() => {
    let lastSwitchTime = 0;
    const COOLDOWN_MS = 450;

    const handleWheel = (e: WheelEvent) => {
      if (view === 'result' || view === 'settings') return;

      const now = Date.now();
      if (now - lastSwitchTime < COOLDOWN_MS) return;

      if (e.deltaY > 4 && view === 'search') {
        lastSwitchTime = now;
        setView('daily');
      } else if (e.deltaY < -4 && view === 'daily') {
        lastSwitchTime = now;
        setView('search');
      }
    };

    let touchStartY = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0].clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (view === 'result' || view === 'settings') return;
      const now = Date.now();
      if (now - lastSwitchTime < COOLDOWN_MS) return;

      const deltaY = touchStartY - e.changedTouches[0].clientY;
      if (deltaY > 15 && view === 'search') {
        lastSwitchTime = now;
        setView('daily');
      } else if (deltaY < -15 && view === 'daily') {
        lastSwitchTime = now;
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
    };
  }, [view]);

  const hasWebhookConfigured = Boolean(isServerDiscordSet || webhookUrl.trim());

  const handleTrack = async (idToTrack?: string) => {
    const targetId = (idToTrack || trackingId).trim().toUpperCase();
    if (!targetId) return;

    setLoading(true);
    setError(null);
    setResult(null);

    // Blur away search card and unblur result card into view
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
      setSettingsFeedback('Set Discord Webhook in settings first.');
      setView('settings');
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isUnlocked) {
      setSettingsFeedback('Enter passcode to unlock settings.');
      return;
    }

    setSavingSettings(true);
    setSettingsFeedback(null);

    try {
      const cleanWebhook = webhookUrl.trim();
      const cleanSchedule = schedule.trim() || '0 4 * * *';

      if (cleanWebhook) {
        localStorage.setItem('pakpost_discord_webhook', cleanWebhook);
      } else {
        localStorage.removeItem('pakpost_discord_webhook');
      }
      localStorage.setItem('pakpost_schedule', cleanSchedule);

      const res = await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settings',
          passcode,
          webhookUrl: cleanWebhook,
          schedule: cleanSchedule
        })
      });

      if (res.ok) {
        setSettingsFeedback('Settings saved.');
      } else {
        const data = await res.json();
        setSettingsFeedback(data.error || 'Failed to save settings.');
      }
    } catch {
      setSettingsFeedback('Saved locally.');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans select-none flex items-center justify-center">
      {/* 1. Full-Screen Lagoon GradientASCII Background */}
      <div className="fixed inset-0 w-full h-full z-0 overflow-hidden pointer-events-auto bg-black">
        <GradientASCII
          colors={['#0d9488', '#5eead4', '#f0fdfa']}
          shape="pinch"
          characters=" .:-=+*#%@"
          cellSize={16}
          density={0.8}
        />
      </div>

      {/* Site title (small, centered at top) */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-30 text-[11px] font-mono uppercase tracking-wider text-white/80 pointer-events-none">
        Pakistan Post Tracker
      </div>

      {/* 2. Top Right Settings Button */}
      <header className="fixed top-5 right-5 z-40">
        <button
          onClick={() => {
            setSettingsFeedback(null);
            setView(view === 'settings' ? 'search' : 'settings');
          }}
          className="px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider bg-black/60 hover:bg-black/80 border border-white/20 text-white/90 hover:text-white transition-all shadow-lg flex items-center gap-1.5"
        >
          <Settings className="w-3.5 h-3.5" />
          {view === 'settings' ? 'Close' : 'Settings'}
        </button>
      </header>

      {/* 3. Centered Stage (Blur out of existence / unblur into existence with less opaque black shade) */}
      <div className="relative z-10 w-full max-w-lg px-4 flex items-center justify-center pointer-events-none">
        {/* VIEW A: Centered Tracking ID Bar */}
        <div
          aria-hidden={view !== 'search'}
          className={`absolute w-[calc(100%-2rem)] max-w-md transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
            view === 'search'
              ? 'opacity-100 blur-0 scale-100 translate-y-0 pointer-events-auto'
              : view === 'daily'
                ? 'opacity-0 blur-2xl scale-90 -translate-y-8 pointer-events-none'
                : 'opacity-0 blur-2xl scale-90 translate-y-0 pointer-events-none'
          }`}
        >
          <div className="bg-black/60 border border-white/20 shadow-[0_16px_40px_rgba(0,0,0,0.6)] rounded-2xl p-6">
            <label
              htmlFor="mainTrackingInput"
              className="block text-xs font-mono uppercase tracking-wider text-white/80 mb-2 font-medium"
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
                placeholder="e.g. RB491028374PK"
                className="flex-1 px-4 py-2.5 text-sm font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition"
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 bg-white/90 hover:bg-white text-black rounded-xl text-xs font-mono uppercase tracking-wider font-bold transition disabled:opacity-50 shadow-md"
              >
                Track
              </button>
            </form>
          </div>
        </div>

        {/* VIEW B: Shaded Result Card */}
        <div
          aria-hidden={view !== 'result'}
          className={`absolute w-[calc(100%-2rem)] max-w-lg transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
            view === 'result'
              ? 'opacity-100 blur-0 scale-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 blur-2xl scale-90 translate-y-8 pointer-events-none'
          }`}
        >
          <div className="bg-black/60 border border-white/20 shadow-[0_16px_40px_rgba(0,0,0,0.6)] rounded-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 pb-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-lg font-bold text-white">
                  {result ? result.trackingNo : trackingId}
                </span>
                {result?.label && (
                  <span className="text-xs font-mono text-white/70">({result.label})</span>
                )}
              </div>
              <button
                onClick={() => setView('search')}
                className="p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition"
                title="Back to search"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {loading && (
              <div className="py-12 flex flex-col items-center justify-center space-y-3 text-white/70 text-xs font-mono">
                <RefreshCw className="w-5 h-5 animate-spin text-white" />
                <span>Querying Pakistan Post...</span>
              </div>
            )}

            {error && !loading && (
              <div className="p-4 border border-white/20 bg-black/60 text-white text-xs font-mono rounded-xl">
                {error}
              </div>
            )}

            {result && !loading && (
              <div className="space-y-4">
                <div className="space-y-1.5 text-xs font-mono bg-black/40 border border-white/15 rounded-xl p-3.5">
                  <div className="flex">
                    <span className="w-24 text-white/50 uppercase">Status:</span>
                    <span className="font-semibold text-white">
                      {result.latestEvent?.status || 'No records found'}
                    </span>
                  </div>
                  {result.latestEvent?.location && (
                    <div className="flex">
                      <span className="w-24 text-white/50 uppercase">Location:</span>
                      <span className="text-white/90">{result.latestEvent.location}</span>
                    </div>
                  )}
                  {result.latestEvent && (
                    <div className="flex">
                      <span className="w-24 text-white/50 uppercase">Updated:</span>
                      <span className="text-white/80">
                        {result.latestEvent.date} {result.latestEvent.time && `• ${result.latestEvent.time}`}
                      </span>
                    </div>
                  )}
                  <div className="flex">
                    <span className="w-24 text-white/50 uppercase">Route:</span>
                    <span className="text-white/80">
                      {result.origin} → {result.destination}
                    </span>
                  </div>
                </div>

                {result.events.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-mono uppercase tracking-wider text-white/70 flex items-center justify-between">
                      <span>History ({result.events.length})</span>
                      <a
                        href={`https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(result.trackingNo)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white/70 hover:text-white inline-flex items-center gap-1 text-[11px]"
                      >
                        ep.gov.pk <ArrowUpRight className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {[...result.events].reverse().map((ev, i) => (
                        <div
                          key={i}
                          className="text-xs font-mono border-l-2 border-white/40 pl-3 py-1 space-y-0.5"
                        >
                          <div className="font-semibold text-white">{ev.status}</div>
                          <div className="text-white/70 text-[11px]">
                            {ev.location} • {ev.date} {ev.time && `(${ev.time})`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isAlreadyTracked(result.trackingNo) && (
                  <div className="pt-2 border-t border-white/15">
                    <button
                      type="button"
                      onClick={handleAddToDailyTracking}
                      className="w-full py-2.5 bg-white/90 hover:bg-white text-black text-xs font-mono uppercase tracking-wider font-bold rounded-xl transition shadow-md"
                    >
                      + Add to Daily Tracking
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* VIEW C: Shaded Daily Tracking Card (Unblurs on scroll) */}
        <div
          aria-hidden={view !== 'daily'}
          className={`absolute w-[calc(100%-2rem)] max-w-md transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
            view === 'daily'
              ? 'opacity-100 blur-0 scale-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 blur-2xl scale-90 translate-y-8 pointer-events-none'
          }`}
        >
          <div className="bg-black/60 border border-white/20 shadow-[0_16px_40px_rgba(0,0,0,0.6)] rounded-2xl p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/20 pb-3">
              <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-white">
                Daily Tracking ({trackedParcels.length})
              </h2>
              <button
                onClick={() => setView('search')}
                className="text-xs font-mono text-white/70 hover:text-white flex items-center gap-1 transition"
              >
                <ArrowUp className="w-3.5 h-3.5" /> Search
              </button>
            </div>

            {trackedParcels.length === 0 ? (
              <div className="text-xs font-mono text-white/60 py-6 text-center">
                No parcels in daily tracking.
              </div>
            ) : (
              <div className="divide-y divide-white/15 border-y border-white/15">
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
                        <span className="ml-2 text-white/70">({parcel.label})</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTrackingId(parcel.id);
                          handleTrack(parcel.id);
                        }}
                        className="text-white/80 hover:text-white underline text-[11px]"
                      >
                        Track
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveFromTracking(parcel.id)}
                        className="text-white/60 hover:text-white transition"
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

        {/* VIEW D: Shaded Settings Card (Unblurs into existence when Settings clicked) */}
        <div
          aria-hidden={view !== 'settings'}
          className={`absolute w-[calc(100%-2rem)] max-w-md transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
            view === 'settings'
              ? 'opacity-100 blur-0 scale-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 blur-2xl scale-90 -translate-y-8 pointer-events-none'
          }`}
        >
          <form
            onSubmit={handleSaveSettings}
            className="bg-black/60 border border-white/20 shadow-[0_16px_40px_rgba(0,0,0,0.6)] rounded-2xl p-6 space-y-4 text-white"
          >
            <div className="flex items-center justify-between border-b border-white/20 pb-3">
              <h2 className="text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-1.5">
                {isUnlocked ? (
                  <Unlock className="w-3.5 h-3.5 text-white" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-white/70" />
                )}
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setView('search')}
                className="text-white/70 hover:text-white transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Passcode Lock */}
            <div className="space-y-1.5">
              <label
                htmlFor="passcode"
                className="block text-xs font-mono uppercase tracking-wider text-white/80"
              >
                Passcode {isUnlocked ? '(Unlocked)' : '(Required to edit)'}
              </label>
              <input
                id="passcode"
                type="password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter passcode..."
                className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition"
              />
            </div>

            {/* Only Setting 1: Change Schedule */}
            <div className="space-y-1.5">
              <label
                htmlFor="schedule"
                className="block text-xs font-mono uppercase tracking-wider text-white/80"
              >
                Change Schedule (Cron)
              </label>
              <input
                id="schedule"
                type="text"
                disabled={!isUnlocked}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="0 4 * * *"
                className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              />
            </div>

            {/* Only Setting 2: Change Webhook */}
            <div className="space-y-1.5">
              <label
                htmlFor="webhook"
                className="block text-xs font-mono uppercase tracking-wider text-white/80"
              >
                Change Webhook
              </label>
              <input
                id="webhook"
                type="url"
                disabled={!isUnlocked}
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              />
            </div>

            {settingsFeedback && (
              <div className="p-2.5 text-xs font-mono border border-white/20 bg-black/40 rounded-xl text-white/90">
                {settingsFeedback}
              </div>
            )}

            <button
              type="submit"
              disabled={!isUnlocked || savingSettings}
              className="w-full py-2.5 bg-white/90 hover:bg-white text-black rounded-xl text-xs font-mono uppercase tracking-wider font-bold transition disabled:opacity-30 disabled:cursor-not-allowed shadow-md"
            >
              {savingSettings ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      </div>

      {/* 4. Subtle Bottom Indicator */}
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-30">
        {view === 'search' && (
          <button
            onClick={() => setView('daily')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:text-white bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 transition shadow-xl"
          >
            <span>Daily Tracking ({trackedParcels.length})</span>
            <ArrowDown className="w-3 h-3" />
          </button>
        )}

        {view !== 'search' && (
          <button
            onClick={() => setView('search')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-wider text-zinc-300 hover:text-white bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 transition shadow-xl"
          >
            <ArrowUp className="w-3 h-3" />
            <span>Back to Search</span>
          </button>
        )}
      </div>
    </main>
  );
}
