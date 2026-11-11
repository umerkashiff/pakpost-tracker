'use client';

import { useState, useEffect } from 'react';
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Send,
  Bell,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  Globe,
  Calendar,
  ShieldCheck,
  MapPin,
  HelpCircle,
  Copy,
  Check
} from 'lucide-react';
import { TrackingResult, StatusCategory } from '@/lib/types';

interface ConfigInfo {
  parcels: Array<{ id: string; label?: string }>;
  hasDiscord: boolean;
  hasCronSecret: boolean;
  schedule: string;
}

export default function Home() {
  const [searchId, setSearchId] = useState('LT880952265NL');
  const [searchLabel, setSearchLabel] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<TrackingResult | null>(null);

  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [cronLoading, setCronLoading] = useState(false);
  const [cronFeedback, setCronFeedback] = useState<string | null>(null);

  const [testWebhookLoading, setTestWebhookLoading] = useState(false);
  const [testWebhookFeedback, setTestWebhookFeedback] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  // Fetch initial config and run default search for the sample parcel
  useEffect(() => {
    fetch('/api/parcels')
      .then((res) => res.json())
      .then((data) => setConfig(data))
      .catch((err) => console.error('Failed to load config:', err));

    // Auto-load sample tracking ID
    handleTrack('LT880952265NL', 'Netherlands Shipment');
  }, []);

  const handleTrack = async (idToTrack?: string, customLabel?: string) => {
    const targetId = (idToTrack || searchId).trim().toUpperCase();
    if (!targetId) return;

    setSearchLoading(true);
    setSearchResult(null);

    try {
      const labelParam = customLabel || searchLabel;
      const res = await fetch(
        `/api/track?id=${encodeURIComponent(targetId)}${labelParam ? `&label=${encodeURIComponent(labelParam)}` : ''}`
      );
      const data = await res.json();
      setSearchResult(data);
    } catch (err) {
      console.error('Tracking query failed:', err);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleTriggerCron = async () => {
    setCronLoading(true);
    setCronFeedback(null);
    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      if (res.ok) {
        setCronFeedback(
          `Success! Checked ${data.totalParcels} parcel(s) and sent updates to Discord.`
        );
      } else {
        setCronFeedback(`Error: ${data.error || 'Failed to execute check'}`);
      }
    } catch (err) {
      setCronFeedback('Error: Failed to connect to cron endpoint');
    } finally {
      setCronLoading(false);
    }
  };

  const handleSendTestWebhook = async () => {
    setTestWebhookLoading(true);
    setTestWebhookFeedback(null);
    try {
      const res = await fetch('/api/notify-test', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setTestWebhookFeedback('Discord test notification sent successfully! Check your channel.');
      } else {
        setTestWebhookFeedback(`Error: ${data.error || 'Failed to send'}`);
      }
    } catch (err) {
      setTestWebhookFeedback('Error: Could not trigger test webhook');
    } finally {
      setTestWebhookLoading(false);
    }
  };

  const getStatusBadge = (category: StatusCategory) => {
    switch (category) {
      case 'DELIVERED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5" /> Delivered
          </span>
        );
      case 'IN_TRANSIT':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
            <Truck className="w-3.5 h-3.5 animate-pulse" /> In Transit
          </span>
        );
      case 'BOOKED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            <Package className="w-3.5 h-3.5" /> Booked / Processing
          </span>
        );
      case 'ATTEMPT_FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border border-red-300 dark:border-red-800">
            <AlertTriangle className="w-3.5 h-3.5" /> Attempt Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
            <Clock className="w-3.5 h-3.5" /> Awaiting Scan
          </span>
        );
    }
  };

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 pb-16">
      {/* Top Navigation Banner */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 sticky top-0 z-30 shadow-xs">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black shadow-md">
              🇵🇰
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight leading-tight flex items-center gap-2">
                Pakistan Post Auto Tracker
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  Vercel Serverless
                </span>
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Official EMTTS (ep.gov.pk) Direct Gateway • 24/7 Automated Discord Alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSendTestWebhook}
              disabled={testWebhookLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 transition"
              title="Send a sample notification to your Discord webhook"
            >
              <Bell className="w-3.5 h-3.5 text-emerald-500" />
              {testWebhookLoading ? 'Sending...' : 'Test Discord Webhook'}
            </button>

            <button
              onClick={handleTriggerCron}
              disabled={cronLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition"
              title="Run daily check for all parcels and dispatch to Discord"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cronLoading ? 'animate-spin' : ''}`} />
              {cronLoading ? 'Checking...' : 'Run Daily Check Now'}
            </button>
          </div>
        </div>
      </header>

      {/* Status Bar */}
      <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-4 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between text-xs text-emerald-900 dark:text-emerald-300 gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <strong>Discord Bot:</strong> Connected
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              <strong>Automated Schedule:</strong> Daily at 09:00 AM PKT (04:00 UTC)
            </span>
          </div>
          <div>
            <span className="text-zinc-500 dark:text-zinc-400">Zero laptop requirement • 100% Cloud</span>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 pt-8 space-y-8">
        {/* Feedback alerts */}
        {cronFeedback && (
          <div className="p-4 rounded-xl text-sm bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between">
            <span>{cronFeedback}</span>
            <button
              onClick={() => setCronFeedback(null)}
              className="text-xs font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {testWebhookFeedback && (
          <div className="p-4 rounded-xl text-sm bg-blue-100 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-800 flex items-center justify-between">
            <span>{testWebhookFeedback}</span>
            <button
              onClick={() => setTestWebhookFeedback(null)}
              className="text-xs font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Search / Live Query Box */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold mb-1 flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600" />
              Query Pakistan Post EMTTS Live
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
              Enter any Pakistan Post tracking ID (e.g., LT880952265NL, EP123456789PK, UMS or International) to view real-time status.
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleTrack();
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <div className="flex-1 relative">
              <input
                type="text"
                value={searchId}
                onChange={(e) => setSearchId(e.target.value.toUpperCase())}
                placeholder="Enter Tracking ID (e.g. LT880952265NL)"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>
            <div className="w-full sm:w-64">
              <input
                type="text"
                value={searchLabel}
                onChange={(e) => setSearchLabel(e.target.value)}
                placeholder="Label / Note (optional)"
                className="w-full px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={searchLoading}
              className="px-6 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 font-semibold text-sm transition flex items-center justify-center gap-2 shadow-sm"
            >
              {searchLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Querying...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" /> Track Now
                </>
              )}
            </button>
          </form>

          {/* Quick presets */}
          <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
            <span>Quick test:</span>
            <button
              type="button"
              onClick={() => {
                setSearchId('LT880952265NL');
                setSearchLabel('Netherlands Shipment');
                handleTrack('LT880952265NL', 'Netherlands Shipment');
              }}
              className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-mono text-[11px]"
            >
              LT880952265NL (Your parcel)
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchId('EP123456789PK');
                setSearchLabel('Islamabad Express');
                handleTrack('EP123456789PK', 'Islamabad Express');
              }}
              className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 font-mono text-[11px]"
            >
              EP123456789PK (Domestic)
            </button>
          </div>
        </div>

        {/* Live Result Details */}
        {searchResult && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden shadow-xs">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xl font-bold tracking-tight">
                    {searchResult.trackingNo}
                  </span>
                  {searchResult.label && (
                    <span className="text-xs px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 font-medium text-zinc-600 dark:text-zinc-400">
                      {searchResult.label}
                    </span>
                  )}
                  {getStatusBadge(searchResult.statusCategory)}
                </div>
                <div className="mt-1 flex items-center gap-4 text-xs text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" />
                    Route: <strong>{searchResult.origin}</strong> ➔ <strong>{searchResult.destination}</strong>
                  </span>
                  <span>•</span>
                  <span>Total Checkpoints: {searchResult.totalEvents}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${encodeURIComponent(searchResult.trackingNo)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-xs font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open in ep.gov.pk
                </a>
              </div>
            </div>

            {/* Latest status highlight card */}
            {searchResult.latestEvent && (
              <div className="p-6 bg-gradient-to-r from-emerald-500/10 via-transparent to-blue-500/10 border-b border-zinc-200 dark:border-zinc-800">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                  Current Status
                </div>
                <div className="text-lg font-bold text-zinc-900 dark:text-white">
                  {searchResult.latestEvent.status}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-500" />
                    {searchResult.latestEvent.location}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-blue-500" />
                    {searchResult.latestEvent.date} {searchResult.latestEvent.time && `at ${searchResult.latestEvent.time}`}
                  </span>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="p-6">
              <h3 className="text-sm font-semibold mb-4 text-zinc-700 dark:text-zinc-300">
                Checkpoint History ({searchResult.events.length})
              </h3>

              {searchResult.events.length === 0 ? (
                <div className="text-center py-8 text-sm text-zinc-500">
                  No checkpoint scans recorded yet by Pakistan Post EMTTS for this tracking ID.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-200 dark:before:bg-zinc-800">
                  {[...searchResult.events].reverse().map((ev, index) => (
                    <div key={index} className="relative group">
                      <div
                        className={`absolute -left-6 top-1.5 w-4 h-4 rounded-full border-2 border-white dark:border-zinc-900 ${
                          index === 0 ? 'bg-emerald-500 ring-4 ring-emerald-500/20' : 'bg-zinc-400 dark:bg-zinc-600'
                        }`}
                      ></div>
                      <div className="bg-zinc-50 dark:bg-zinc-800/60 rounded-xl p-4 border border-zinc-200/70 dark:border-zinc-800">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                            {ev.status}
                          </span>
                          <span className="text-xs text-zinc-500 font-mono">
                            {ev.date} {ev.time && `• ${ev.time}`}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-zinc-400" />
                          {ev.location}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Configured Parcels Grid */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-base font-semibold">Parcels on Daily Schedule</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                These parcels are checked automatically by Vercel Cron every day at 09:00 AM PKT and posted to Discord.
              </p>
            </div>
            <div className="text-xs font-mono bg-zinc-100 dark:bg-zinc-800 px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-300">
              Source: parcels.json / TRACKING_IDS env
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {config?.parcels && config.parcels.length > 0 ? (
              config.parcels.map((parcel, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-850 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                      <Package className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-mono font-bold text-sm">{parcel.id}</div>
                      <div className="text-xs text-zinc-500">{parcel.label || 'No label'}</div>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSearchId(parcel.id);
                      setSearchLabel(parcel.label || '');
                      handleTrack(parcel.id, parcel.label);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-750 transition"
                  >
                    View Status
                  </button>
                </div>
              ))
            ) : (
              <div className="col-span-2 text-center py-6 text-xs text-zinc-500">
                No parcels configured yet. Add them to parcels.json or the TRACKING_IDS environment variable.
              </div>
            )}
          </div>
        </div>

        {/* 2-Minute Vercel Cloud Hosting Guide */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 shadow-xs">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-semibold">How to Host on Vercel (No Laptop Needed)</h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-6">
            Once deployed to Vercel, this serverless app runs 24/7 in the cloud. Vercel Cron automatically triggers the daily tracking check and sends the results to your Discord channel.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40">
              <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-2">
                1
              </div>
              <h3 className="font-semibold text-sm mb-1">Push to GitHub</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                Push this project to your repository:
              </p>
              <div className="mt-2 p-2 bg-zinc-900 text-zinc-100 rounded-md font-mono text-[11px] overflow-x-auto">
                git push -u origin main
              </div>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40">
              <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-2">
                2
              </div>
              <h3 className="font-semibold text-sm mb-1">Import into Vercel</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                Go to <span className="font-medium text-emerald-600">vercel.com/new</span>, select your repo <span className="font-mono">umerkashiff/pakpost-tracker</span>, and click Deploy.
              </p>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40">
              <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center mb-2">
                3
              </div>
              <h3 className="font-semibold text-sm mb-1">Set Environment Variables</h3>
              <p className="text-zinc-500 dark:text-zinc-400">
                In Vercel Project Settings &gt; Environment Variables, add:
              </p>
              <div className="mt-2 p-2 bg-zinc-900 text-zinc-100 rounded-md font-mono text-[10px] space-y-1">
                <div>DISCORD_WEBHOOK_URL=...</div>
                <div>TRACKING_IDS=LT880952265NL:Netherlands</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
