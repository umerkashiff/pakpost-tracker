// Copyright (c) 2026 Bruno Delorence. MIT License.

import type { GradientSettings, Shape } from './presets';

/*
 * The renderer: one WebGL fragment shader draws the whole picture, the soft light and the
 * characters over it, at the canvas's device pixels.
 *
 * - The light is a field worked out per pixel: each shape gives how much light there is (L), how
 *   far into it a point lies (m: the edge colour gives way to the light's own), and where it sits
 *   across the light (u, which picks among the colours after the first). A slow noise warps the
 *   field so it wavers as it drifts.
 * - The characters live on a grid of cells, each 0.6 as wide as it is tall. A cell asks the same
 *   field at its middle how bright it is and picks a character from the ramp; a seeded noise
 *   leaves the dimmer cells empty first (density), and now and then a cell swaps with a
 *   neighbouring brightness (flicker).
 * - The glyphs come from an atlas drawn once on a 2D canvas, at the cell's exact size in device
 *   px, so they stay crisp; a blurred twin of it gives the glow and the out-of-focus characters.
 *   Blocks and dots are drawn as shapes, so they fill their cells whatever the font.
 * - Scrambling is an energy per cell, kept on the CPU (a few thousand bytes) and sent as a small
 *   texture: the pointer and a click's burst raise it, and it drains in about half a second. A
 *   click's ring is drawn by the shader itself, a thin band one cell wide travelling at about one
 *   height of the canvas a second. A cell with energy shows a random character from the ramp,
 *   changed sixteen times a second.
 * - The intro fades the light in from its source over 2.2 s while the cells it reaches decode.
 * - Time stops when the canvas is offscreen, the tab hidden or the reader pauses it (`pause`), and
 *   at a speed of 0 nothing changes until the reader scrambles some cells. Under reduced motion
 *   the renderer draws one still frame, with the light fully in.
 */

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 uRes;
uniform vec2 uCell;
uniform vec2 uGrid;
uniform vec2 uOffset;
uniform float uTime;
uniform float uClock;
uniform float uIntro;
uniform vec3 uColors[8];
uniform float uCount;
uniform float uShape;
uniform float uSoft;
uniform float uScale;
uniform float uFlow;
uniform float uGrain;
uniform float uDensity;
uniform float uGlyph;
uniform float uGrad;
uniform float uGlow;
uniform float uDof;
uniform float uFlicker;
uniform float uSeed;
uniform float uLight;
uniform float uChars;
uniform sampler2D uAtlas;
uniform sampler2D uBlur;
uniform sampler2D uEnergy;
// Up to four rings from clicks: centre (device px), radius (device px), strength.
uniform vec4 uWaves[4];
uniform float uBand;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// The colours after the first, as one ramp: u = 0 is the second colour, 1 the last.
vec3 sky(float u) {
  float n = uCount - 2.0;
  vec3 c = uColors[1];
  float pos = clamp(u, 0.0, 1.0) * n;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi < n) {
      vec3 next = uColors[2];
      if (i == 1) next = uColors[3];
      if (i == 2) next = uColors[4];
      if (i == 3) next = uColors[5];
      if (i == 4) next = uColors[6];
      if (i == 5) next = uColors[7];
      c = mix(c, next, clamp(pos - fi, 0.0, 1.0));
    }
  }
  return c;
}

// The light at p (centred, in heights of the canvas, y down): x = L, how much light; y = m, how
// far into it; z = u, where across it; w = the intro's distance from the light's source.
vec4 field(vec2 p) {
  float t = uTime;
  float s = uSeed * 7.31;
  vec2 warp = vec2(
    noise(p * 1.7 + vec2(t * 0.13 + s, -t * 0.08)),
    noise(p * 1.7 + vec2(-t * 0.1 + 3.7, t * 0.12 + s * 1.3))
  ) - 0.5;
  vec2 p0 = p;
  p += warp * uFlow * 0.13;
  p.y += sin(p.x * 2.6 + t * 0.5 + s) * uFlow * 0.03;
  float W = 0.1 + uSoft * 0.4;
  float L = 0.0; float m = 0.0; float u = 0.0; float k = 0.0;
  if (uShape < 0.5) {
    // Horizon: a dark planet below, its edge a wide curve; the sun high in the middle.
    vec2 q = (p - vec2(0.0, 0.5)) / uScale + vec2(0.0, 0.5);
    float d = length(q - vec2(0.0, 1.4)) - 1.15;
    L = smoothstep(-0.03, W * 1.05, d);
    vec2 sun = vec2(sin(t * 0.07 + s) * 0.04, -0.62);
    u = smoothstep(0.2, 0.75, length((q - sun) * vec2(1.6, 0.8)));
    // Under the sun the edge's blue gives way slowly; out towards the far sky, sooner.
    float spread = W / 0.3;
    m = smoothstep((0.22 - 0.06 * u) * spread, (0.66 - 0.16 * u) * spread, d);
    k = max(d, 0.0) * 1.6;
  } else if (uShape < 1.5) {
    // Pinch: a band of light between two dark lobes that squeeze it in the middle, its heart a
    // long glow at the centre.
    vec2 q = p / uScale;
    vec2 a = (q - vec2(0.0, -0.68)) / vec2(0.72, 0.45);
    vec2 b = (q - vec2(0.0, 0.69)) / vec2(0.72, 0.45);
    float d = min(length(a) - 1.0, length(b) - 1.0) * 0.45;
    float core = length((q - vec2(0.0, 0.03)) * vec2(0.8, 2.4));
    L = smoothstep(-0.03, W * 0.45, d);
    m = 1.0 - smoothstep(0.1, 0.8, core);
    u = 1.0 - smoothstep(0.0, 0.5, core);
    k = core * 0.9;
  } else if (uShape < 2.5) {
    // Rise: light welling up from below the bottom edge.
    vec2 q = (p - vec2(0.0, 0.5)) / uScale;
    float r = length((q - vec2(0.0, 0.2)) * vec2(0.5, 1.0));
    float d = 0.62 - r;
    L = smoothstep(-0.02, W * 0.9, d);
    m = smoothstep(0.0, W * 0.8 + 0.06, d);
    u = 1.0 - smoothstep(0.2, 0.36, r);
    k = r * 1.4;
  } else {
    // Eclipse: a dark disc, its edge never wavering, ringed with light that fades outwards in
    // slow uneven rays.
    vec2 q0 = p0 / uScale;
    vec2 q = p / uScale;
    vec2 dir = q0 / max(length(q0), 1e-4);
    float rays = noise(dir * 1.8 + vec2(s, t * 0.22)) * 0.5 + noise(dir * 4.2 + vec2(-t * 0.27, s)) * 0.5;
    float edge = length(q0) - 0.235;
    float dr = max(length(q) - 0.235, edge * 0.6);
    float reach = (W * 0.6 + 0.24) * (0.75 + rays * 0.5);
    L = smoothstep(-0.004, 0.004, edge) * pow(1.0 - smoothstep(0.0, reach, dr), 2.6);
    m = 1.0 - smoothstep(0.0, reach * 0.25, dr);
    u = 1.0 - smoothstep(0.0, W * 0.03 + 0.012, max(edge, 0.0));
    k = abs(edge) * 2.2;
  }
  return vec4(L, m, u, k);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  // The grid is centred on the canvas: uOffset is where its first cell starts (zero or less).
  vec2 cell = floor((px - uOffset) / uCell);
  vec2 local = (px - uOffset - cell * uCell) / uCell;
  vec2 p = (px - 0.5 * uRes) / uRes.y;
  vec2 pc = ((cell + 0.5) * uCell + uOffset - 0.5 * uRes) / uRes.y;

  // The intro: the light fades in and spreads out from its source (the planet's edge, the
  // band's heart, the bottom, the disc's rim), its far colours coming last.
  float front = uIntro * 1.5;
  vec4 f = field(p);
  vec4 fc = field(pc);
  float fade = smoothstep(0.0, 0.55, uIntro);
  f.x *= fade * (1.0 - smoothstep(front - 0.5, front, f.w));
  fc.x *= fade * (1.0 - smoothstep(front - 0.5, front, fc.w));
  float settle = smoothstep(0.35, 1.0, uIntro);
  f.y *= mix(0.4, 1.0, settle);
  fc.y *= mix(0.4, 1.0, settle);
  if (uShape > 0.5) {
    f.z = mix(1.0, f.z, settle);
    fc.z = mix(1.0, fc.z, settle);
  }

  vec3 base = mix(uColors[0], sky(f.z), f.y);
  vec3 cbase = mix(uColors[0], sky(fc.z), fc.y);
  // How bright a cell reads: the light, deeper in it brighter, brightest at its heart (the sun,
  // on a horizon).
  float b = uShape < 0.5
    ? pow(fc.x, 0.5) * mix(0.66, 1.0, fc.y) * (1.0 - 0.32 * fc.z)
    : uShape < 2.5 && uShape > 1.5
    ? pow(fc.x, 0.6) * (0.6 + 0.4 * fc.z)
    : pow(fc.x, 0.5) * (0.72 + 0.28 * max(fc.z, fc.y * 0.6));
  b = clamp(b, 0.0, 1.0);

  // Which character: brighter cells go further along the ramp; dimmer cells empty out first.
  float n = uChars;
  float seed = uSeed * 13.7;
  float rate = 0.8 + 2.4 * hash(cell + seed + 9.1);
  float tick = floor(uClock * rate + hash(cell + 4.2) * 7.0);
  float swap = hash(cell * 1.17 + tick * 0.371 + seed);
  float jitter = swap < uFlicker * 0.45 ? (hash(cell + tick + 2.3) < 0.5 ? -1.0 : 1.0) : 0.0;
  float idx = clamp(floor(b * (n - 1.0) + 0.5 + jitter), 0.0, n - 1.0);
  float gap = noise(cell * vec2(0.23, 0.61) + seed) * 0.6 + hash(cell + seed + 1.7) * 0.4;
  float keep = uDensity >= 0.999 ? 1.0 : step(gap, uDensity * (0.48 + 0.62 * b));
  if (b < 0.035) keep = 0.0;
  idx *= keep;

  // Scrambling: the pointer's energy, and the intro's decoding front.
  float energy = texture2D(uEnergy, (cell + 0.5) / uGrid).r;
  vec2 mid = (cell + 0.5) * uCell + uOffset;
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w > 0.0) {
      float off = abs(length(mid - w.xy) - w.z);
      energy = max(energy, (1.0 - smoothstep(0.0, uBand, off)) * w.w);
    }
  }
  float decode = (1.0 - smoothstep(0.0, 0.3, abs(fc.w - front + 0.3))) * (1.0 - smoothstep(0.75, 1.0, uIntro));
  float lit = energy;
  energy = max(energy, decode);
  float frame = floor(uClock * 16.0 + hash(cell) * 3.0);
  bool scrambled = energy > 0.06 + hash(cell * 0.73 + seed) * 0.6;
  if (scrambled) idx = 1.0 + floor(hash(cell * 1.31 + frame * 0.177 + seed) * (n - 1.0));

  vec2 uv = vec2((idx + local.x) / n, local.y);
  float crisp = texture2D(uAtlas, uv).a;
  float soft = texture2D(uBlur, uv).a;
  float dofCell = step(hash(cell * 0.91 + seed + 5.5), uDof);
  float cov = mix(crisp, min(soft * 1.5, 1.0) * 0.85, dofCell);
  if (idx < 0.5) { cov = 0.0; soft = 0.0; }

  float seen = smoothstep(0.02, 0.55, fc.x);
  // The pointer's scramble shows even at the light's fringe; the intro's decoding only where lit.
  if (scrambled) seen = max(seen, 0.85 * smoothstep(0.0, 0.3, lit) * smoothstep(0.0, 0.2, fc.x));
  vec3 ink = uLight > 0.5
    ? cbase * mix(0.62, 0.42, fc.z * fc.y)
    : min(cbase * 1.42 + vec3(0.03), vec3(1.0));
  if (scrambled && uLight < 0.5) ink = mix(ink, vec3(1.0), 0.3);

  vec3 wash = uLight > 0.5 ? mix(base, vec3(1.0), 0.12) : base;
  float ga = f.x * uGrad;
  float gl = cov * uGlyph * seen;
  vec3 rgb = wash * ga * (1.0 - gl) + ink * gl;
  float alpha = ga * (1.0 - gl) + gl;
  float halo = soft * uGlow * 0.6 * uGlyph * seen * (uLight > 0.5 ? 0.4 : 1.0);
  rgb += ink * halo * (1.0 - gl);
  alpha = min(alpha + halo * (1.0 - gl), 1.0);

  // Film grain, only where something is drawn.
  float g = hash(px + fract(uClock * 7.13) * vec2(91.7, 37.3)) - 0.5;
  rgb += g * uGrain * 1.1 * alpha;
  rgb = clamp(rgb, 0.0, alpha);
  gl_FragColor = vec4(rgb, alpha);
}
`;

const SHAPES: Record<Shape, number> = { horizon: 0, pinch: 1, rise: 2, eclipse: 3 };

/** How long the intro takes, in ms. */
export const INTRO_MS = 2200;
/** How fast a click's ring travels, in heights of the canvas per second; the shader draws it. */
const WAVE_SPEED = 1.05;
/** How fast scrambled cells settle: energy drained per second. */
const SETTLE = 2.1;

type Wave = { x: number; y: number; start: number };

export type Renderer = {
  /**
   * Applies new settings; `still` draws one frame and stops (reduced motion); `maxDpr` caps the
   * device pixel ratio it draws at.
   */
  set: (settings: GradientSettings, still: boolean, maxDpr?: number) => void;
  /** Whether time may run: false offscreen or in a hidden tab. */
  active: (on: boolean) => void;
  /** Holds the picture where it is (true) or lets it run on from there (false). */
  pause: (on: boolean) => void;
  /** A pointer at x, y (css px from the canvas's top left) or gone (null). */
  pointer: (x: number | null, y?: number) => void;
  click: (x: number, y: number) => void;
  replay: () => void;
  /** Called every frame with the time, before drawing (the demo moves its pointer here). */
  onTick: (callback: ((now: number) => void) | null) => void;
  destroy: () => void;
};

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Draws one glyph into its cell: blocks and dots as shapes, the rest as text. */
function drawGlyph(g: CanvasRenderingContext2D, char: string, x: number, w: number, h: number) {
  const blocks = ' ░▒▓█';
  const dots = ' ·•●';
  if (blocks.includes(char) && char !== ' ') {
    g.globalAlpha = (blocks.indexOf(char) / 4) * 0.82 + 0.18;
    const bw = Math.max(1, Math.round(w * 0.66));
    g.fillRect(x + Math.round((w - bw) / 2), 0, bw, h);
    g.globalAlpha = 1;
    return;
  }
  if (dots.includes(char) && char !== ' ') {
    const r = [0, 0.12, 0.24, 0.37][dots.indexOf(char)] * w;
    g.beginPath();
    g.arc(x + w / 2, h / 2, Math.max(0.8, r), 0, Math.PI * 2);
    g.fill();
    return;
  }
  g.fillText(char, x + w / 2, h / 2 + h * 0.03);
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: true,
    alpha: true,
    antialias: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  const u = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program, name));
    return uniforms.get(name)!;
  };

  const makeTexture = (unit: number, filter: number) => {
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  };
  const atlasTexture = makeTexture(0, gl.NEAREST);
  const blurTexture = makeTexture(1, gl.LINEAR);
  const energyTexture = makeTexture(2, gl.NEAREST);
  gl.uniform1i(u('uAtlas'), 0);
  gl.uniform1i(u('uBlur'), 1);
  gl.uniform1i(u('uEnergy'), 2);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  let settings: GradientSettings | null = null;
  let still = false;
  let paused = false;
  let pausedAt = 0;
  let running = false;
  let isActive = false;
  let raf = 0;
  let last = 0;
  let drift = 0;
  let clock = 0;
  let introStart = -1;
  let dpr = 1;
  let maxDpr = 2;
  let cssW = 0;
  let cssH = 0;
  let cellW = 1;
  let cellH = 1;
  let cols = 1;
  let rows = 1;
  let offsetX = 0;
  let offsetY = 0;
  let energy = new Float32Array(1);
  let energyBytes = new Uint8Array(1);
  let energyLive = false;
  let atlasKey = '';
  let waves: Wave[] = [];
  let lastPointer: { x: number; y: number } | null = null;
  let tick: ((now: number) => void) | null = null;

  const buildAtlas = () => {
    if (!settings) return;
    const chars = [...settings.characters];
    const key = `${chars.join('')}|${cellW}|${cellH}|${settings.fontFamily}`;
    if (key === atlasKey) return;
    atlasKey = key;
    const make = () => {
      const c = document.createElement('canvas');
      c.width = cellW * chars.length;
      c.height = cellH;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `500 ${Math.round(cellH * 0.8)}px ${settings!.fontFamily}`;
      return { c, g };
    };
    const crisp = make();
    chars.forEach((char, i) => drawGlyph(crisp.g, char, i * cellW, cellW, cellH));
    // The blurred twin: each glyph's shadow, its glyph drawn out of the canvas.
    const blur = make();
    blur.g.shadowColor = '#fff';
    blur.g.shadowBlur = Math.max(2, cellW * 0.45);
    const away = blur.c.width + cellW * 4;
    blur.g.shadowOffsetX = away;
    blur.g.save();
    blur.g.translate(-away, 0);
    chars.forEach((char, i) => drawGlyph(blur.g, char, i * cellW, cellW, cellH));
    blur.g.restore();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, crisp.c);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blur.c);
    gl.uniform1f(u('uChars'), chars.length);
  };

  const resize = () => {
    if (!settings) return;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    const rawDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    dpr = Math.min(Number.isFinite(rawDpr) ? rawDpr : 1, 1.5);
    const parent = canvas.parentElement;
    const rawW = (parent && parent.clientWidth > 0 ? parent.clientWidth : 0) || (typeof window !== 'undefined' ? window.innerWidth : 1200);
    const rawH = (parent && parent.clientHeight > 0 ? parent.clientHeight : 0) || (typeof window !== 'undefined' ? window.innerHeight : 800);
    cssW = Math.max(100, Math.min(3840, Math.round(rawW)));
    cssH = Math.max(100, Math.min(2160, Math.round(rawH)));
    const w = Math.max(100, Math.round(cssW * dpr));
    const h = Math.max(100, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const safeCellSize =
      typeof settings.cellSize === 'number' && Number.isFinite(settings.cellSize) && settings.cellSize >= 4
        ? settings.cellSize
        : 16;
    cellH = Math.max(6, Math.round(safeCellSize * dpr));
    cellW = Math.max(4, Math.round(safeCellSize * 0.6 * dpr));
    const rawCols = Math.ceil(w / cellW);
    const rawRows = Math.ceil(h / cellH);
    const nextCols = Math.min(400, Math.max(1, Number.isFinite(rawCols) ? rawCols : 50));
    const nextRows = Math.min(300, Math.max(1, Number.isFinite(rawRows) ? rawRows : 50));
    offsetX = Math.floor((w - nextCols * cellW) / 2);
    offsetY = Math.floor((h - nextRows * cellH) / 2);
    if (nextCols !== cols || nextRows !== rows || energy.length !== nextCols * nextRows) {
      cols = nextCols;
      rows = nextRows;
      energy = new Float32Array(cols * rows);
      energyBytes = new Uint8Array(cols * rows);
      uploadEnergy();
    }
    gl.viewport(0, 0, w, h);
    buildAtlas();
  };

  const uploadEnergy = () => {
    for (let i = 0; i < energy.length; i++) energyBytes[i] = Math.round(energy[i] * 255);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, energyTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      cols,
      rows,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      energyBytes,
    );
  };

  /** Raises the energy of the cells within `radius` css px of x, y. */
  const stamp = (x: number, y: number, radius: number, strength = 1) => {
    const cx = (x * dpr - offsetX) / cellW;
    const cy = (y * dpr - offsetY) / cellH;
    const rx = Math.max(0.6, (radius * dpr) / cellW);
    const ry = Math.max(0.6, (radius * dpr) / cellH);
    for (let row = Math.max(0, Math.floor(cy - ry)); row <= Math.min(rows - 1, cy + ry); row++) {
      for (let col = Math.max(0, Math.floor(cx - rx)); col <= Math.min(cols - 1, cx + rx); col++) {
        const dx = (col + 0.5 - cx) / rx;
        const dy = (row + 0.5 - cy) / ry;
        const d = dx * dx + dy * dy;
        if (d > 1) continue;
        const i = row * cols + col;
        energy[i] = Math.max(energy[i], strength * (1 - d * 0.6) * (0.7 + Math.random() * 0.3));
      }
    }
    energyLive = true;
  };

  /** The rings still travelling, as the shader takes them: centre, radius, strength. */
  const waveUniform = new Float32Array(16);
  const advanceWaves = (now: number) => {
    waveUniform.fill(0);
    if (!waves.length) return;
    const maxR = Math.hypot(cssW, cssH);
    waves = waves.filter((wave) => ((now - wave.start) / 1000) * WAVE_SPEED * cssH < maxR + 40);
    waves.slice(-4).forEach((wave, i) => {
      const r = ((now - wave.start) / 1000) * WAVE_SPEED * cssH;
      waveUniform.set(
        [wave.x * dpr, wave.y * dpr, r * dpr, 0.85 * (1 - Math.min(1, r / maxR))],
        i * 4,
      );
    });
  };

  const draw = (now: number) => {
    if (!settings) return;
    const s = settings;
    const colors = s.colors.slice(0, 8);
    const flat = new Float32Array(24);
    colors.forEach((hex, i) => flat.set(hexToRgb(hex), i * 3));
    gl.uniform3fv(u('uColors'), flat);
    gl.uniform1f(u('uCount'), Math.max(2, colors.length));
    gl.uniform2f(u('uRes'), canvas.width, canvas.height);
    gl.uniform2f(u('uCell'), cellW, cellH);
    gl.uniform2f(u('uGrid'), cols, rows);
    // The shader's y runs down from the top, as offsetY does.
    gl.uniform2f(u('uOffset'), offsetX, offsetY);
    gl.uniform1f(u('uTime'), drift);
    gl.uniform1f(u('uClock'), clock);
    const at = paused ? pausedAt : now;
    const progress =
      still || !s.intro || introStart < 0
        ? 1
        : Math.min(1, Math.max(0, (at - introStart) / INTRO_MS));
    // Eased in and out: the light gathers, then settles.
    gl.uniform1f(u('uIntro'), progress * progress * (3 - 2 * progress));
    gl.uniform1f(u('uShape'), SHAPES[s.shape]);
    gl.uniform1f(u('uSoft'), s.softness);
    gl.uniform1f(u('uScale'), s.scale);
    gl.uniform1f(u('uFlow'), s.flow);
    gl.uniform1f(u('uGrain'), s.grain);
    gl.uniform1f(u('uDensity'), s.density);
    gl.uniform1f(u('uGlyph'), s.glyphOpacity);
    gl.uniform1f(u('uGrad'), s.gradientOpacity);
    gl.uniform1f(u('uGlow'), s.glow);
    gl.uniform1f(u('uDof'), s.depthOfField);
    gl.uniform1f(u('uFlicker'), s.flicker);
    gl.uniform1f(u('uSeed'), s.variation);
    gl.uniform1f(u('uLight'), s.lightMode ? 1 : 0);
    gl.uniform4fv(u('uWaves'), waveUniform);
    gl.uniform1f(u('uBand'), cellH * 0.9);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const frame = (now: number) => {
    raf = 0;
    if (!running || !settings) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    drift += dt * settings.speed;
    // The flicker and the scramble run on this clock: at a speed of 0 it waits while nothing is
    // scrambled, so the picture holds still.
    if (settings.speed > 0 || energyLive || waves.length) clock += dt;
    tick?.(now);
    advanceWaves(now);
    if (energyLive) {
      let any = false;
      for (let i = 0; i < energy.length; i++) {
        if (energy[i] > 0) {
          energy[i] = Math.max(0, energy[i] - dt * SETTLE);
          any = true;
        }
      }
      uploadEnergy();
      energyLive = any;
    }
    draw(now);
    raf = requestAnimationFrame(frame);
  };

  const update = () => {
    const shouldRun = isActive && !still && !paused && !!settings;
    if (shouldRun && !running) {
      running = true;
      last = 0;
      if (introStart < 0) introStart = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (!running && settings) draw(performance.now());
  };

  const onWindowResize = () => {
    resize();
    if (!running) draw(performance.now());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onWindowResize);
  }

  return {
    set(next, nextStill, nextMaxDpr = 2) {
      maxDpr = Math.max(0.5, Math.min(2, nextMaxDpr));
      const shapeChanged = settings && settings.shape !== next.shape;
      settings = next;
      still = nextStill;
      if (still) {
        energy.fill(0);
        waves = [];
        uploadEnergy();
        drift = 0;
        clock = 0;
      }
      if (shapeChanged && next.intro && !still) introStart = paused ? pausedAt : performance.now();
      resize();
      update();
    },
    active(on) {
      isActive = on;
      update();
    },
    pause(on) {
      if (on === paused) return;
      const now = performance.now();
      if (on) {
        pausedAt = now;
        lastPointer = null;
      } else {
        // The intro and the rings go on from where they were held.
        const held = now - pausedAt;
        if (introStart >= 0) introStart += held;
        waves = waves.map((wave) => ({ ...wave, start: wave.start + held }));
      }
      paused = on;
      update();
    },
    pointer(x, y = 0) {
      if (!settings || still || paused || !settings.mouseInteraction || x === null) {
        lastPointer = null;
        return;
      }
      const radius = settings.scrambleRadius * cssH;
      // Fill in the path between two events, so a fast stroke leaves no gaps.
      if (lastPointer) {
        const dx = x - lastPointer.x;
        const dy = y - lastPointer.y;
        const steps = Math.min(24, Math.ceil(Math.hypot(dx, dy) / Math.max(4, radius * 0.4)));
        for (let i = 1; i < steps; i++)
          stamp(lastPointer.x + (dx * i) / steps, lastPointer.y + (dy * i) / steps, radius);
      }
      stamp(x, y, radius);
      lastPointer = { x, y };
    },
    click(x, y) {
      if (!settings || still || paused) return;
      if (settings.clickEffect === 'wave') {
        waves.push({ x, y, start: performance.now() });
        stamp(x, y, settings.scrambleRadius * cssH * 0.6);
      } else if (settings.clickEffect === 'burst') {
        stamp(x, y, Math.max(settings.scrambleRadius * 2.4, 0.12) * cssH);
      }
    },
    replay() {
      introStart = paused ? pausedAt : performance.now();
      if (!running && settings) draw(performance.now());
    },
    onTick(callback) {
      tick = callback;
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onWindowResize);
      }
      // The context stays with the canvas (React may mount the same canvas again); only this
      // renderer's own objects go.
      gl.deleteTexture(atlasTexture);
      gl.deleteTexture(blurTexture);
      gl.deleteTexture(energyTexture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
