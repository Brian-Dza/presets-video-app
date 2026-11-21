export interface ParsedCubeLut {
  title: string;
  size: number;
  /** 20-element 4x5 SVG feColorMatrix values for 100% LUT application */
  colorMatrix: number[];
  contrast: number;
  saturation: number;
  brightness: number;
  warmth: number;
  hueRotateDeg: number;
}

const IDENTITY_MATRIX: number[] = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function parseCubeLut(content: string, fallbackName = 'Custom LUT'): ParsedCubeLut | null {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) return null;

  let title = fallbackName.replace(/\.cube$/i, '');
  let size3d = 0;
  let size1d = 0;
  const entries: Array<[number, number, number]> = [];

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      const match = line.match(/TITLE\s+"?([^"]+)"?/i);
      if (match?.[1]) title = match[1].trim();
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      const num = Number(line.split(/\s+/)[1]);
      if (Number.isFinite(num) && num > 1) size3d = Math.round(num);
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) {
      const num = Number(line.split(/\s+/)[1]);
      if (Number.isFinite(num) && num > 1) size1d = Math.round(num);
      continue;
    }
    if (/^[A-Z_]/i.test(line)) continue;

    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((v) => Number.isFinite(v))) {
      entries.push([parts[0], parts[1], parts[2]]);
    }
  }

  if (entries.length < 2) return null;

  const black = entries[0];
  const white = entries[entries.length - 1];
  const mid = entries[Math.floor(entries.length / 2)];

  // Extract true 3D cardinal corners when LUT_3D_SIZE N matches N^3 entries (.cube order: R fastest, G middle, B slowest)
  const inferred3d = size3d > 1 && entries.length >= size3d ** 3 ? size3d : 0;
  let redCorner: [number, number, number] = [white[0], black[1], black[2]];
  let greenCorner: [number, number, number] = [black[0], white[1], black[2]];
  let blueCorner: [number, number, number] = [black[0], black[1], white[2]];

  if (inferred3d >= 2) {
    const n = inferred3d;
    redCorner = entries[n - 1] ?? redCorner;
    greenCorner = entries[(n - 1) * n] ?? greenCorner;
    blueCorner = entries[(n - 1) * n * n] ?? blueCorner;
  }

  // Build affine 3x4 RGB color matrix: Out = Black + (R_corner - Black)*R + (G_corner - Black)*G + (B_corner - Black)*B
  const rVec: [number, number, number] = [
    clamp(redCorner[0] - black[0], 0, 1.8),
    clamp(redCorner[1] - black[1], -0.5, 0.8),
    clamp(redCorner[2] - black[2], -0.5, 0.8),
  ];
  const gVec: [number, number, number] = [
    clamp(greenCorner[0] - black[0], -0.5, 0.8),
    clamp(greenCorner[1] - black[1], 0, 1.8),
    clamp(greenCorner[2] - black[2], -0.5, 0.8),
  ];
  const bVec: [number, number, number] = [
    clamp(blueCorner[0] - black[0], -0.5, 0.8),
    clamp(blueCorner[1] - black[1], -0.5, 0.8),
    clamp(blueCorner[2] - black[2], 0, 1.8),
  ];

  const colorMatrix: number[] = [
    rVec[0], gVec[0], bVec[0], 0, clamp(black[0], -0.2, 0.25),
    rVec[1], gVec[1], bVec[1], 0, clamp(black[1], -0.2, 0.25),
    rVec[2], gVec[2], bVec[2], 0, clamp(black[2], -0.2, 0.25),
    0, 0, 0, 1, 0,
  ];

  const lumaLow = (black[0] + black[1] + black[2]) / 3;
  const lumaHigh = (white[0] + white[1] + white[2]) / 3;
  const lumaMid = (mid[0] + mid[1] + mid[2]) / 3;

  const avgRedBias = entries.reduce((acc, [r, , b]) => acc + (r - b), 0) / entries.length;
  const avgGreenBias = entries.reduce((acc, [r, g, b]) => acc + (g - (r + b) / 2), 0) / entries.length;

  const contrast = clamp(1 + (lumaHigh - lumaLow - 1) * 0.55, 0.75, 1.5);
  const brightness = clamp(1 + (lumaMid - 0.5) * 0.3, 0.8, 1.25);
  const warmth = clamp(avgRedBias * 0.85, -0.4, 0.45);
  const hueRotateDeg = clamp(avgGreenBias * 42, -28, 28);
  const saturation = clamp(1 + Math.abs(avgRedBias) * 0.38, 0.65, 1.5);

  return {
    title,
    size: inferred3d || size1d || Math.round(Math.cbrt(entries.length)) || entries.length,
    colorMatrix,
    contrast,
    saturation,
    brightness,
    warmth,
    hueRotateDeg,
  };
}

export function interpolateLutMatrix(lut: ParsedCubeLut | null, mixPercent: number): string | null {
  if (!lut || mixPercent <= 0) return null;
  const m = clamp(mixPercent / 100, 0, 1);
  return lut.colorMatrix
    .map((targetVal, idx) => {
      const base = IDENTITY_MATRIX[idx];
      return (base + (targetVal - base) * m).toFixed(4);
    })
    .join(' ');
}

export function evaluateLutCssFilter(lut: ParsedCubeLut | null, mixPercent: number): string {
  if (!lut || mixPercent <= 0) return '';
  const m = clamp(mixPercent / 100, 0, 1);
  const contrast = 1 + (lut.contrast - 1) * m;
  const saturation = 1 + (lut.saturation - 1) * m;
  const brightness = 1 + (lut.brightness - 1) * m;
  const sepia = Math.max(0, lut.warmth) * m * 0.65;
  const hue = lut.hueRotateDeg * m;

  return `contrast(${contrast.toFixed(3)}) saturate(${saturation.toFixed(3)}) brightness(${brightness.toFixed(3)}) sepia(${sepia.toFixed(3)}) hue-rotate(${hue.toFixed(1)}deg)`;
}
