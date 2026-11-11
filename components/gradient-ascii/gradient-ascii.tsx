// Copyright (c) 2026 Bruno Delorence. MIT License.

'use client';

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { Panel } from './panel';
import { DEFAULTS, presetOf, type GradientSettings, type Shape } from './presets';
import { createRenderer, type Renderer } from './renderer';
import { useAutoplay } from './use-autoplay';
import styles from './gradient-ascii.module.css';

export { CHARACTER_SETS, PRESETS, DEFAULTS } from './presets';
export type { ClickEffect, GradientSettings, Shape } from './presets';

/*
 * Gradient ASCII: a soft glow of light drawn in characters, as a background. Under it lies a
 * smooth gradient; over it, a grid of monospaced characters picks denser glyphs where the light
 * is brighter. The light drifts and wavers; the pointer scrambles the characters it passes, and a
 * click sends a ring of scrambled characters out (or bursts a patch).
 *
 * - The picture is one WebGL shader (renderer.ts): the light per pixel, a character per cell, the
 *   glyphs from an atlas drawn at the canvas's device pixels, the scramble as a small texture.
 * - The demo stage carries a Customize panel (panel.tsx) with every setting: the colours, a
 *   preset (palette, shape, characters and cell size together), the shape, the characters, the
 *   click effect, fourteen scrubbers and three switches. Props set the starting values; the
 *   panel changes them from there, and Reset goes back to the props.
 * - It draws only while on screen and the tab is visible. A pause button beside Replay holds the
 *   picture where it is. Under reduced motion it draws one still frame: the light fully in,
 *   nothing drifting, nothing scrambling, and no pause button, as nothing moves.
 * - While on screen and untouched, a demo pointer wanders through the light, scrambling as it
 *   goes, and clicks now and then. The reader’s first real input stops it for good.
 * - Without WebGL the stage shows a still CSS gradient made from the colours and the shape.
 * - Light or dark: the stage and the panel take light-dark() tokens; on a light stage the light
 *   is drawn as a wash with darker characters (Light Mode), unless the lightMode prop says
 *   otherwise.
 */

type Settable = Omit<GradientSettings, 'lightMode'> & { lightMode: boolean | undefined };

export type GradientAsciiProps = Partial<Settable> & {
  className?: string;
  /**
   * While on screen and untouched, a demo pointer scrambles the characters and clicks. It stops
   * for good at the reader’s first input.
   */
  autoplay?: boolean;
  colorScheme?: 'light' | 'dark' | 'system';
  /** Shows the Customize panel under the stage. Turn it off to use it as a background. */
  controls?: boolean;
  /**
   * Hides the picture from assistive technology, for a background that carries no meaning.
   * Otherwise the stage is an image with a short description.
   */
  decorative?: boolean;
  /** The level of the Customize panel’s heading, to fit the page’s outline. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** The highest device pixel ratio it draws at (it never goes over 2). */
  dpr?: number;
  /** Called with every change made on the panel. */
  onSettingsChange?: (settings: GradientSettings) => void;
};

const SETTING_KEYS = Object.keys(DEFAULTS) as (keyof GradientSettings)[];

/** Where the demo pointer roams for each shape, as shares of the stage: centre and reach. */
const ROAM: Record<Shape, { x: number; y: number; rx: number; ry: number }> = {
  horizon: { x: 0.5, y: 0.3, rx: 0.34, ry: 0.15 },
  pinch: { x: 0.5, y: 0.5, rx: 0.36, ry: 0.1 },
  rise: { x: 0.5, y: 0.8, rx: 0.3, ry: 0.1 },
  eclipse: { x: 0.5, y: 0.5, rx: 0.26, ry: 0.32 },
};
/** The demo clicks every CLICK_EVERY ms. */
const CLICK_EVERY = 4200;

/** Where the light sits for each shape, for the still gradient shown without WebGL. */
const FALLBACK_AT: Record<Shape, string> = {
  horizon: '120% 75% at 50% 0%',
  pinch: '90% 40% at 50% 50%',
  rise: '120% 75% at 50% 100%',
  eclipse: '60% 70% at 50% 50%',
};

/**
 * A still CSS gradient from the settings: the light’s colours from its heart out, then the first
 * colour (the edge of the shadow), then nothing.
 */
export function fallbackOf({ colors, shape }: GradientSettings) {
  const [edge, ...rest] = colors;
  // On a horizon the colours run from the sun out; on the other shapes from the outskirts in.
  const light = shape === 'horizon' ? rest : [...rest].reverse();
  const stops = [...light, edge].map(
    (color, i, all) => `${color} ${Math.round((i / Math.max(1, all.length - 1)) * 55)}%`,
  );
  return `radial-gradient(${FALLBACK_AT[shape]}, ${stops.join(', ')}, transparent 75%)`;
}

/** The colour scheme the stage ends up with: from the prop, or the page's. */
function useLightScheme(probe: RefObject<HTMLSpanElement | null>, scheme?: string) {
  const [light, setLight] = useState(scheme !== 'dark');
  useEffect(() => {
    const read = () => {
      const element = probe.current;
      if (!element) return;
      // The probe's colour is light-dark(black, white): what it resolves to is the scheme.
      setLight(getComputedStyle(element).color.replace(/\s/g, '') === 'rgb(0,0,0)');
    };
    read();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', read);
    const observer = new MutationObserver(read);
    // A scheme set anywhere above (a class, a theme, a data-color-scheme) changes it.
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class', 'data-theme', 'data-color-scheme'],
    });
    return () => {
      media.removeEventListener('change', read);
      observer.disconnect();
    };
  }, [probe, scheme]);
  return light;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, []);
  return reduced;
}

export function GradientAscii({
  className,
  autoplay = true,
  colorScheme,
  controls = true,
  decorative = false,
  headingLevel = 2,
  dpr = 2,
  onSettingsChange,
  ...props
}: GradientAsciiProps) {
  const { ref: root, take, playing } = useAutoplay<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [overrides, setOverrides] = useState<Partial<GradientSettings>>({});
  const [announcement, setAnnouncement] = useState('');
  const light = useLightScheme(probe, colorScheme);
  const reduced = useReducedMotion();

  // The props as settings, the colour scheme choosing Light Mode unless lightMode is given.
  const propKey = JSON.stringify(SETTING_KEYS.map((key) => props[key]));
  const base = useMemo(() => {
    const given: Partial<GradientSettings> = {};
    for (const key of SETTING_KEYS) {
      const value = props[key];
      if (value !== undefined) (given as Record<string, unknown>)[key] = value;
    }
    return { ...DEFAULTS, lightMode: light, ...given } as GradientSettings;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propKey, light]);
  const settings = useMemo(() => ({ ...base, ...overrides }), [base, overrides]);

  const change = (patch: Partial<GradientSettings>) => {
    const next = { ...overrides, ...patch };
    setOverrides(next);
    const merged = { ...base, ...next };
    onSettingsChange?.(merged);
    if ('cellSize' in patch && 'shape' in patch) {
      const name = presetOf(merged);
      if (name) setAnnouncement(`Preset ${name}`);
    }
  };

  // The renderer lives as long as the canvas.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let made: Renderer | null = null;
    try {
      made = createRenderer(element);
    } catch {
      made = null;
    }
    if (!made) {
      setFailed(true);
      return;
    }
    renderer.current = made;
    // It draws only while some of it is on screen and the tab is visible.
    let onScreen = false;
    const update = () => made.active(onScreen && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
      made.destroy();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    renderer.current?.set(settings, reduced, dpr);
  }, [settings, reduced, dpr]);

  useEffect(() => {
    renderer.current?.pause(paused);
  }, [paused]);

  // The demo: a pointer roaming the light on the renderer's own clock, clicking now and then.
  const roam = useEffectEvent((now: number, start: number) => {
    const box = stage.current;
    const arrow = pointer.current;
    if (!box || !arrow) return;
    const seconds = (now - start) / 1000;
    const area = ROAM[settings.shape];
    const w = box.clientWidth;
    const h = box.clientHeight;
    const x = (area.x + area.rx * Math.sin(seconds * 0.47 + 0.4)) * w;
    const y = (area.y + area.ry * Math.sin(seconds * 0.83 + 1.1)) * h;
    arrow.style.transform = `translate(${x}px, ${y}px)`;
    renderer.current?.pointer(x, y);
    const beat = Math.floor((now - start) / CLICK_EVERY);
    if (beat > Number(arrow.dataset.beat ?? 0)) {
      arrow.dataset.beat = String(beat);
      arrow.dataset.pressed = 'true';
      renderer.current?.click(x, y);
      window.setTimeout(() => (arrow.dataset.pressed = 'false'), 180);
    }
  });
  const demo = autoplay && playing && !failed && !paused;
  useEffect(() => {
    const made = renderer.current;
    const arrow = pointer.current;
    if (!demo || !made || !arrow) return;
    const start = performance.now();
    arrow.dataset.beat = '0';
    arrow.style.opacity = '1';
    made.onTick((now) => roam(now, start));
    return () => {
      made.onTick(null);
      made.pointer(null);
      arrow.style.opacity = '0';
    };
  }, [demo]);

  const local = (event: ReactPointerEvent) => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div
      ref={root}
      className={`${styles.root} ${className ?? ''}`}
      data-color-scheme={colorScheme}
      onKeyDownCapture={take}
    >
      <span ref={probe} className={styles.probe} aria-hidden="true" />
      <div className={styles.frame} data-part="frame">
        <div
          ref={stage}
          className={styles.stage}
          data-part="stage"
          data-failed={failed}
          style={failed ? ({ '--fallback': fallbackOf(settings) } as CSSProperties) : undefined}
          role={decorative ? undefined : 'img'}
          aria-label={
            decorative ? undefined : `A soft ${settings.shape} of light drawn in characters`
          }
          aria-hidden={decorative || undefined}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse' || event.buttons) take();
            const { x, y } = local(event);
            renderer.current?.pointer(x, y);
          }}
          onPointerLeave={() => renderer.current?.pointer(null)}
          onPointerDown={(event) => {
            take();
            const { x, y } = local(event);
            renderer.current?.click(x, y);
          }}
        >
          <canvas ref={canvas} className={styles.canvas} aria-hidden="true" />
          <span className={styles.pointerLayer} aria-hidden="true">
            <span ref={pointer} className={styles.demoPointer}>
              <svg viewBox="0 0 20 20">
                <path
                  d="M3 2v14.5l3.6-3.3 2.6 5.6 2.4-1.1-2.6-5.5h5.2z"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        </div>
        {controls && !reduced && !failed && (
          <button
            type="button"
            className={`${styles.replay} ${styles.pause}`}
            aria-label={paused ? 'Play the animation' : 'Pause the animation'}
            data-part="pause"
            onClick={() => {
              take();
              setPaused(!paused);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {paused ? (
                <path d="M5 3.2v9.6l7.6-4.8z" fill="currentColor" />
              ) : (
                <path
                  d="M5.5 3.5v9M10.5 3.5v9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        )}
        {controls && (
          <button
            type="button"
            className={styles.replay}
            aria-label="Replay the intro"
            data-part="replay"
            onClick={() => {
              take();
              // Replaying means wanting to see it play: a paused picture runs again.
              renderer.current?.replay();
              setPaused(false);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M13.2 6.4A5.4 5.4 0 0 0 3.1 5.3M2.8 9.6a5.4 5.4 0 0 0 10.1 1.1M3 2.6v2.9h2.9M13 13.4v-2.9h-2.9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      {controls && (
        <div onPointerDownCapture={take}>
          <Panel
            headingLevel={headingLevel}
            settings={settings}
            changed={Object.keys(overrides).length > 0}
            onChange={change}
            onReset={() => {
              setOverrides({});
              onSettingsChange?.(base);
              renderer.current?.replay();
              setAnnouncement('Settings reset');
            }}
          />
        </div>
      )}
      <p className={styles.hidden} aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
