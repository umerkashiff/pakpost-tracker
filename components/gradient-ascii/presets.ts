// Copyright (c) 2026 Bruno Delorence. MIT License.

/*
 * The settings a gradient takes, their defaults and ranges, and the named starting points: four
 * presets (a palette, a shape, a set of characters and a cell size each) and five sets of
 * characters. The panel and the renderer both read from here.
 */

export type Shape = 'horizon' | 'pinch' | 'rise' | 'eclipse';
export type ClickEffect = 'wave' | 'burst' | 'none';

export type GradientSettings = {
  /**
   * Two to eight colours. The first is the edge of the shadow; the rest run across the light: on
   * a horizon from the sun out to the far sky, on the other shapes from the outskirts in to the
   * heart of the light.
   */
  colors: string[];
  shape: Shape;
  /** Characters from dimmest to brightest; a space leaves a cell empty. */
  characters: string;
  /** Height of a character cell in px; cells are 0.6 as wide. */
  cellSize: number;
  density: number;
  glyphOpacity: number;
  gradientOpacity: number;
  glow: number;
  depthOfField: number;
  flicker: number;
  softness: number;
  scale: number;
  flow: number;
  speed: number;
  grain: number;
  variation: number;
  mouseInteraction: boolean;
  scrambleRadius: number;
  clickEffect: ClickEffect;
  intro: boolean;
  lightMode: boolean;
  fontFamily: string;
};

export const CHARACTER_SETS = {
  Letters: ' =+xX0S8#@',
  Classic: ' .:-=+*#%@',
  Binary: ' 01',
  Blocks: ' ░▒▓█',
  Dots: ' ·•●',
} as const;
export type CharacterSet = keyof typeof CHARACTER_SETS;

export const PRESETS = {
  Atmosphere: {
    colors: ['#1e3fd8', '#f6f8ff', '#a5d8ff', '#38bdf8'],
    shape: 'horizon',
    characters: CHARACTER_SETS.Letters,
    cellSize: 18,
  },
  Lagoon: {
    colors: ['#0d9488', '#5eead4', '#f0fdfa'],
    shape: 'pinch',
    characters: CHARACTER_SETS.Classic,
    cellSize: 16,
  },
  Rose: {
    colors: ['#9f1239', '#f43f5e', '#fda4af', '#fff1f2'],
    shape: 'rise',
    characters: CHARACTER_SETS.Letters,
    cellSize: 22,
  },
  Corona: {
    colors: ['#78350f', '#f59e0b', '#fffbeb'],
    shape: 'eclipse',
    characters: CHARACTER_SETS.Binary,
    cellSize: 15,
  },
} satisfies Record<string, Pick<GradientSettings, 'colors' | 'shape' | 'characters' | 'cellSize'>>;
export type Preset = keyof typeof PRESETS;

export const DEFAULTS: GradientSettings = {
  ...PRESETS.Atmosphere,
  colors: [...PRESETS.Atmosphere.colors],
  shape: 'horizon',
  density: 0.8,
  glyphOpacity: 0.85,
  gradientOpacity: 0.9,
  glow: 0.2,
  depthOfField: 0,
  flicker: 0.2,
  softness: 0.5,
  scale: 1,
  flow: 0.5,
  speed: 1,
  grain: 0.08,
  variation: 0,
  mouseInteraction: true,
  scrambleRadius: 0.1,
  clickEffect: 'wave',
  intro: true,
  lightMode: false,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

export type NumberSetting = {
  [K in keyof GradientSettings]: GradientSettings[K] extends number ? K : never;
}[keyof GradientSettings];

/** Each number's range, step, and how the panel writes it. */
export const RANGES: Record<
  NumberSetting,
  { label: string; min: number; max: number; step: number; unit?: string }
> = {
  cellSize: { label: 'Cell Size', min: 8, max: 40, step: 1, unit: 'px' },
  density: { label: 'Density', min: 0, max: 1, step: 0.05 },
  glyphOpacity: { label: 'Glyph Opacity', min: 0, max: 1, step: 0.05 },
  gradientOpacity: { label: 'Gradient Opacity', min: 0, max: 1, step: 0.05 },
  glow: { label: 'Glow', min: 0, max: 1.5, step: 0.05 },
  depthOfField: { label: 'Depth of Field', min: 0, max: 1, step: 0.05 },
  flicker: { label: 'Flicker', min: 0, max: 1, step: 0.05 },
  softness: { label: 'Softness', min: 0, max: 1, step: 0.05 },
  scale: { label: 'Scale', min: 0.4, max: 2.5, step: 0.05 },
  flow: { label: 'Flow', min: 0, max: 2, step: 0.05 },
  speed: { label: 'Speed', min: 0, max: 3, step: 0.05 },
  grain: { label: 'Grain', min: 0, max: 0.4, step: 0.01 },
  variation: { label: 'Variation', min: 0, max: 10, step: 1 },
  scrambleRadius: { label: 'Scramble Radius', min: 0.02, max: 0.4, step: 0.01 },
};

/** The preset whose palette, shape, characters and cell size these settings carry, if any. */
export function presetOf(settings: GradientSettings): Preset | null {
  for (const [name, preset] of Object.entries(PRESETS) as [Preset, (typeof PRESETS)[Preset]][]) {
    if (
      preset.shape === settings.shape &&
      preset.characters === settings.characters &&
      preset.cellSize === settings.cellSize &&
      preset.colors.join() === settings.colors.join()
    )
      return name;
  }
  return null;
}

/** The named set these characters are, if any. */
export function characterSetOf(characters: string): CharacterSet | null {
  for (const [name, set] of Object.entries(CHARACTER_SETS) as [CharacterSet, string][])
    if (set === characters) return name;
  return null;
}
