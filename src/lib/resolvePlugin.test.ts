import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PLUGIN_ID,
  normalizeVersion,
  sanitizeRelativeSegments,
  createResolvePluginController,
} = require('../../resolve-plugin/main.js');

describe('DaVinci Resolve Studio Workflow Integration controller', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'framebase-resolve-plugin-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('normalizes Resolve version arrays and strings safely', () => {
    expect(normalizeVersion([21, 2, 0, 6, ''])).toBe('21.2.0.6');
    expect(normalizeVersion('21.1.2')).toBe('21.1.2');
    expect(normalizeVersion(undefined)).toBeUndefined();
  });

  it('preserves nested Setting: asset paths and blocks traversal or __MACOSX files', () => {
    expect(sanitizeRelativeSegments('Edit/Titles/Pack/Images/flare.exr')).toEqual(['Pack', 'Images', 'flare.exr']);
    expect(sanitizeRelativeSegments('Templates/Edit/Effects/Glow.setting')).toEqual(['Glow.setting']);
    expect(sanitizeRelativeSegments('../../../Windows/System32/evil.setting')).toBeNull();
    expect(sanitizeRelativeSegments('__MACOSX/Edit/Titles/._Hero.setting')).toBeNull();
  });

  it('connects once across concurrent calls, normalizes GetVersion arrays, and saves via ProjectManager', async () => {
    const SaveProject = vi.fn().mockResolvedValue(true);
    const InitializePromise = vi.fn().mockResolvedValue(true);
    const GetResolvePromise = vi.fn().mockResolvedValue({
      GetVersion: vi.fn().mockResolvedValue([21, 2, 0, 6, '']),
      GetProjectManager: vi.fn().mockResolvedValue({
        SaveProject,
        GetCurrentProject: vi.fn().mockResolvedValue({
          GetName: vi.fn().mockResolvedValue('Documental Caribe'),
          GetCurrentTimeline: vi.fn().mockResolvedValue({
            GetName: vi.fn().mockResolvedValue('Corte 01'),
            GetSelectedClips: vi.fn().mockResolvedValue([{}, {}]),
            GetCurrentTimecode: vi.fn().mockResolvedValue('01:00:12:08'),
          }),
        }),
      }),
    });

    const controller = createResolvePluginController({
      templateRoot: tempRoot,
      getWorkflowIntegration: () => ({ InitializePromise, GetResolvePromise, CleanUp: vi.fn() }),
    });

    const [firstContext, secondContext] = await Promise.all([
      controller.getContext(),
      controller.getContext(),
    ]);

    expect(InitializePromise).toHaveBeenCalledTimes(1);
    expect(InitializePromise).toHaveBeenCalledWith(PLUGIN_ID);
    expect(firstContext).toEqual({
      connected: true,
      version: '21.2.0.6',
      projectName: 'Documental Caribe',
      timelineName: 'Corte 01',
      selectedClipCount: 2,
      playheadTimecode: '01:00:12:08',
    });
    expect(secondContext.version).toBe('21.2.0.6');
    expect(await controller.saveProject()).toBe(true);
    expect(SaveProject).toHaveBeenCalledTimes(1);
  });

  it('inserts titles, generators, transitions, and Fusion .setting/.comp clip effects', async () => {
    const AddTransition = vi.fn()
      .mockResolvedValueOnce(null) // Custom Fusion transition not yet indexed -> falls back to Cross Dissolve
      .mockResolvedValueOnce({ id: 'transition-item' });
    const AddEffect = vi.fn().mockResolvedValue({ id: 'effect-item' });
    const ImportFusionComp = vi.fn().mockResolvedValue({ id: 'comp-item' });
    const InsertFusionTitleIntoTimeline = vi.fn().mockResolvedValue({ id: 'title-item' });
    const InsertFusionGeneratorIntoTimeline = vi.fn().mockResolvedValue({ id: 'generator-item' });

    const currentClip = { AddTransition, AddEffect, ImportFusionComp };
    const timeline = {
      GetSettings: vi.fn().mockResolvedValue({ timelineFrameRate: 30 }),
      GetSelectedClips: vi.fn().mockResolvedValue([currentClip]),
      InsertFusionTitleIntoTimeline,
      InsertFusionGeneratorIntoTimeline,
    };

    const controller = createResolvePluginController({
      templateRoot: tempRoot,
      getWorkflowIntegration: () => ({
        InitializePromise: vi.fn().mockResolvedValue(true),
        GetResolvePromise: vi.fn().mockResolvedValue({
          GetVersionString: vi.fn().mockResolvedValue('21.2.0.6'),
          GetEffectsList: vi.fn().mockResolvedValue([
            { category: 'ofx', id: 'com.blackmagicdesign.ofx.glow', name: 'Glow' },
            { category: 'fusion', id: 'fusion.Resplandor_suave_effect', name: 'Resplandor_suave_effect' },
          ]),
          GetProjectManager: vi.fn().mockResolvedValue({
            GetCurrentProject: vi.fn().mockResolvedValue({
              GetCurrentTimeline: vi.fn().mockResolvedValue(timeline),
            }),
          }),
        }),
      }),
    });

    // 1. Title insertion + nested bundled asset installation
    const titleResult = await controller.applyPreset(null, {
      id: 'preset-first-light',
      name: 'Primera luz',
      category: 'title',
      applyMode: 'overlay',
      templateName: 'Primera_luz_title',
      durationSeconds: 3.2,
      nativeFiles: [
        { path: 'Edit/Titles/Pack/Primera_luz_title.setting', base64: Buffer.from('{ Tools = {} }').toString('base64') },
        { path: 'Edit/Titles/Pack/Images/grain.exr', base64: Buffer.from('exr-data').toString('base64') },
      ],
    });
    expect(titleResult.success).toBe(true);
    expect(InsertFusionTitleIntoTimeline).toHaveBeenCalledWith('Primera_luz_title');
    const nestedAsset = join(tempRoot, 'Titles', 'Pack', 'Images', 'grain.exr');
    expect(existsSync(nestedAsset)).toBe(true);
    expect(readFileSync(nestedAsset, 'utf8')).toBe('exr-data');

    // 2. Sticker / generator insertion
    const stickerResult = await controller.applyPreset(null, {
      id: 'preset-sunburst',
      name: 'Sol de bolsillo',
      category: 'sticker',
      applyMode: 'overlay',
      templateName: 'Sol_de_bolsillo_sticker',
      durationSeconds: 1.6,
      nativeFiles: [],
    });
    expect(stickerResult.success).toBe(true);
    expect(InsertFusionGeneratorIntoTimeline).toHaveBeenCalledWith('Sol_de_bolsillo_sticker');

    // 3. Transition uses timeline FPS (0.8s * 30fps = 24 frames) and falls back cleanly for starter Cross Dissolve
    const transitionResult = await controller.applyPreset(null, {
      id: 'preset-prism-sweep',
      name: 'Barrido prismático',
      category: 'transition',
      applyMode: 'transition',
      templateName: 'Cross Dissolve',
      durationSeconds: 0.8,
      nativeFiles: [
        { path: 'Edit/Transitions/Barrido_prismatico_transition.setting', base64: Buffer.from('{}').toString('base64') },
      ],
    });
    expect(transitionResult.success).toBe(true);
    expect(AddTransition).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'Barrido_prismatico_transition',
      category: 'fusion',
      duration: 24,
    }));
    expect(AddTransition).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'Cross Dissolve',
      category: 'simple',
      duration: 24,
    }));

    // 4. Fusion .setting clip effect applied via Resolve 21 GetEffectsList + AddEffect
    const effectResult = await controller.applyPreset(null, {
      id: 'preset-soft-glow',
      name: 'Resplandor suave',
      category: 'effect',
      applyMode: 'clip-effect',
      templateName: 'Resplandor_suave_effect',
      durationSeconds: 2.4,
      nativeFiles: [
        { path: 'Edit/Effects/Resplandor_suave_effect.setting', base64: Buffer.from('{}').toString('base64') },
      ],
    });
    expect(effectResult.success).toBe(true);
    expect(AddEffect).toHaveBeenCalledWith('fusion', 'fusion.Resplandor_suave_effect');

    // 5. Fusion .comp clip effect applied via ImportFusionComp
    const compResult = await controller.applyPreset(null, {
      id: 'preset-comp-fx',
      name: 'Grano 16mm',
      category: 'effect',
      applyMode: 'clip-effect',
      templateName: 'Grano_16mm',
      durationSeconds: 2.0,
      nativeFiles: [
        { path: 'Edit/Effects/Grano_16mm.comp', base64: Buffer.from('Composition {}').toString('base64') },
      ],
    });
    expect(compResult.success).toBe(true);
    expect(ImportFusionComp).toHaveBeenCalledTimes(1);
  });
});
