'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Settings,
  Trash2,
  ArrowUpRight,
  X,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Check,
  Lock,
  Unlock,
  ChevronDown,
  Clock
} from 'lucide-react';
import GradientASCII from '@/components/GradientASCII';
import { TrackingResult } from '@/lib/types';

interface TrackedItem {
  id: string; // The masked ID string, e.g. "LT••••••NL"
  alias?: string; // Opaque security token
  label?: string;
}

type ActiveView = 'search' | 'result' | 'daily' | 'settings';
type SchedulePreset = 'daily' | '12h' | '6h' | '3h' | 'hourly' | 'custom';

const SCHEDULE_OPTIONS: Array<{ value: SchedulePreset; label: string }> = [
  { value: 'daily', label: 'Daily (PKT)' },
  { value: '12h', label: 'Every 12 hours' },
  { value: '6h', label: 'Every 6 hours' },
  { value: '3h', label: 'Every 3 hours' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Custom Cron' }
];

const HOURS_12 = ['12', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];
const MINUTES_5 = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

function split24HourTime(hhmm: string): { hour12: string; minute: string; period: 'AM' | 'PM' } {
  const [rawH, rawM] = (hhmm || '09:00').split(':').map(Number);
  const h24 = Number.isFinite(rawH) ? ((rawH % 24) + 24) % 24 : 9;
  const minVal = Number.isFinite(rawM) ? Math.min(59, Math.max(0, rawM)) : 0;
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  const h12Num = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hour12: String(h12Num).padStart(2, '0'),
    minute: String(minVal).padStart(2, '0'),
    period
  };
}

function join24HourTime(hour12: string, minute: string, period: 'AM' | 'PM'): string {
  const hNum = Number(hour12) || 12;
  let h24 = hNum % 12;
  if (period === 'PM') h24 += 12;
  return `${String(h24).padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

function formatTimeLabel(hhmm: string): string {
  const { hour12, minute, period } = split24HourTime(hhmm);
  return `${hour12}:${minute} ${period}`;
}

function parseCronToUi(rawCron: string): { preset: SchedulePreset; time: string } {
  const clean = (rawCron || '').trim().replace(/\s+/g, ' ');
  const parts = clean.split(' ');
  const isKarachi = parts[0] === 'CRON_TZ=Asia/Karachi';
  const fields = parts[0]?.startsWith('CRON_TZ=') ? parts.slice(1) : parts;

  if (fields.length === 5 && fields[2] === '*' && fields[3] === '*' && fields[4] === '*') {
    const [min, hour] = fields;
    if (min === '0' && hour === '*') return { preset: 'hourly', time: '09:00' };
    if (min === '0' && hour === '*/3') return { preset: '3h', time: '09:00' };
    if (min === '0' && hour === '*/6') return { preset: '6h', time: '09:00' };
    if (min === '0' && hour === '*/12') return { preset: '12h', time: '09:00' };

    if (/^\d{1,2}$/.test(min) && /^\d{1,2}$/.test(hour)) {
      const m = Number(min);
      const h = Number(hour);
      if (m >= 0 && m <= 59 && h >= 0 && h <= 23) {
        const totalMins = isKarachi ? h * 60 + m : (h * 60 + m + 300) % 1440;
        const pktH = String(Math.floor(totalMins / 60)).padStart(2, '0');
        const pktM = String(totalMins % 60).padStart(2, '0');
        return { preset: 'daily', time: `${pktH}:${pktM}` };
      }
    }
  }

  return { preset: 'custom', time: '09:00' };
}

function buildCronFromUi(
  preset: SchedulePreset,
  time: string,
  customCron: string,
  useKarachiTz: boolean
): string {
  if (preset === 'hourly') return '0 * * * *';
  if (preset === '3h') return '0 */3 * * *';
  if (preset === '6h') return '0 */6 * * *';
  if (preset === '12h') return '0 */12 * * *';
  if (preset === 'custom') return customCron.trim() || '0 4 * * *';

  const [rawH, rawM] = (time || '09:00').split(':').map(Number);
  const pktH = Number.isFinite(rawH) ? rawH : 9;
  const pktM = Number.isFinite(rawM) ? rawM : 0;

  if (useKarachiTz) {
    return `CRON_TZ=Asia/Karachi ${pktM} ${pktH} * * *`;
  }
  const utcMins = (pktH * 60 + pktM - 300 + 1440) % 1440;
  return `${utcMins % 60} ${Math.floor(utcMins / 60)} * * *`;
}

export default function Home() {
  const [trackingId, setTrackingId] = useState('');
  const [activeTrackTarget, setActiveTrackTarget] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Active view: 'search' | 'result' | 'daily' | 'settings'
  const [view, setView] = useState<ActiveView>('search');

  // Daily tracking list
  const [trackedParcels, setTrackedParcels] = useState<TrackedItem[]>([]);
  const [isServerDiscordSet, setIsServerDiscordSet] = useState(false);

  const censorId = (id: string) => {
    if (id.length <= 4) return '••••';
    return `${id.slice(0, 2)}••••••${id.slice(-2)}`;
  };

  // Settings state (Schedule, Webhook, & Passcode)
  const [passcode, setPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [schedule, setSchedule] = useState('0 4 * * *');
  const [schedulePreset, setSchedulePreset] = useState<SchedulePreset>('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleMenuOpen, setScheduleMenuOpen] = useState(false);
  const [timeMenuOpen, setTimeMenuOpen] = useState(false);
  const scheduleContainerRef = useRef<HTMLDivElement | null>(null);
  const [qstashConfigured, setQstashConfigured] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Passcode modal state for Add & Delete actions
  const [authModal, setAuthModal] = useState<{
    isOpen: boolean;
    action: 'add' | 'remove';
    targetId?: string;
    targetAlias?: string;
    targetLabel?: string;
  }>({
    isOpen: false,
    action: 'add'
  });
  const [modalPasscode, setModalPasscode] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const [addFeedback, setAddFeedback] = useState<string | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);

  // Close custom schedule popovers when clicking outside or leaving settings
  useEffect(() => {
    if (view !== 'settings') {
      setScheduleMenuOpen(false);
      setTimeMenuOpen(false);
      return;
    }

    const handlePointerDown = (e: MouseEvent) => {
      if (
        scheduleContainerRef.current &&
        !scheduleContainerRef.current.contains(e.target as Node)
      ) {
        setScheduleMenuOpen(false);
        setTimeMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [view]);

  // Disable right-click and common developer tool hotkeys to discourage casual inspection
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // F12
      if (e.key === 'F12') {
        e.preventDefault();
      }
      // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C / Ctrl+U
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'u' ||
          e.key === 'U' ||
          (e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')))
      ) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleVerifyPasscode = async (candidate: string) => {
    setPasscode(candidate);
    if (!candidate.trim()) {
      setIsUnlocked(false);
      return;
    }
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: candidate.trim() })
      });
      if (res.ok) {
        setIsUnlocked(true);
        setSettingsFeedback('Passcode verified.');
      } else {
        setIsUnlocked(false);
        if (res.status === 503) {
          const errData = await res.json().catch(() => ({}));
          setSettingsFeedback(errData.error || 'SETTINGS_PASSCODE not configured on server.');
        }
      }
    } catch {
      setIsUnlocked(false);
    }
  };

  // Load initial data
  useEffect(() => {
    const savedWebhook = localStorage.getItem('pakpost_discord_webhook');
    if (savedWebhook) {
      setWebhookUrl(savedWebhook);
    }
    const savedSchedule = localStorage.getItem('pakpost_schedule');
    if (savedSchedule) {
      setSchedule(savedSchedule);
      const parsedLocal = parseCronToUi(savedSchedule);
      setSchedulePreset(parsedLocal.preset);
      setScheduleTime(parsedLocal.time);
    }

    fetch('/api/parcels')
      .then((r) => r.json())
      .then((data) => {
        setIsServerDiscordSet(Boolean(data.hasDiscord));
        setQstashConfigured(Boolean(data.qstashConfigured));
        if (data.schedule) {
          setSchedule(data.schedule);
          const parsedServer = parseCronToUi(data.schedule);
          setSchedulePreset(parsedServer.preset);
          setScheduleTime(parsedServer.time);
          localStorage.setItem('pakpost_schedule', data.schedule);
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

  const handleTrack = async (idToTrack?: string, aliasToTrack?: string) => {
    const targetId = (idToTrack || trackingId).trim().toUpperCase();
    if (!targetId && !aliasToTrack) return;

    setActiveTrackTarget(targetId || 'TRACKED PARCEL');
    setLoading(true);
    setError(null);
    setResult(null);
    setAddFeedback(null);

    // Blur away search card and unblur result card into view
    setView('result');

    try {
      const endpoint = aliasToTrack
        ? `/api/track?alias=${encodeURIComponent(aliasToTrack)}`
        : `/api/track?id=${encodeURIComponent(targetId)}`;
      const res = await fetch(endpoint);
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
    if (!idToCheck) return false;
    const clean = idToCheck.toUpperCase();
    return trackedParcels.some(
      (p) => p.id.toUpperCase() === clean || (p.alias && p.alias === clean)
    );
  };

  const handleOpenAddAuth = () => {
    if (!result) return;
    const cleanId = activeTrackTarget || result.trackingNo.toUpperCase();
    if (isAlreadyTracked(cleanId)) return;

    setModalPasscode('');
    setModalError(null);
    setAuthModal({
      isOpen: true,
      action: 'add',
      targetId: cleanId,
      targetLabel: result.label
    });
  };

  const handleOpenDeleteAuth = (parcel: TrackedItem) => {
    setModalPasscode('');
    setModalError(null);
    setAuthModal({
      isOpen: true,
      action: 'remove',
      targetId: parcel.id,
      targetAlias: parcel.alias,
      targetLabel: parcel.label
    });
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalPasscode.trim()) {
      setModalError('Passcode is required.');
      return;
    }

    setModalLoading(true);
    setModalError(null);

    try {
      if (authModal.action === 'add') {
        const res = await fetch('/api/parcels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            id: authModal.targetId,
            label: authModal.targetLabel,
            passcode: modalPasscode.trim()
          })
        });

        const data = await res.json();
        if (!res.ok) {
          setModalError(data.error || 'Incorrect passcode. Access denied.');
          return;
        }

        // Successfully authorized & added
        setPasscode(modalPasscode.trim());
        setIsUnlocked(true);
        if (data.parcels && Array.isArray(data.parcels)) {
          setTrackedParcels(data.parcels);
          localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(data.parcels));
        }

        setAuthModal({ isOpen: false, action: 'add' });
        setAddFeedback('Added successfully');
      } else if (authModal.action === 'remove') {
        const res = await fetch('/api/parcels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'remove',
            alias: authModal.targetAlias || authModal.targetId,
            passcode: modalPasscode.trim()
          })
        });

        const data = await res.json();
        if (!res.ok) {
          setModalError(data.error || 'Incorrect passcode. Access denied.');
          return;
        }

        // Successfully authorized & removed
        setPasscode(modalPasscode.trim());
        setIsUnlocked(true);
        if (data.parcels && Array.isArray(data.parcels)) {
          setTrackedParcels(data.parcels);
          localStorage.setItem('pakpost_tracked_parcels', JSON.stringify(data.parcels));
        }

        setAuthModal({ isOpen: false, action: 'remove' });
        setDeleteFeedback('Parcel removed from daily tracking');
        setTimeout(() => {
          setDeleteFeedback(null);
        }, 4000);
      }
    } catch {
      setModalError('Connection failed. Please check network.');
    } finally {
      setModalLoading(false);
    }
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
      const cleanSchedule = buildCronFromUi(
        schedulePreset,
        scheduleTime,
        schedule,
        qstashConfigured
      );
      setSchedule(cleanSchedule);

      if (cleanWebhook) {
        localStorage.setItem('pakpost_discord_webhook', cleanWebhook);
      } else {
        localStorage.removeItem('pakpost_discord_webhook');
      }
      localStorage.setItem('pakpost_schedule', cleanSchedule);

      const cleanNewPasscode = newPasscode.trim();
      const res = await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settings',
          passcode,
          newPasscode: cleanNewPasscode || undefined,
          webhookUrl: cleanWebhook,
          schedule: cleanSchedule
        })
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.passcodeUpdated && cleanNewPasscode) {
          setPasscode(cleanNewPasscode);
          setNewPasscode('');
        }
        setSettingsFeedback(data.message || 'Settings saved.');
      } else {
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
                <span className="font-mono text-lg font-bold text-white tracking-wider">
                  {isAlreadyTracked(result ? result.trackingNo : (activeTrackTarget || trackingId))
                    ? censorId(result ? result.trackingNo : (activeTrackTarget || trackingId))
                    : (result ? result.trackingNo : (activeTrackTarget || trackingId))}
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
                <span>Tracking across global carriers & Pakistan Post...</span>
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
                  {result.upstreamCarrier && (
                    <div className="flex">
                      <span className="w-24 text-white/50 uppercase">Network:</span>
                      <span className="text-white/90">
                        {result.upstreamCarrier}
                        {result.handoffStatus === 'HANDED_OFF_DOMESTIC'
                          ? ' → Pakistan Post'
                          : ' (Origin / International)'}
                      </span>
                    </div>
                  )}
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
                        href={
                          isAlreadyTracked(result.trackingNo)
                            ? 'https://ep.gov.pk/emtts/'
                            : `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(result.trackingNo)}`
                        }
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
                          <div className="text-white/70 text-[11px] flex items-center justify-between gap-2">
                            <span>
                              {ev.location} • {ev.date} {ev.time && `(${ev.time})`}
                            </span>
                            {ev.carrier && (
                              <span className="text-[10px] font-mono text-white/40 uppercase whitespace-nowrap">
                                [{ev.carrier.split(' ')[0]}]
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t border-white/15">
                  {addFeedback ? (
                    <div className="w-full py-2.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono uppercase tracking-wider font-bold rounded-xl text-center flex items-center justify-center gap-2 shadow-md">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>Added successfully</span>
                    </div>
                  ) : isAlreadyTracked(result.trackingNo) ? (
                    <div className="w-full py-2 bg-white/5 border border-white/10 text-white/50 text-[11px] font-mono uppercase tracking-wider rounded-xl text-center flex items-center justify-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>In Daily Tracking</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={handleOpenAddAuth}
                      className="w-full py-2.5 bg-white/90 hover:bg-white text-black text-xs font-mono uppercase tracking-wider font-bold rounded-xl transition shadow-md flex items-center justify-center gap-1.5"
                    >
                      + Add to Daily Tracking
                    </button>
                  )}
                </div>
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

            {deleteFeedback && (
              <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono rounded-xl flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>{deleteFeedback}</span>
              </div>
            )}

            {trackedParcels.length === 0 ? (
              <div className="text-xs font-mono text-white/60 py-6 text-center">
                No parcels in daily tracking.
              </div>
            ) : (
              <div className="divide-y divide-white/15 border-y border-white/15">
                {trackedParcels.map((parcel) => (
                  <div
                    key={parcel.alias || parcel.id}
                    className="py-3 flex items-center justify-between gap-4 text-xs font-mono"
                  >
                    <div
                      onClick={() => {
                        handleTrack(parcel.id, parcel.alias);
                      }}
                      className="cursor-pointer hover:underline"
                    >
                      <span className="font-bold text-white tracking-wider">
                        {censorId(parcel.id)}
                      </span>
                      {parcel.label && (
                        <span className="ml-2 text-white/70">({parcel.label})</span>
                      )}
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          handleTrack(parcel.id, parcel.alias);
                        }}
                        className="text-white/80 hover:text-white underline text-[11px]"
                      >
                        Track
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenDeleteAuth(parcel)}
                        className="text-white/60 hover:text-red-400 transition"
                        title="Delete from daily tracking"
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
                onChange={(e) => handleVerifyPasscode(e.target.value)}
                placeholder="Enter passcode..."
                className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 transition"
              />
            </div>

            {/* Change Schedule */}
            <div ref={scheduleContainerRef} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="schedulePreset"
                  className="block text-xs font-mono uppercase tracking-wider text-white/80"
                >
                  Check Schedule
                </label>
                <span className="text-[10px] font-mono text-white/50 uppercase">
                  {qstashConfigured ? 'QStash Live' : 'Static vercel.json'}
                </span>
              </div>

              <div className="flex items-center gap-2 relative">
                {/* Custom Interval Dropdown */}
                <div className="relative flex-1">
                  <button
                    id="schedulePreset"
                    type="button"
                    disabled={!isUnlocked}
                    onClick={() => {
                      setTimeMenuOpen(false);
                      setScheduleMenuOpen((prev) => !prev);
                    }}
                    className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white flex items-center justify-between gap-3 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <span className="truncate">
                      {SCHEDULE_OPTIONS.find((opt) => opt.value === schedulePreset)?.label ||
                        'Daily (PKT)'}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-white/60 shrink-0 transition-transform duration-200 ${
                        scheduleMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {scheduleMenuOpen && isUnlocked && (
                    <div className="absolute left-0 right-0 mt-1.5 z-50 bg-zinc-950/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] py-1 overflow-hidden">
                      {SCHEDULE_OPTIONS.map((opt) => {
                        const selected = opt.value === schedulePreset;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              setSchedulePreset(opt.value);
                              setSchedule(
                                buildCronFromUi(opt.value, scheduleTime, schedule, qstashConfigured)
                              );
                              setScheduleMenuOpen(false);
                            }}
                            className={`w-full px-3.5 py-2 text-left text-xs font-mono flex items-center justify-between transition ${
                              selected
                                ? 'bg-white/15 text-white font-semibold'
                                : 'text-white/75 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <span>{opt.label}</span>
                            {selected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Custom Time Selector (PKT) */}
                {schedulePreset === 'daily' && (() => {
                  const { hour12, minute, period } = split24HourTime(scheduleTime);
                  const updateTimePart = (
                    nextH: string,
                    nextM: string,
                    nextP: 'AM' | 'PM'
                  ) => {
                    const next24 = join24HourTime(nextH, nextM, nextP);
                    setScheduleTime(next24);
                    setSchedule(
                      buildCronFromUi('daily', next24, schedule, qstashConfigured)
                    );
                  };

                  return (
                    <div className="relative">
                      <button
                        id="scheduleTime"
                        type="button"
                        aria-label="Daily check time (PKT)"
                        disabled={!isUnlocked}
                        onClick={() => {
                          setScheduleMenuOpen(false);
                          setTimeMenuOpen((prev) => !prev);
                        }}
                        className="w-36 px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white flex items-center justify-between gap-2 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        <span>{formatTimeLabel(scheduleTime)}</span>
                        <Clock className="w-3.5 h-3.5 text-white/60 shrink-0" />
                      </button>

                      {timeMenuOpen && isUnlocked && (
                        <div className="absolute right-0 mt-1.5 z-50 w-52 bg-zinc-950/95 backdrop-blur-xl border border-white/20 rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.85)] p-2">
                          <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
                            {/* Hours */}
                            <div className="max-h-36 overflow-y-auto space-y-0.5 pr-0.5">
                              {HOURS_12.map((h) => (
                                <button
                                  key={h}
                                  type="button"
                                  onClick={() => updateTimePart(h, minute, period)}
                                  className={`w-full py-1.5 rounded-lg text-center transition ${
                                    hour12 === h
                                      ? 'bg-white/90 text-black font-bold'
                                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  {h}
                                </button>
                              ))}
                            </div>

                            {/* Minutes */}
                            <div className="max-h-36 overflow-y-auto space-y-0.5 border-x border-white/10 px-1">
                              {MINUTES_5.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  onClick={() => updateTimePart(hour12, m, period)}
                                  className={`w-full py-1.5 rounded-lg text-center transition ${
                                    minute === m
                                      ? 'bg-white/90 text-black font-bold'
                                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  {m}
                                </button>
                              ))}
                            </div>

                            {/* AM / PM */}
                            <div className="space-y-1 flex flex-col justify-start">
                              {(['AM', 'PM'] as const).map((p) => (
                                <button
                                  key={p}
                                  type="button"
                                  onClick={() => updateTimePart(hour12, minute, p)}
                                  className={`w-full py-1.5 rounded-lg text-center transition ${
                                    period === p
                                      ? 'bg-white/90 text-black font-bold'
                                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                                  }`}
                                >
                                  {p}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {schedulePreset === 'custom' && (
                <input
                  id="schedule"
                  type="text"
                  disabled={!isUnlocked}
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                  placeholder="0 4 * * * or CRON_TZ=Asia/Karachi 0 9 * * *"
                  className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                />
              )}
            </div>

            {/* Change Webhook (Discord, Slack, or JSON) */}
            <div className="space-y-1.5">
              <label
                htmlFor="webhook"
                className="block text-xs font-mono uppercase tracking-wider text-white/80"
              >
                Webhook URL
              </label>
              <input
                id="webhook"
                type="url"
                disabled={!isUnlocked}
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="Discord, Slack, or JSON webhook URL..."
                className="w-full px-3.5 py-2 text-xs font-mono bg-black/40 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-white/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
              />
            </div>

            {/* Change Owner Passcode */}
            <div className="space-y-1.5">
              <label
                htmlFor="newPasscode"
                className="block text-xs font-mono uppercase tracking-wider text-white/80"
              >
                New Passcode (Optional)
              </label>
              <input
                id="newPasscode"
                type="password"
                disabled={!isUnlocked}
                value={newPasscode}
                onChange={(e) => setNewPasscode(e.target.value)}
                placeholder="Leave blank to keep current..."
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

      {/* 5. Passcode Authorization Modal */}
      {authModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="bg-zinc-950/95 border border-white/20 shadow-[0_24px_60px_rgba(0,0,0,0.9)] rounded-2xl p-6 w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-white/15 pb-3">
              <div className="flex items-center gap-2 text-white font-mono text-xs uppercase tracking-wider font-bold">
                {authModal.action === 'remove' ? (
                  <Trash2 className="w-4 h-4 text-red-400" />
                ) : (
                  <Lock className="w-4 h-4 text-emerald-400" />
                )}
                <span>
                  {authModal.action === 'remove'
                    ? 'Confirm Deletion'
                    : 'Authorize Addition'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAuthModal({ ...authModal, isOpen: false })}
                className="text-white/50 hover:text-white transition p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs font-mono text-white/70">
              {authModal.action === 'remove'
                ? `Enter passcode to delete ${authModal.targetId ? censorId(authModal.targetId) : 'parcel'} from daily tracking:`
                : 'Enter passcode to add this parcel to daily tracking:'}
            </p>

            <form onSubmit={handleAuthSubmit} className="space-y-3">
              <div>
                <input
                  type="password"
                  autoFocus
                  value={modalPasscode}
                  onChange={(e) => {
                    setModalPasscode(e.target.value);
                    setModalError(null);
                  }}
                  placeholder="Enter passcode..."
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-black/60 border border-white/25 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/50 transition"
                />
              </div>

              {modalError && (
                <div className="p-2.5 bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-mono rounded-xl">
                  {modalError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAuthModal({ ...authModal, isOpen: false })}
                  className="px-3.5 py-2 text-xs font-mono text-white/70 hover:text-white rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalLoading || !modalPasscode.trim()}
                  className={`px-4 py-2 text-xs font-mono uppercase tracking-wider font-bold rounded-xl transition shadow-md flex items-center gap-1.5 disabled:opacity-50 ${
                    authModal.action === 'remove'
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-white hover:bg-white/90 text-black'
                  }`}
                >
                  {modalLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : authModal.action === 'remove' ? (
                    <Trash2 className="w-3.5 h-3.5" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {modalLoading
                      ? 'Verifying...'
                      : authModal.action === 'remove'
                        ? 'Delete'
                        : 'Confirm'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
