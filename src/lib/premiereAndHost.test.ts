import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { anchorPointToPivot, PRO_RECIPES, type PresetRecord } from '../domain/preset';
import { evaluateTypewriterState } from '../components/PresetPreviewPlayer';
import { starterPresets } from '../data/starterPresets';
import { buildSfxWavBytes, generateSfxWaveformPeaks } from './audioSfx';
import { evaluateLutCssFilter, interpolateLutMatrix, parseCubeLut } from './lutParser';
import { createMogrtPackage, createPrfpsetPackage } from './premiereFactory';
import { listLocalPresetVersions, saveLocalPreset, setLocalFavorite } from './localStore';
import {
  createDrfx,
  createPremierePackZip,
  exportPackageForTarget,
  parsePresetCollectionFile,
  parsePresetFile,
} from './presetFiles';
import { validatePublicCloudCredentials } from './supabase';

const require = createRequire(import.meta.url);
const localEditorHost = require('../../electron/localEditorHost.cjs') as {
  installInResolve: (payload: Record<string, unknown>) => Promise<{
    success: boolean;
    installedPath: string;
    drfxPath: string | null;
    writtenCount: number;
  }>;
  installInPremiere: (payload: Record<string, unknown>) => Promise<{
    success: boolean;
    installedPath: string;
  }>;
};

describe('Adobe Premiere Pro packages, Local Editor Host, and Supabase security guards', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'framebase-host-test-'));
    process.env.FRAMEBASE_RESOLVE_TEMPLATES_DIR = join(tempRoot, 'ResolveTemplates');
    process.env.FRAMEBASE_PREMIERE_MOGRT_DIR = join(tempRoot, 'PremiereMogrt');
    process.env.FRAMEBASE_PREMIERE_PRESETS_DIR = join(tempRoot, 'PremierePresets');
    process.env.FRAMEBASE_TEMP_DIR = join(tempRoot, 'Temp');
    process.env.FRAMEBASE_DISABLE_SPAWN = '1';
  });

  afterEach(() => {
    delete process.env.FRAMEBASE_RESOLVE_TEMPLATES_DIR;
    delete process.env.FRAMEBASE_PREMIERE_MOGRT_DIR;
    delete process.env.FRAMEBASE_PREMIERE_PRESETS_DIR;
    delete process.env.FRAMEBASE_TEMP_DIR;
    delete process.env.FRAMEBASE_DISABLE_SPAWN;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('builds and roundtrips a Premiere Pro .mogrt Motion Graphics Template', async () => {
    const titlePreset = {
      ...starterPresets.find((item) => item.category === 'title')!,
      text: 'Capítulo Uno',
      curve: 'elastic' as const,
      positionX: 0.45,
      positionY: 0.62,
      scale: 1.3,
    };

    const mogrtBytes = createMogrtPackage(titlePreset);
    const entries = unzipSync(mogrtBytes);
    expect(entries['definition.json']).toBeDefined();
    expect(entries['thumb.svg']).toBeDefined();
    expect(entries['Framebase/manifest.json']).toBeDefined();

    const file = new File([mogrtBytes.slice().buffer], 'Capitulo_Uno.mogrt', { type: 'application/octet-stream' });
    const imported = await parsePresetFile(file, 'team-premiere');

    expect(imported.preset.target).toBe('premiere');
    expect(imported.preset.category).toBe('title');
    expect(imported.preset.text).toBe('Capítulo Uno');
    expect(imported.preset.curve).toBe('elastic');
    expect(imported.preset.scale).toBe(1.3);

    // Cross-target: converting an imported Premiere .mogrt to DaVinci Resolve .drfx generates a valid Fusion .setting
    const drfxArchive = unzipSync(createDrfx(imported.preset, imported.nativeFiles));
    expect(Object.keys(drfxArchive).some((entry) => entry.startsWith('Edit/Titles/') && entry.endsWith('.setting'))).toBe(true);
  });

  it('builds and roundtrips a Premiere Pro .prfpset transition/effect XML preset', async () => {
    const effectPreset = starterPresets.find((item) => item.category === 'effect')!;
    const prfpsetBytes = createPrfpsetPackage(effectPreset);
    const xml = strFromU8(prfpsetBytes);
    expect(xml).toContain('<PremiereData Version="3">');
    expect(xml).toContain(effectPreset.name);

    const file = new File([prfpsetBytes.slice().buffer], 'Resplandor.prfpset', { type: 'text/xml' });
    const imported = await parsePresetFile(file, 'team-premiere');
    expect(imported.preset.target).toBe('premiere');
    expect(imported.preset.category).toBe('effect');
    expect(imported.preset.name).toBe(effectPreset.name);

    const exported = exportPackageForTarget(effectPreset, [], 'premiere');
    expect(exported.extension).toBe('prfpset');
    expect(exported.fileName.endsWith('.prfpset')).toBe(true);
  });

  it('installs Resolve Free templates + .drfx bundle and Premiere .mogrt safely while blocking path traversal', async () => {
    const res = await localEditorHost.installInResolve({
      presetName: 'Primera luz',
      category: 'title',
      drfxBase64: Buffer.from('drfx-bundle').toString('base64'),
      nativeFiles: [
        { path: 'Edit/Titles/Primera_luz_title.setting', base64: Buffer.from('{ Tools = {} }').toString('base64') },
        { path: '../../../evil.setting', base64: Buffer.from('blocked').toString('base64') },
      ],
      openInResolve: true,
    });

    expect(res.success).toBe(true);
    expect(res.writtenCount).toBe(1);
    expect(existsSync(join(tempRoot, 'ResolveTemplates', 'Titles', 'Primera_luz_title.setting'))).toBe(true);
    expect(res.drfxPath && existsSync(res.drfxPath)).toBe(true);

    const premiereRes = await localEditorHost.installInPremiere({
      presetName: 'Subtítulo limpio',
      fileName: 'Subtitulo_limpio.mogrt',
      extension: 'mogrt',
      packageBase64: Buffer.from('mogrt-zip-bytes').toString('base64'),
    });
    expect(premiereRes.success).toBe(true);
    expect(readFileSync(premiereRes.installedPath, 'utf8')).toBe('mogrt-zip-bytes');
  });

  it('validates public Supabase keys and rejects private service_role or sb_secret_ keys', () => {
    expect(
      validatePublicCloudCredentials('https://demo-project.supabase.co', 'sb_publishable_1234567890abcdefghij').valid
    ).toBe(true);

    const secretCheck = validatePublicCloudCredentials('https://demo-project.supabase.co', 'sb_secret_99999999999999999999');
    expect(secretCheck.valid).toBe(false);
    expect(secretCheck.error).toMatch(/nunca uses una clave privada/i);

    const fakeServiceJwt = [
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
      btoa(JSON.stringify({ role: 'service_role', iss: 'supabase' })),
      'signature1234567890',
    ].join('.');
    const jwtCheck = validatePublicCloudCredentials('https://demo-project.supabase.co', fakeServiceJwt);
    expect(jwtCheck.valid).toBe(false);
    expect(jwtCheck.error).toMatch(/service_role/i);
  });

  it('exports and imports a multi-preset Premiere Pro ZIP pack (.mogrt + .prfpset)', async () => {
    const titlePreset = starterPresets.find((p) => p.id === 'preset-doc-serif-title')!;
    const effectPreset = starterPresets.find((p) => p.id === 'preset-halation-35mm')!;
    const zipBytes = createPremierePackZip(
      [
        { preset: titlePreset, nativeFiles: [] },
        { preset: effectPreset, nativeFiles: [] },
      ],
      'Coleccion Premiere'
    );

    const zipFile = new File([zipBytes.slice().buffer], 'Coleccion_Premiere.zip', { type: 'application/zip' });
    const imported = await parsePresetCollectionFile(zipFile, 'team-premiere');
    expect(imported).toHaveLength(2);
    expect(imported.every((entry) => entry.preset.target === 'premiere')).toBe(true);
    expect(imported.map((entry) => entry.preset.category).sort()).toEqual(['effect', 'title']);
  });

  it('tracks local preset version history and seeds v1 when customizing a starter preset', () => {
    localStorage.clear();
    const base = starterPresets.find((p) => p.id === 'preset-first-light')!;
    const v2 = {
      ...base,
      version: 2,
      name: 'Primera luz Editorial',
      fontFamily: 'Georgia' as const,
      updatedAt: new Date().toISOString(),
    };
    saveLocalPreset(v2);
    // Toggling favorite should not create duplicate version entries
    setLocalFavorite(base.id, true);

    const versions = listLocalPresetVersions(base.id, v2);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0].manifest.name).toBe('Primera luz Editorial');
    expect(versions[1].manifest.name).toBe('Primera luz');
  });

  it('compiles multi-layer EffectStack to Premiere .prfpset/.mogrt with full metadata roundtrip, 3D .cube feColorMatrix, and WAV SFX', async () => {
    const recipe = PRO_RECIPES[0];
    const sampleCube = [
      'TITLE "Kodak 2383 Test"',
      'LUT_3D_SIZE 2',
      '0.02 0.01 0.00',
      '0.98 0.08 0.04',
      '0.06 0.94 0.08',
      '0.96 0.94 0.10',
      '0.04 0.08 0.95',
      '0.95 0.10 0.92',
      '0.08 0.93 0.94',
      '0.97 0.96 0.93',
    ].join('\n');

    const stacked = {
      ...starterPresets[1],
      name: 'Premiere Stack Pro',
      layers: recipe.layers,
      bezier: recipe.bezier,
      timelinePhases: recipe.timelinePhases,
      audioSfx: recipe.audioSfx,
      aspectRatio: '9:16' as const,
      lutName: 'Kodak2383.cube',
      lutData: sampleCube,
      lutMix: 80,
    };

    const xmlBytes = createPrfpsetPackage(stacked);
    const xml = strFromU8(xmlBytes);
    expect(xml).toContain('AE.ADBE Motion');
    expect(xml).toContain('AE.ADBE Transform');
    expect(xml).toContain('PR.ADBE VR Chromatic Aberrations');
    expect(xml).toContain('<AutoScaleDuration>true</AutoScaleDuration>');
    expect(xml).toContain('<IntroEndTicks>');

    // Verify .mogrt roundtrips multi-layer stack, 9:16 resolution, audioSfx WAV, and .cube LUT
    const karaokeRecipe = PRO_RECIPES[2];
    const karaokeMogrt = createMogrtPackage({
      ...starterPresets.find((p) => p.category === 'subtitle')!,
      name: karaokeRecipe.name,
      layers: karaokeRecipe.layers,
      bezier: karaokeRecipe.bezier,
      timelinePhases: karaokeRecipe.timelinePhases,
      audioSfx: karaokeRecipe.audioSfx,
      aspectRatio: '9:16',
      lutName: 'Kodak2383.cube',
      lutData: sampleCube,
      lutMix: 70,
    });
    const mogrtEntries = unzipSync(karaokeMogrt);
    expect(mogrtEntries['Framebase/Audio/pop.wav']).toBeDefined();
    expect(mogrtEntries['Framebase/LUTs/Kodak2383.cube']).toBeDefined();

    const mogrtFile = new File([karaokeMogrt.slice().buffer], 'Karaoke.mogrt', {
      type: 'application/octet-stream',
    });
    const roundtrippedMogrt = await parsePresetFile(mogrtFile, 'team-premiere');
    expect(roundtrippedMogrt.preset.aspectRatio).toBe('9:16');
    expect(roundtrippedMogrt.preset.layers).toHaveLength(karaokeRecipe.layers.length);
    expect(roundtrippedMogrt.preset.audioSfx?.sfxId).toBe('pop');
    expect(roundtrippedMogrt.preset.lutName).toBe('Kodak2383.cube');

    const lut = parseCubeLut(sampleCube);
    expect(lut?.title).toBe('Kodak 2383 Test');
    expect(lut?.colorMatrix).toHaveLength(20);
    const matrixStr = interpolateLutMatrix(lut, 75);
    expect(matrixStr).not.toBeNull();
    expect(matrixStr!.split(' ')).toHaveLength(20);
    expect(evaluateLutCssFilter(lut, 75)).toContain('contrast(');

    const wav = buildSfxWavBytes('whoosh', -3);
    expect(strFromU8(wav.slice(0, 4))).toBe('RIFF');
    expect(strFromU8(wav.slice(8, 12))).toBe('WAVE');
    expect(generateSfxWaveformPeaks('impact', null, 12)).toHaveLength(12);
  });

  it('evaluates Typewriter Pro units (char, word, cipher), cursors, hideCursorOnComplete, backspace out, and roundtrips 9-point anchor & dual accent in .mogrt', async () => {
    const sample = 'NODO ACTIVO // 09';

    // 1. Char mode during In phase (50% easedIn)
    const charMid = evaluateTypewriterState(sample, 0.15, 0.3, 0.3, 0.25, 0.5, {
      typewriterUnit: 'char',
      cursorStyle: 'underscore',
      cursorBlinkHz: 2.5,
      humanJitter: 0,
    });
    expect(charMid.displayText.length).toBeGreaterThan(0);
    expect(charMid.displayText.length).toBeLessThan(sample.length);
    expect(charMid.cursorChar).toBe('_');
    expect(charMid.cursorVisible).toBe(true);

    // 2. Word mode reveals whole words cleanly
    const wordMid = evaluateTypewriterState('UNO DOS TRES CUATRO', 0.15, 0.3, 0.3, 0.25, 0.5, {
      typewriterUnit: 'word',
      cursorStyle: 'block',
    });
    expect(wordMid.displayText).toBe('UNO DOS');
    expect(wordMid.cursorChar).toBe('█');

    // 3. Cipher / Matrix Decode scrambles frontier glyphs in In phase, then locks cleanly in Sustain
    const cipherIn = evaluateTypewriterState('MATRIX CODE', 0.12, 0.4, 0.3, 0.25, 0.4, {
      typewriterUnit: 'cipher',
      cursorStyle: 'block',
      humanJitter: 0,
    });
    expect(cipherIn.displayText.startsWith('MATR')).toBe(true);
    expect(cipherIn.displayText.length).toBeGreaterThan(4);
    expect(cipherIn.displayText).not.toBe('MATRIX CODE'.slice(0, cipherIn.displayText.length));

    const cipherSustain = evaluateTypewriterState('MATRIX CODE', 0.5, 1.0, 0.3, 0.25, 1, {
      typewriterUnit: 'cipher',
      cursorStyle: 'bar',
      hideCursorOnComplete: true,
    });
    expect(cipherSustain.displayText).toBe('MATRIX CODE');
    expect(cipherSustain.cursorVisible).toBe(false);

    // 4. Backspace Out erases characters in reverse during Out phase
    const backspaceOut = evaluateTypewriterState('TERMINAL', 0.9, 2.2, 0.25, 0.2, 1, {
      typewriterUnit: 'char',
      outBehavior: 'backspace',
      humanJitter: 0,
    });
    expect(backspaceOut.displayText).toBe('TERM');
    expect(backspaceOut.opacityMult).toBe(1);

    // 5. 9-Point Anchor coordinate conversion & Premiere .mogrt roundtrip
    expect(anchorPointToPivot('top-left')).toEqual({
      fusionX: 0,
      fusionY: 1,
      cssX: 0,
      cssY: 0,
      cssOrigin: '0% 0%',
    });
    expect(anchorPointToPivot('bottom-right')).toEqual({
      fusionX: 1,
      fusionY: 0,
      cssX: 100,
      cssY: 100,
      cssOrigin: '100% 100%',
    });

    const twRecipe = PRO_RECIPES[4];
    const mogrtBytes = createMogrtPackage({
      ...starterPresets.find((p) => p.category === 'title')!,
      name: twRecipe.name,
      text: twRecipe.text,
      accent: twRecipe.accent,
      secondaryAccent: twRecipe.secondaryAccent,
      anchorPoint: 'bottom-left',
      rotationDeg: -4.5,
      layers: twRecipe.layers,
    });
    const entries = unzipSync(mogrtBytes);
    const defJson = JSON.parse(strFromU8(entries['definition.json']));
    expect(defJson.typewriterPro).toEqual(
      expect.objectContaining({
        unit: 'cipher',
        cursorStyle: 'block',
        outBehavior: 'backspace',
      })
    );
    expect(defJson.anchorPoint).toBe('bottom-left');
    expect(defJson.secondaryAccent).toBe('#7c5cff');

    const mogrtFile = new File([mogrtBytes.slice().buffer], 'Typewriter_Pro.mogrt', {
      type: 'application/octet-stream',
    });
    const roundtripped = await parsePresetFile(mogrtFile, 'team-premiere');
    expect(roundtripped.preset.anchorPoint).toBe('bottom-left');
    expect(roundtripped.preset.secondaryAccent).toBe('#7c5cff');
    expect(roundtripped.preset.rotationDeg).toBe(-4.5);
  });

  it('exports Premiere temporal <Keyframe> arrays, Crop MaskReveal, BlendMode & Pivot inside .prfpset XML and roundtrips .mogrt tracks', async () => {
    const effectBase = starterPresets.find((p) => p.category === 'effect')!;
    const animatedEffect: PresetRecord = {
      ...effectBase,
      name: 'Premiere Keyframed Rig',
      timelineMode: 'keyframes',
      pivotX: 0.35,
      pivotY: 0.65,
      keyframeTracks: [
        {
          id: 'pr-scale',
          property: 'scale',
          keyframes: [
            { id: 'k1', time: 0, value: 1, interpolation: 'bezier', bezier: [0.16, 1, 0.3, 1] },
            { id: 'k2', time: 1.2, value: 1.35, interpolation: 'hold' },
          ],
        },
        {
          id: 'pr-op',
          property: 'opacity',
          keyframes: [
            { id: 'op1', time: 0, value: 20, interpolation: 'linear' },
            { id: 'op2', time: 0.8, value: 100, interpolation: 'linear' },
          ],
        },
      ],
      layers: [
        {
          id: 'fx-glow',
          type: 'vfx',
          kind: 'glow',
          name: 'Glow LFO + Mask',
          enabled: true,
          intensity: 80,
          curve: 'ease-out',
          blendMode: 'add',
          maskReveal: { enabled: true, direction: 'bottom', featherPx: 20 },
          trimPaths: { enabled: true, startPct: 0, endPct: 85, offsetDeg: 15 },
          modulators: {
            wiggle: { enabled: true, target: 'scale', frequencyHz: 4, amplitude: 12, seed: 5 },
          },
          params: {},
        },
      ],
    };

    const xml = strFromU8(createPrfpsetPackage(animatedEffect));
    expect(xml).toContain('<TimelineMode>keyframes</TimelineMode>');
    expect(xml).toContain('<Pivot X="0.350" Y="0.650" />');
    expect(xml).toContain('<Keyframes Property="scale">');
    expect(xml).toContain('<Keyframe TimeTicks="0" TimeSeconds="0.000" Value="1.0000" Interpolation="Bezier"');
    expect(xml).toContain('<Keyframes Property="opacity">');
    expect(xml).toContain('ClassID="AE.ADBE Crop"');
    expect(xml).toContain('<BlendMode>add</BlendMode>');
    expect(xml).toContain('<TrimPaths StartPct="0" EndPct="85" OffsetDeg="15" />');

    const titleBase = starterPresets.find((p) => p.category === 'title')!;
    const mogrtBytes = createMogrtPackage({
      ...titleBase,
      name: 'MOGRT Dope Sheet',
      timelineMode: 'keyframes',
      pivotX: 0.4,
      pivotY: 0.6,
      keyframeTracks: animatedEffect.keyframeTracks,
    });
    const mogrtFile = new File([mogrtBytes.slice().buffer], 'MOGRT_Dope_Sheet.mogrt', {
      type: 'application/octet-stream',
    });
    const parsedMogrt = await parsePresetFile(mogrtFile, 'team-premiere');
    expect(parsedMogrt.preset.timelineMode).toBe('keyframes');
    expect(parsedMogrt.preset.pivotX).toBe(0.4);
    expect(parsedMogrt.preset.keyframeTracks).toHaveLength(2);
  });
});
