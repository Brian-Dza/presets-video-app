import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { PresetCategory, PresetRecord } from '../domain/preset';
import { applyModeFor, PRO_RECIPES } from '../domain/preset';
import { starterPresets } from '../data/starterPresets';
import { compileFusionMacroFromStack } from './nleCompiler';
import { createDrfx, createDrfxPack, parsePresetCollectionFile, parsePresetFile } from './presetFiles';
import { createFusionTemplate, templateFileName } from './templateFactory';

const FUSCRIPT_PATH = 'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe';
const SYSTEM_TEMPLATES_DRFX = 'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Fusion\\Templates\\Templates.drfx';

describe('Framebase Resolve packages and Fusion templates', () => {
  it('creates an installable DRFX folder layout for a starter title', () => {
    const preset = starterPresets.find((item) => item.category === 'title')!;
    const archive = unzipSync(createDrfx(preset, []));
    const paths = Object.keys(archive);

    expect(paths.some((path) => path.startsWith('Edit/Titles/') && path.endsWith('.setting'))).toBe(true);
    expect(paths).toContain('Framebase/manifest.json');
    expect(paths).toContain('Framebase/README.txt');
    expect(strFromU8(archive['Framebase/manifest.json'])).toContain('"category": "title"');
  });

  it('uses the preset text in the generated Fusion template', () => {
    const preset: PresetRecord = {
      ...starterPresets.find((item) => item.category === 'title')!,
      name: 'Opening line',
      text: 'The story begins',
      nativeFiles: [],
    };
    const archive = unzipSync(createDrfx(preset, []));
    const template = Object.entries(archive).find(([path]) => path.endsWith('.setting'))?.[1];
    expect(template).toBeDefined();
    expect(strFromU8(template!)).toContain('The story begins');
  });

  it('writes adaptable Fusion curves for fade titles, bounce stickers, and transitions', () => {
    const title = starterPresets.find((item) => item.category === 'title')!;
    const sticker = starterPresets.find((item) => item.category === 'sticker')!;
    const transition = starterPresets.find((item) => item.category === 'transition')!;

    const titleSetting = strFromU8(createFusionTemplate(title));
    const stickerSetting = strFromU8(createFusionTemplate(sticker));
    const transitionSetting = strFromU8(createFusionTemplate(transition));

    expect(titleSetting).toContain('RevealStretcher = KeyStretcherMod');
    expect(titleSetting).toContain('SourceStart = Input { Value = 0, }');
    expect(titleSetting).toContain('SourceEnd = Input { Value = 76, }');

    expect(stickerSetting).toContain('ScaleStretcher = KeyStretcherMod');
    expect(stickerSetting).toContain('Transform1 = Transform');
    expect(stickerSetting).toContain('Size = Input { Value = 0.068, }');

    expect(transitionSetting).toContain('Transitions = {');
    expect(transitionSetting).toContain('"DFTDissolve"');
    expect(transitionSetting).toContain('TransitionCurve = LUTLookup');
    expect(transitionSetting).toContain('Source = Input { Value = FuID { "Transition" }, }');
  });

  it('uses bottom-left Fusion coordinates, contrast-safe badge colors, and valid FuIDs', () => {
    const subtitle = starterPresets.find((item) => item.category === 'subtitle')!;
    const graphic = starterPresets.find((item) => item.category === 'graphic')!;
    const lightGraphic: PresetRecord = { ...graphic, accent: '#f8fafc' };
    const effect = starterPresets.find((item) => item.category === 'effect')!;

    const subtitleSetting = strFromU8(createFusionTemplate(subtitle));
    const graphicSetting = strFromU8(createFusionTemplate(graphic));
    const lightGraphicSetting = strFromU8(createFusionTemplate(lightGraphic));
    const effectSetting = strFromU8(createFusionTemplate(effect));

    expect(subtitleSetting).toContain('Center = Input { Value = { 0.5, 0.12 }, }');
    expect(graphicSetting).toContain('Center = Input { Value = { 0.24, 0.18 }, }');
    // Light badge (#f8fafc) gets high-contrast dark text rather than white-on-light.
    expect(lightGraphicSetting).toContain('Red1 = Input { Value = 0.0800, }');
    expect(effectSetting).toContain('Glow1 = SoftGlow');

    for (const preset of starterPresets) {
      const content = strFromU8(createFusionTemplate(preset));
      expect(content).not.toContain('FuID { "Background" }');
      expect(content).not.toContain('FuID { "Blend" }');
    }

    const softGlow = starterPresets.find((item) => item.id === 'preset-soft-glow')!;
    expect(`${softGlow.templateName}.setting`).toBe(templateFileName(softGlow));
  });

  it('imports a single Fusion setting file and classifies it', async () => {
    const setting = new File(['{ Tools = ordered() { } }'], 'Ripple_Transition.setting', { type: 'text/plain' });
    const imported = await parsePresetFile(setting, 'team-test');
    expect(imported.preset.category).toBe('transition');
    expect(imported.preset.teamId).toBe('team-test');
    expect(imported.nativeFiles).toHaveLength(1);
    expect(imported.nativeFiles[0].path).toBe('Edit/Transitions/Ripple_Transition.setting');
  });

  it('filters __MACOSX garbage and preserves relative Setting: asset subfolders across DRFX roundtrips', async () => {
    const bundleBytes = zipSync({
      '__MACOSX/Edit/Titles/Pack/._Hero_Title.setting': strToU8('appledouble-junk'),
      '__MACOSX/.DS_Store': strToU8('junk'),
      'Templates/Edit/Titles/Pack/Hero_Title.setting': strToU8('{ Tools = ordered() { Hero = TextPlus {} } }'),
      'Templates/Edit/Titles/Pack/Hero_Title.png': new Uint8Array([137, 80, 78, 71]),
      'Templates/Edit/Titles/Pack/Images/flare.exr': strToU8('exr-bytes'),
      'Templates/Edit/Titles/Pack/Models/logo.fbx': strToU8('fbx-bytes'),
      'Templates/Edit/Titles/Pack/LUTs/film.alut3': strToU8('lut-bytes'),
    });
    const file = new File([bundleBytes.slice().buffer], 'Editorial_Pack.drfx', { type: 'application/octet-stream' });
    const imported = await parsePresetFile(file, 'team-test');

    expect(imported.preset.category).toBe('title');
    expect(imported.preset.templateName).toBe('Hero_Title');
    const importedPaths = imported.nativeFiles.map((item) => item.path);
    expect(importedPaths).toEqual([
      'Edit/Titles/Pack/Hero_Title.setting',
      'Edit/Titles/Pack/Hero_Title.png',
      'Edit/Titles/Pack/Images/flare.exr',
      'Edit/Titles/Pack/Models/logo.fbx',
      'Edit/Titles/Pack/LUTs/film.alut3',
    ]);
    expect(imported.nativeFiles.find((item) => item.path.endsWith('Hero_Title.png'))?.role).toBe('preview');
    expect(imported.nativeFiles.find((item) => item.path.endsWith('flare.exr'))?.role).toBe('asset');

    const exported = unzipSync(createDrfx(imported.preset, imported.nativeFiles));
    expect(Object.keys(exported)).toEqual(expect.arrayContaining([
      'Framebase/manifest.json',
      'Framebase/README.txt',
      'Edit/Titles/Pack/Hero_Title.setting',
      'Edit/Titles/Pack/Hero_Title.png',
      'Edit/Titles/Pack/Images/flare.exr',
      'Edit/Titles/Pack/Models/logo.fbx',
      'Edit/Titles/Pack/LUTs/film.alut3',
    ]));
  });

  it('deserializes every starter and generated category/animation preset cleanly in Resolve fuscript', () => {
    if (!existsSync(FUSCRIPT_PATH)) return;

    const categories: PresetCategory[] = ['title', 'subtitle', 'graphic', 'sticker', 'transition', 'effect'];
    const animations = ['Desvanecer', 'Rebote', 'Zoom suave', 'Constante'];
    const curves = ['ease-out', 'ease-in-out', 'elastic', 'expo', 'linear'] as const;
    const transitionStyles = ['dissolve', 'flash', 'zoom', 'whip'] as const;
    const effectStyles = ['glow', 'halation', 'vignette'] as const;
    const syntheticPresets: PresetRecord[] = [];

    for (const category of categories) {
      animations.forEach((animation, animIdx) => {
        const curve = curves[(animIdx + categories.indexOf(category)) % curves.length];
        syntheticPresets.push({
          id: `synth-${category}-${animation}`,
          version: 1,
          teamId: 'team-verify',
          name: `Prueba ${category} ${animation}`,
          description: 'Verificación de plantilla Fusion',
          category,
          target: 'resolve',
          templateName: `Prueba_${category}_${animation}_${category}`,
          applyMode: applyModeFor(category),
          durationSeconds: animation === 'Rebote' ? 0.5 : 3.2,
          text: 'Línea "editorial" \\ prueba',
          accent: category === 'graphic' ? '#1b2430' : '#7c5cff',
          animation: category === 'transition' ? 'Fundido' : category === 'effect' ? 'Constante' : animation,
          curve,
          positionX: 0.42,
          positionY: 0.28,
          scale: 1.25,
          intensity: 1.1,
          spread: 20,
          fontFamily: animIdx % 2 === 0 ? 'Georgia' : 'Impact',
          tracking: 1.16,
          uppercase: animIdx % 2 === 0,
          shadow: animIdx % 2 === 0,
          backgroundBox: animIdx % 2 === 1,
          transitionStyle: category === 'transition' ? transitionStyles[animIdx % transitionStyles.length] : undefined,
          effectStyle: category === 'effect' ? effectStyles[animIdx % effectStyles.length] : undefined,
          tags: ['test'],
          author: 'Test',
          updatedAt: new Date().toISOString(),
          favorite: false,
          source: 'created',
          nativeFiles: [],
        });
      });
    }

    const tempDir = mkdtempSync(join(tmpdir(), 'framebase-fuscript-'));
    try {
      const allPresets = [...starterPresets, ...syntheticPresets];
      const fileList: string[] = [];
      allPresets.forEach((preset, index) => {
        const settingPath = join(tempDir, `${index}_${templateFileName(preset)}`);
        writeFileSync(settingPath, createFusionTemplate(preset));
        fileList.push(settingPath);
      });

      const manifestFile = join(tempDir, 'files.txt');
      writeFileSync(manifestFile, fileList.join('\n'), 'utf8');
      const luaScriptPath = join(tempDir, 'verify.lua');
      writeFileSync(luaScriptPath, [
        `local listFile = io.open(${JSON.stringify(manifestFile)}, "r")`,
        'local count = 0',
        'for line in listFile:lines() do',
        '  if #line > 0 then',
        '    local fh = assert(io.open(line, "rb"), "cannot open " .. line)',
        '    local content = fh:read("*all")',
        '    fh:close()',
        '    local parsed = bmd.readstring(content)',
        '    assert(type(parsed) == "table" and type(parsed.Tools) == "table", "invalid setting table in " .. line)',
        '    local active = parsed.ActiveTool',
        '    assert(type(active) == "string" and type(parsed.Tools[active]) == "table", "missing ActiveTool in " .. line)',
        '    local macro = parsed.Tools[active]',
        '    local innerTools = macro.Tools',
        '    assert(type(innerTools) == "table", "missing inner Tools in " .. line)',
        '    for inputKey, instInput in pairs(macro.Inputs or {}) do',
        '      if type(instInput) == "table" and instInput.SourceOp then',
        '        assert(innerTools[instInput.SourceOp] ~= nil, "dangling InstanceInput SourceOp " .. tostring(instInput.SourceOp) .. " in " .. line)',
        '      end',
        '    end',
        '    for outKey, instOut in pairs(macro.Outputs or {}) do',
        '      if type(instOut) == "table" and instOut.SourceOp then',
        '        assert(innerTools[instOut.SourceOp] ~= nil, "dangling InstanceOutput SourceOp " .. tostring(instOut.SourceOp) .. " in " .. line)',
        '      end',
        '    end',
        '    for toolName, toolDef in pairs(innerTools) do',
        '      if type(toolDef) == "table" and type(toolDef.Inputs) == "table" then',
        '        for paramName, paramDef in pairs(toolDef.Inputs) do',
        '          if type(paramDef) == "table" and paramDef.SourceOp then',
        '            assert(innerTools[paramDef.SourceOp] ~= nil, "dangling SourceOp " .. tostring(paramDef.SourceOp) .. " on " .. tostring(toolName) .. "." .. tostring(paramName) .. " in " .. line)',
        '          end',
        '        end',
        '      end',
        '    end',
        '    count = count + 1',
        '  end',
        'end',
        'listFile:close()',
        'print("VERIFIED_SETTINGS=" .. tostring(count))',
      ].join('\n'), 'utf8');

      const stdout = execFileSync(FUSCRIPT_PATH, [luaScriptPath], { encoding: 'utf8' });
      expect(stdout).toContain(`VERIFIED_SETTINGS=${allPresets.length}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('roundtrips a real multi-asset Resolve DRFX template while keeping Setting: relative assets intact', async () => {
    if (!existsSync(SYSTEM_TEMPLATES_DRFX)) return;

    const targetEntries = [
      'Edit/Generators/Stinger Transitions/Electro Vertical.setting',
      'Edit/Generators/Stinger Transitions/Electro Vertical.png',
      'Edit/Generators/Stinger Transitions/Images/SportsBackground_a.png',
      'Edit/Generators/Stinger Transitions/Images/DRAG LOGO HERE.png',
    ];
    const systemZip = unzipSync(new Uint8Array(readFileSync(SYSTEM_TEMPLATES_DRFX)), {
      filter: (file) => targetEntries.includes(file.name),
    });
    if (!systemZip[targetEntries[0]]) return;

    const sampleDrfx = zipSync(systemZip);
    const file = new File([sampleDrfx.slice().buffer], 'Electro_Vertical.drfx', { type: 'application/octet-stream' });
    const imported = await parsePresetFile(file, 'team-resolve-free');

    expect(imported.preset.category).toBe('graphic');
    expect(imported.preset.templateName).toBe('Electro Vertical');

    const roundtripped = unzipSync(createDrfx(imported.preset, imported.nativeFiles));
    for (const expectedPath of targetEntries) {
      expect(roundtripped[expectedPath]).toBeDefined();
    }
    const settingText = strFromU8(roundtripped[targetEntries[0]]);
    expect(settingText).toContain('Setting:/Images/SportsBackground_a.png');
    expect(settingText).toContain('Setting:/Images/DRAG LOGO HERE.png');
  });

  it('exports and imports a multi-preset DRFX collection pack with Pro typography and optical styles', async () => {
    const selected = [
      starterPresets.find((p) => p.id === 'preset-optic-zoom')!,
      starterPresets.find((p) => p.id === 'preset-halation-35mm')!,
      starterPresets.find((p) => p.id === 'preset-doc-serif-title')!,
    ];
    const packBytes = createDrfxPack(
      selected.map((preset) => ({ preset, nativeFiles: [] })),
      'Pack Cine Editorial'
    );

    const unzipped = unzipSync(packBytes);
    expect(unzipped['Framebase/pack.json']).toBeDefined();

    const packFile = new File([packBytes.slice().buffer], 'Pack_Cine_Editorial.drfx', {
      type: 'application/octet-stream',
    });
    const imported = await parsePresetCollectionFile(packFile, 'team-pack');
    expect(imported).toHaveLength(3);
    expect(imported.map((i) => i.preset.name)).toEqual([
      'Zoom óptico',
      'Halation 35mm',
      'Titular documental',
    ]);
    expect(imported[0].preset.transitionStyle).toBe('zoom');
    expect(imported[1].preset.effectStyle).toBe('halation');
    expect(imported[2].preset.fontFamily).toBe('Georgia');
    expect(imported[2].preset.shadow).toBe(true);
  });

  it('compiles all 5 multi-layer EffectStack PRO_RECIPES (including Typewriter Pro WriteOn, 9-point Pivot & Dual Accent) into valid Fusion macros verified by fuscript', async () => {
    const recipePresets: PresetRecord[] = PRO_RECIPES.map((recipe, idx) => ({
      id: `stack-recipe-${idx}`,
      version: 1,
      teamId: 'team-studio',
      name: recipe.name,
      description: recipe.description,
      category: recipe.category,
      target: 'resolve',
      templateName: `Recipe_${idx}`,
      applyMode: applyModeFor(recipe.category),
      durationSeconds: recipe.durationSeconds,
      text: recipe.text ?? 'Texto de prueba',
      accent: recipe.accent,
      secondaryAccent: recipe.secondaryAccent,
      anchorPoint: recipe.anchorPoint,
      animation: 'Multicapa',
      bezier: recipe.bezier,
      timelinePhases: recipe.timelinePhases,
      audioSfx: recipe.audioSfx,
      aspectRatio: recipe.aspectRatio,
      shadow: true,
      backgroundBox: recipe.category === 'subtitle' || idx === 4,
      plateRadius: 18,
      plateOpacity: 88,
      lutName: idx === 3 ? 'FilmPrint.cube' : undefined,
      lutData: idx === 3 ? 'TITLE "Film"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1' : undefined,
      lutMix: 80,
      layers: recipe.layers,
      tags: recipe.tags,
      author: 'Studio',
      updatedAt: new Date().toISOString(),
      favorite: false,
      source: 'created',
      nativeFiles: [],
    }));

    const firstLua = strFromU8(createFusionTemplate(recipePresets[0]));
    expect(firstLua).toContain('CameraShake');
    expect(firstLua).toContain('PrismBlur');
    expect(firstLua).toContain('DirectionalBlur');
    expect(firstLua).toContain('KeyframeStretcher');
    expect(firstLua).toContain('BezierSpline');

    const subtitleLua = strFromU8(createFusionTemplate(recipePresets[2]));
    expect(subtitleLua).toContain('PlateMerge1');
    expect(subtitleLua).toContain('TextShadow1');
    expect(subtitleLua).not.toContain('MainInput1 = InstanceInput');

    // Typewriter Pro recipe (index 4): WriteOn spline with backspace reverse keyframes, UserControls, Lua cursor Expression, 9-point Pivot & Dual Accent Horizontal gradient
    const typewriterLua = strFromU8(createFusionTemplate(recipePresets[4]));
    expect(typewriterLua).toContain('TextWriteOnSpline = BezierSpline');
    expect(typewriterLua).toContain('End = Input { SourceOp = "TextWriteOnSpline", Source = "Value", }');
    expect(typewriterLua).toContain('LINKS_Name = "Velocidad Escritura"');
    expect(typewriterLua).toContain('LINKS_Name = "Estilo Cursor"');
    expect(typewriterLua).toContain('LINKS_Name = "Cadencia"');
    expect(typewriterLua).toContain('TypewriterCursor1 = TextPlus');
    expect(typewriterLua).toContain('Pivot = Input { Value = { 0.000, 0.500 }, }');
    expect(typewriterLua).toContain('Type = Input { Value = FuID { "Horizontal" }, }');

    // DRFX roundtrip preserves secondaryAccent, anchorPoint, plateRadius & plateOpacity
    const twDrfxBytes = createDrfx(recipePresets[4], []);
    const twFile = new File([twDrfxBytes.slice().buffer], 'Terminal_Typewriter.drfx', {
      type: 'application/octet-stream',
    });
    const roundtrippedTw = await parsePresetFile(twFile, 'team-studio');
    expect(roundtrippedTw.preset.secondaryAccent).toBe('#7c5cff');
    expect(roundtrippedTw.preset.anchorPoint).toBe('middle-left');
    expect(roundtrippedTw.preset.plateRadius).toBe(18);
    expect(roundtrippedTw.preset.plateOpacity).toBe(88);

    const drfx = unzipSync(createDrfx(recipePresets[0], []));
    expect(drfx['Framebase/Audio/impact.wav']).toBeDefined();
    expect(strFromU8(drfx['Framebase/Audio/impact.wav'].slice(0, 4))).toBe('RIFF');

    const lutDrfx = unzipSync(createDrfx(recipePresets[3], []));
    expect(lutDrfx['Framebase/LUTs/FilmPrint.cube']).toBeDefined();

    if (!existsSync(FUSCRIPT_PATH)) return;
    const tempDir = mkdtempSync(join(tmpdir(), 'framebase-stack-fuscript-'));
    try {
      const paths: string[] = [];
      recipePresets.forEach((preset, idx) => {
        const settingPath = join(tempDir, `stack_${idx}.setting`);
        writeFileSync(settingPath, createFusionTemplate(preset));
        paths.push(settingPath);
      });
      const listPath = join(tempDir, 'stack_files.txt');
      writeFileSync(listPath, paths.join('\n'), 'utf8');
      const luaScriptPath = join(tempDir, 'verify_stack.lua');
      writeFileSync(
        luaScriptPath,
        [
          `local listFile = assert(io.open(${JSON.stringify(listPath)}, "r"))`,
          'local verified = 0',
          'for line in listFile:lines() do',
          '  if #line > 0 then',
          '    local fh = assert(io.open(line, "rb"))',
          '    local content = fh:read("*all")',
          '    fh:close()',
          '    local parsed = bmd.readstring(content)',
          '    assert(type(parsed) == "table" and type(parsed.Tools) == "table", "bad table in " .. line)',
          '    local macro = parsed.Tools[parsed.ActiveTool]',
          '    local innerTools = macro.Tools',
          '    for _, instInput in pairs(macro.Inputs or {}) do',
          '      if type(instInput) == "table" and instInput.SourceOp then',
          '        assert(innerTools[instInput.SourceOp] ~= nil, "dangling input SourceOp " .. tostring(instInput.SourceOp) .. " in " .. line)',
          '      end',
          '    end',
          '    for _, instOut in pairs(macro.Outputs or {}) do',
          '      if type(instOut) == "table" and instOut.SourceOp then',
          '        assert(innerTools[instOut.SourceOp] ~= nil, "dangling output SourceOp in " .. line)',
          '      end',
          '    end',
          '    for _, toolDef in pairs(innerTools) do',
          '      if type(toolDef) == "table" and type(toolDef.Inputs) == "table" then',
          '        for _, paramDef in pairs(toolDef.Inputs) do',
          '          if type(paramDef) == "table" and paramDef.SourceOp then',
          '            assert(innerTools[paramDef.SourceOp] ~= nil, "dangling SourceOp " .. tostring(paramDef.SourceOp) .. " in " .. line)',
          '          end',
          '        end',
          '      end',
          '    end',
          '    verified = verified + 1',
          '  end',
          'end',
          'listFile:close()',
          'print("STACK_OK=" .. tostring(verified))',
        ].join('\n'),
        'utf8'
      );
      const stdout = execFileSync(FUSCRIPT_PATH, [luaScriptPath], { encoding: 'utf8' });
      expect(stdout).toContain(`STACK_OK=${recipePresets.length}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('compiles multi-track keyframes (XYPath/StepIn/Spring), Perturb wiggle, Lua LFO, BlendMode, MaskReveal and TrimPaths into valid Fusion Lua', async () => {
    const base = starterPresets.find((item) => item.category === 'title')!;
    const studioPreset: PresetRecord = {
      ...base,
      id: 'v2-motion-studio',
      name: 'Studio Motion Rig',
      timelineMode: 'keyframes',
      pivotX: 0.25,
      pivotY: 0.75,
      keyframeTracks: [
        {
          id: 'trk-x',
          property: 'positionX',
          keyframes: [
            { id: 'x1', time: 0, value: 0.2, interpolation: 'bezier', bezier: [0.16, 1, 0.3, 1] },
            { id: 'x2', time: 1.5, value: 0.8, interpolation: 'spring', spring: { stiffness: 300, damping: 14, mass: 1 } },
          ],
        },
        {
          id: 'trk-y',
          property: 'positionY',
          keyframes: [
            { id: 'y1', time: 0, value: 0.3, interpolation: 'hold' },
            { id: 'y2', time: 1.5, value: 0.7, interpolation: 'linear' },
          ],
        },
        {
          id: 'trk-op',
          property: 'opacity',
          keyframes: [
            { id: 'o1', time: 0, value: 0, interpolation: 'linear' },
            { id: 'o2', time: 0.5, value: 100, interpolation: 'linear' },
          ],
        },
      ],
      layers: [
        {
          id: 'layer-typo',
          type: 'typography',
          kind: 'fade-slide',
          name: 'Título Compuesto',
          enabled: true,
          intensity: 85,
          curve: 'ease-out',
          blendMode: 'screen',
          trimPaths: { enabled: true, startPct: 0, endPct: 100, offsetDeg: 0 },
          maskReveal: { enabled: true, direction: 'left', featherPx: 18 },
          modulators: {
            spring: { enabled: true, stiffness: 320, damping: 14, mass: 1 },
            wiggle: { enabled: true, target: 'rotation', frequencyHz: 3, amplitude: 25, seed: 9 },
            lfo: {
              enabled: true,
              waveform: 'sine',
              target: 'glow',
              syncMode: 'bpm',
              frequencyHz: 2,
              bpm: 120,
              beatDivision: '1/4',
              amplitude: 40,
            },
          },
          params: {},
        },
      ],
    };

    const settingCode = compileFusionMacroFromStack(studioPreset);
    expect(settingCode).toContain('CenterXYPath = XYPath');
    expect(settingCode).toContain('MotionPathX = BezierSpline');
    expect(settingCode).toContain('StepIn = true');
    expect(settingCode).toContain('PerturbMod');
    expect(settingCode).toContain('math.sin');
    expect(settingCode).toContain('FuID { "Screen" }');
    expect(settingCode).toContain('RevealMask_');
    expect(settingCode).toContain('TrimStrokeMask_');
    expect(settingCode).not.toContain('FuID { "Background" }');
    expect(settingCode).not.toContain('FuID { "Blend" }');

    // Verify DRFX archive roundtrip keeps keyframeTracks, timelineMode, pivot & modulators
    const drfxBytes = createDrfx(studioPreset, []);
    const drfxFile = new File([drfxBytes.slice().buffer], 'Studio_Motion_Rig.drfx', {
      type: 'application/octet-stream',
    });
    const roundtripped = await parsePresetFile(drfxFile, 'team-1');
    expect(roundtripped.preset.timelineMode).toBe('keyframes');
    expect(roundtripped.preset.pivotX).toBe(0.25);
    expect(roundtripped.preset.keyframeTracks).toHaveLength(3);
    expect(roundtripped.preset.layers?.[0].blendMode).toBe('screen');
    expect(roundtripped.preset.layers?.[0].modulators?.wiggle?.enabled).toBe(true);

    if (!existsSync(FUSCRIPT_PATH)) return;
    const tempDir = mkdtempSync(join(tmpdir(), 'framebase-v2-fuscript-'));
    try {
      const settingPath = join(tempDir, 'v2_motion.setting');
      writeFileSync(settingPath, settingCode, 'utf8');
      const luaScriptPath = join(tempDir, 'verify_v2.lua');
      writeFileSync(
        luaScriptPath,
        [
          `local fh = assert(io.open(${JSON.stringify(settingPath)}, "rb"))`,
          'local content = fh:read("*all")',
          'fh:close()',
          'local parsed = bmd.readstring(content)',
          'assert(type(parsed) == "table" and type(parsed.Tools) == "table", "bad macro")',
          'local macro = parsed.Tools[parsed.ActiveTool]',
          'local innerTools = macro.Tools',
          'for _, instOut in pairs(macro.Outputs or {}) do',
          '  if type(instOut) == "table" and instOut.SourceOp then',
          '    assert(innerTools[instOut.SourceOp] ~= nil, "dangling output SourceOp")',
          '  end',
          'end',
          'for _, toolDef in pairs(innerTools) do',
          '  if type(toolDef) == "table" and type(toolDef.Inputs) == "table" then',
          '    for _, paramDef in pairs(toolDef.Inputs) do',
          '      if type(paramDef) == "table" and paramDef.SourceOp then',
          '        assert(innerTools[paramDef.SourceOp] ~= nil, "dangling SourceOp " .. tostring(paramDef.SourceOp))',
          '      end',
          '    end',
          '  end',
          'end',
          'print("V2_FUSION_OK")',
        ].join('\n'),
        'utf8'
      );
      const stdout = execFileSync(FUSCRIPT_PATH, [luaScriptPath], { encoding: 'utf8' });
      expect(stdout).toContain('V2_FUSION_OK');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
