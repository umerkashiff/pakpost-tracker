// Copyright (c) 2026 Bruno Delorence. MIT License.

'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CHARACTER_SETS,
  PRESETS,
  RANGES,
  characterSetOf,
  presetOf,
  type CharacterSet,
  type ClickEffect,
  type GradientSettings,
  type NumberSetting,
  type Preset,
  type Shape,
} from './presets';
import styles from './gradient-ascii.module.css';

/*
 * The panel that tunes the gradient, in three columns of rows (two, then one, on narrow
 * stages): the colours, four menus, a scrubber for every number and three switches.
 *
 * - A scrubber is the whole row: press anywhere on it, or drag, to set the value; the arrow
 *   keys step it, Page Up and Down take ten steps, Home and End go to the ends. Its fill and its
 *   handle show where the value sits in the range.
 * - A menu is a button that opens a list under it (the listbox pattern): arrows move, Enter or
 *   Space picks, Escape closes and gives the focus back.
 * - Each colour is a native colour input under its swatch; minus and plus take the last colour
 *   away or add one (two to eight).
 */

type Change = (patch: Partial<GradientSettings>) => void;

const SHAPES: { value: Shape; label: string }[] = [
  { value: 'horizon', label: 'Horizon' },
  { value: 'pinch', label: 'Pinch' },
  { value: 'rise', label: 'Rise' },
  { value: 'eclipse', label: 'Eclipse' },
];
const CLICKS: { value: ClickEffect; label: string }[] = [
  { value: 'wave', label: 'Wave' },
  { value: 'burst', label: 'Burst' },
  { value: 'none', label: 'None' },
];

/** The order of the scrubbers, row by row across the three columns. */
const NUMBERS: NumberSetting[] = [
  'cellSize',
  'density',
  'glyphOpacity',
  'gradientOpacity',
  'glow',
  'depthOfField',
  'flicker',
  'softness',
  'scale',
  'flow',
  'speed',
  'grain',
  'variation',
  'scrambleRadius',
];

function format(key: NumberSetting, value: number) {
  const range = RANGES[key];
  const text = String(Number(value.toFixed(range.step >= 1 ? 0 : 2)));
  return range.unit ? `${text}${range.unit}` : text;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={styles.chevron} data-open={open} viewBox="0 0 14 14" aria-hidden="true">
      <path
        d="M3.5 5.25 7 8.75l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  part,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  part: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  const pick = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    button.current?.focus();
  };
  const onListKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') setActive((i) => (i + 1) % options.length);
    else if (event.key === 'ArrowUp') setActive((i) => (i - 1 + options.length) % options.length);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(options.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') pick(active);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
      if (event.key === 'Escape') button.current?.focus();
      return;
    } else return;
    event.preventDefault();
  };

  return (
    <div className={styles.selectBox} ref={box} data-part={part}>
      <button
        ref={button}
        type="button"
        className={styles.row}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={`${label}: ${current?.label ?? 'Custom'}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show();
          }
        }}
      >
        <span className={styles.label}>{label}</span>
        <span className={styles.selectValue}>
          <span>{current?.label ?? 'Custom'}</span>
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className={styles.menu}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className={styles.option}
              data-active={index === active}
              onPointerEnter={() => setActive(index)}
              onClick={() => pick(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Scrubber({
  name,
  value,
  onChange,
}: {
  name: NumberSetting;
  value: number;
  onChange: (value: number) => void;
}) {
  const range = RANGES[name];
  const track = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const share = (value - range.min) / (range.max - range.min);
  const snap = (v: number) => {
    const stepped = Math.round((v - range.min) / range.step) * range.step + range.min;
    return Math.min(range.max, Math.max(range.min, Number(stepped.toFixed(4))));
  };
  const fromPointer = (event: ReactPointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onChange(snap(range.min + x * (range.max - range.min)));
  };
  const onKey = (event: ReactKeyboardEvent) => {
    const big = range.step * 10 > (range.max - range.min) / 4 ? range.step * 2 : range.step * 10;
    const moves: Record<string, number> = {
      ArrowRight: range.step,
      ArrowUp: range.step,
      ArrowLeft: -range.step,
      ArrowDown: -range.step,
      PageUp: big,
      PageDown: -big,
    };
    if (event.key in moves) onChange(snap(value + moves[event.key]));
    else if (event.key === 'Home') onChange(range.min);
    else if (event.key === 'End') onChange(range.max);
    else return;
    event.preventDefault();
  };
  return (
    <div
      ref={track}
      className={`${styles.row} ${styles.scrubber}`}
      role="slider"
      tabIndex={0}
      aria-label={range.label}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={value}
      aria-valuetext={format(name, value)}
      data-dragging={dragging}
      data-part="scrubber"
      style={{ '--share': share } as CSSProperties}
      onKeyDown={onKey}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        fromPointer(event);
      }}
      onPointerMove={(event) => {
        if (dragging) fromPointer(event);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <span className={styles.fill} aria-hidden="true" />
      <span className={styles.ticks} aria-hidden="true">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={styles.tick} style={{ left: `${(i + 1) * 10}%` }} />
        ))}
      </span>
      <span className={styles.handle} aria-hidden="true" />
      <span className={styles.label}>{range.label}</span>
      <span className={styles.value}>{format(name, value)}</span>
    </div>
  );
}

function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.row}
      data-part="switch"
      onClick={() => onChange(!checked)}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.switch} data-on={checked} aria-hidden="true">
        <span className={styles.knob} />
      </span>
    </button>
  );
}

function Colors({ colors, onChange }: { colors: string[]; onChange: (colors: string[]) => void }) {
  return (
    <div className={styles.colors} role="group" aria-label="Colors" data-part="colors">
      <div className={styles.colorsHead}>
        <span className={styles.label}>Colors</span>
        <span className={styles.colorButtons}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Remove the last colour"
            disabled={colors.length <= 2}
            onClick={() => onChange(colors.slice(0, -1))}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2.9 7h8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Add a colour"
            disabled={colors.length >= 8}
            onClick={() => onChange([...colors, colors[colors.length - 1]])}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path
                d="M2.9 7h8.2M7 2.9v8.2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      </div>
      <div className={styles.swatches}>
        {colors.map((color, index) => (
          <label key={index} className={styles.swatch} style={{ background: color }}>
            <input
              type="color"
              className={styles.colorInput}
              value={color}
              aria-label={`Colour ${index + 1} of ${colors.length}`}
              onChange={(event) =>
                onChange(colors.map((c, i) => (i === index ? event.target.value : c)))
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function Panel({
  settings,
  onChange,
  onReset,
  changed,
  headingLevel = 2,
}: {
  /** The level of the Customize heading. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  settings: GradientSettings;
  onChange: Change;
  onReset: () => void;
  /** Whether anything differs from the props: only then is there something to reset. */
  changed: boolean;
}) {
  const heading = useId();
  const Heading = `h${headingLevel}` as const;
  const preset = presetOf(settings);
  const characters = characterSetOf(settings.characters);
  const number = (name: NumberSetting) => (
    <Scrubber
      key={name}
      name={name}
      value={settings[name]}
      onChange={(value) => onChange({ [name]: value })}
    />
  );
  return (
    <section className={styles.customize} aria-labelledby={heading} data-part="customize">
      <div className={styles.customizeHead}>
        <Heading id={heading} className={styles.customizeTitle}>
          Customize
        </Heading>
        <button
          type="button"
          className={styles.reset}
          data-part="reset"
          data-shown={changed}
          aria-hidden={!changed}
          tabIndex={changed ? 0 : -1}
          onClick={onReset}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M2.6 7a4.4 4.4 0 1 0 1.3-3.1M2.6 2.4v2.3h2.3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Reset
        </button>
      </div>
      <div className={styles.panel} data-part="panel">
        <Colors colors={settings.colors} onChange={(colors) => onChange({ colors })} />
        <Select<Preset>
          label="Preset"
          part="preset"
          value={preset}
          options={(Object.keys(PRESETS) as Preset[]).map((name) => ({ value: name, label: name }))}
          onChange={(name) => {
            const next = PRESETS[name];
            onChange({ ...next, colors: [...next.colors] });
          }}
        />
        <Select<Shape>
          label="Shape"
          part="shape"
          value={settings.shape}
          options={SHAPES}
          onChange={(shape) => onChange({ shape })}
        />
        <Select<CharacterSet>
          label="Characters"
          part="characters"
          value={characters}
          options={(Object.keys(CHARACTER_SETS) as CharacterSet[]).map((name) => ({
            value: name,
            label: name,
          }))}
          onChange={(name) => onChange({ characters: CHARACTER_SETS[name] })}
        />
        <Select<ClickEffect>
          label="Click Effect"
          part="click-effect"
          value={settings.clickEffect}
          options={CLICKS}
          onChange={(clickEffect) => onChange({ clickEffect })}
        />
        {NUMBERS.map(number)}
        <Switch
          label="Mouse Interaction"
          checked={settings.mouseInteraction}
          onChange={(mouseInteraction) => onChange({ mouseInteraction })}
        />
        <Switch label="Intro" checked={settings.intro} onChange={(intro) => onChange({ intro })} />
        <Switch
          label="Light Mode"
          checked={settings.lightMode}
          onChange={(lightMode) => onChange({ lightMode })}
        />
      </div>
    </section>
  );
}
