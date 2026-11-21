import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { NativeFile, PresetCategory, PresetManifest, PresetRecord } from '../domain/preset';
import { applyModeFor, categoryLabels, defaultCurveFor, defaultPositionFor, isPresetCategory } from '../domain/preset';
import { buildSfxWavBytes } from './audioSfx';
import { compilePremiereStackXml } from './nleCompiler';
import { safePresetFileName } from './templateFactory';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hexToNormalizedRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3 ? [...cleaned].map((part) => `${part}${part}`).join('') : cleaned;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) return [0.486, 0.361, 1];
  return [
    Number(((parsed >> 16 & 255) / 255).toFixed(4)),
    Number(((parsed >> 8 & 255) / 255).toFixed(4)),
    Number(((parsed & 255) / 255).toFixed(4)),
  ];
}

function normalizedRgbToHex(rgb: unknown): string | undefined {
  if (!Array.isArray(rgb) || rgb.length < 3) return undefined;
  const channels = rgb.slice(0, 3).map((item) => {
    const n = Number(item);
    if (!Number.isFinite(n)) return 124;
    const scaled = n <= 1 ? Math.round(n * 255) : Math.round(n);
    return Math.min(255, Math.max(0, scaled));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function premierePackageExtension(category: PresetCategory): 'mogrt' | 'prfpset' {
  return ['title', 'subtitle', 'graphic', 'sticker'].includes(category) ? 'mogrt' : 'prfpset';
}

export function premierePackageFileName(preset: Pick<PresetRecord, 'name' | 'category'>): string {
  return `${safePresetFileName(preset.name)}.${premierePackageExtension(preset.category)}`;
}

function buildManifest(preset: PresetRecord, files: Array<{ path: string; role: NativeFile['role'] }>): PresetManifest {
  return {
    formatVersion: 1,
    id: preset.id,
    version: preset.version,
    name: preset.name,
    description: preset.description,
    category: preset.category,
    target: 'premiere',
    templateName: preset.templateName,
    applyMode: preset.applyMode,
    durationSeconds: preset.durationSeconds,
    text: preset.text,
    accent: preset.accent,
    secondaryAccent: preset.secondaryAccent,
    animation: preset.animation,
    curve: preset.curve ?? defaultCurveFor(preset.category, preset.animation),
    positionX: preset.positionX,
    positionY: preset.positionY,
    anchorPoint: preset.anchorPoint,
    pivotX: preset.pivotX,
    pivotY: preset.pivotY,
    rotationDeg: preset.rotationDeg,
    scale: preset.scale,
    intensity: preset.intensity,
    spread: preset.spread,
    fontFamily: preset.fontFamily,
    tracking: preset.tracking,
    uppercase: preset.uppercase,
    shadow: preset.shadow,
    backgroundBox: preset.backgroundBox,
    plateRadius: preset.plateRadius,
    plateOpacity: preset.plateOpacity,
    transitionStyle: preset.transitionStyle,
    effectStyle: preset.effectStyle,
    layers: preset.layers,
    bezier: preset.bezier,
    timelineMode: preset.timelineMode,
    keyframeTracks: preset.keyframeTracks,
    timelinePhases: preset.timelinePhases,
    audioSfx: preset.audioSfx,
    aspectRatio: preset.aspectRatio,
    lutName: preset.lutName,
    lutMix: preset.lutMix,
    lutData: preset.lutData,
    tags: preset.tags,
    files,
  };
}

function createThumbnailSvg(preset: PresetRecord): Uint8Array {
  const label = escapeXml(preset.text || preset.name);
  const badge = escapeXml(categoryLabels[preset.category].toUpperCase());
  const accent = escapeXml(preset.accent || '#7c5cff');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#111629"/>
      <stop offset="55%" stop-color="#0b0e18"/>
      <stop offset="100%" stop-color="#17122a"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="470" cy="110" r="110" fill="${accent}" fill-opacity="0.22"/>
  <rect x="36" y="30" rx="6" ry="6" width="128" height="26" fill="#ffffff" fill-opacity="0.08" stroke="${accent}" stroke-opacity="0.5"/>
  <text x="100" y="47" text-anchor="middle" fill="${accent}" font-family="Segoe UI, Arial, sans-serif" font-size="11" font-weight="700">${badge}</text>
  <text x="320" y="192" text-anchor="middle" fill="#f8fafc" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700">${label}</text>
  <rect x="276" y="212" width="88" height="4" rx="2" fill="${accent}"/>
</svg>`;
  return strToU8(svg);
}

export function createMogrtPackage(preset: PresetRecord): Uint8Array {
  const frames = Math.max(12, Math.round(preset.durationSeconds * 24));
  const defaultPos = defaultPositionFor(preset.category);
  const posX = Number((preset.positionX ?? defaultPos.x).toFixed(4));
  const posY = Number((preset.positionY ?? defaultPos.y).toFixed(4));
  const scale = Number((preset.scale ?? 1).toFixed(2));
  const rgb = hexToNormalizedRgb(preset.accent);
  const ratio = preset.aspectRatio ?? '16:9';
  const dims =
    ratio === '9:16'
      ? { width: 1080, height: 1920 }
      : ratio === '4:5'
        ? { width: 1080, height: 1350 }
        : ratio === '1:1'
          ? { width: 1080, height: 1080 }
          : { width: 1920, height: 1080 };

  const filesMeta: Array<{ path: string; role: NativeFile['role'] }> = [
    { path: 'definition.json', role: 'template' },
    { path: 'thumb.svg', role: 'preview' },
  ];
  const archive: Record<string, Uint8Array> = {};

  if (preset.audioSfx && preset.audioSfx.sfxId !== 'none' && preset.audioSfx.sfxId !== 'custom') {
    const sfxPath = `Framebase/Audio/${preset.audioSfx.sfxId}.wav`;
    archive[sfxPath] = buildSfxWavBytes(preset.audioSfx.sfxId, preset.audioSfx.gainDb);
    filesMeta.push({ path: sfxPath, role: 'asset' });
  }
  if (preset.lutData && preset.lutName) {
    const lutPath = `Framebase/LUTs/${safePresetFileName(preset.lutName.replace(/\.cube$/i, ''))}.cube`;
    archive[lutPath] = strToU8(preset.lutData);
    filesMeta.push({ path: lutPath, role: 'asset' });
  }

  const manifest = buildManifest(preset, filesMeta);
  const inFrames = Math.round(frames * (preset.timelinePhases?.inRatio ?? 0.25));
  const outFrames = Math.round(frames * (preset.timelinePhases?.outRatio ?? 0.25));
  const typewriterLayer = (preset.layers ?? []).find((l) => l.enabled && l.type === 'typography' && l.kind === 'typewriter');

  const definition = {
    apiVersion: '2.1',
    capsuleID: preset.id,
    capsuleName: preset.name,
    capsuleDescription: preset.description,
    author: preset.author || 'Framebase',
    hostApp: 'Premiere Pro',
    frameRate: 24,
    duration: frames,
    width: dims.width,
    height: dims.height,
    aspectRatio: ratio,
    category: preset.category,
    anchorPoint: preset.anchorPoint ?? 'center',
    secondaryAccent: preset.secondaryAccent,
    typewriterPro: typewriterLayer
      ? {
          unit: typewriterLayer.params.typewriterUnit ?? 'char',
          cursorStyle: typewriterLayer.params.cursorStyle ?? 'bar',
          cursorBlinkHz: Number(typewriterLayer.params.cursorBlinkHz ?? 2.5),
          cursorColorMode: typewriterLayer.params.cursorColorMode ?? 'accent',
          hideCursorOnComplete: Boolean(typewriterLayer.params.hideCursorOnComplete),
          humanJitter: Number(typewriterLayer.params.humanJitter ?? 25),
          outBehavior: typewriterLayer.params.outBehavior ?? 'backspace',
          autoTypingSfx: Boolean(typewriterLayer.params.autoTypingSfx),
        }
      : undefined,
    responsiveDesignTime: {
      enabled: preset.timelinePhases?.autoScaleDuration !== false,
      introDurationFrames: inFrames,
      outroDurationFrames: outFrames,
    },
    animation: {
      entrance: preset.animation,
      curve: manifest.curve,
      bezier: preset.bezier,
      durationSeconds: preset.durationSeconds,
    },
    effectStack: (preset.layers ?? []).filter((l) => l.enabled),
    clientControls: [
      {
        id: 'ctrl-source-text',
        uiName: { strDB: [{ localeString: 'es_ES', str: 'Texto' }] },
        type: 6,
        value: { str: preset.text || preset.name },
      },
      {
        id: 'ctrl-scale',
        uiName: { strDB: [{ localeString: 'es_ES', str: 'Escala' }] },
        type: 2,
        min: 0.5,
        max: 2.0,
        value: scale,
      },
      {
        id: 'ctrl-accent-color',
        uiName: { strDB: [{ localeString: 'es_ES', str: 'Color de acento' }] },
        type: 4,
        value: [...rgb, 1],
      },
      {
        id: 'ctrl-position',
        uiName: { strDB: [{ localeString: 'es_ES', str: 'Posición (X, Y)' }] },
        type: 3,
        value: [posX, posY],
      },
    ],
    framebase: manifest,
  };

  archive['definition.json'] = strToU8(JSON.stringify(definition, null, 2));
  archive['thumb.svg'] = createThumbnailSvg(preset);
  archive['Framebase/manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  archive['Framebase/README.txt'] = strToU8(
    'Framebase Presets — Motion Graphics Template (.mogrt)\r\n\r\nImporta este archivo desde el panel Gráficos esenciales de Adobe Premiere Pro o instálalo directamente desde Framebase.\r\n'
  );

  return zipSync(archive, { level: 6 });
}

export function createPrfpsetPackage(preset: PresetRecord): Uint8Array {
  const fileName = premierePackageFileName(preset);
  const manifest = buildManifest(preset, [{ path: fileName, role: 'template' }]);
  const matchName = preset.category === 'transition' ? 'ADBE Cross Dissolve' : 'ADBE Lumetri';
  const intensity = Number((preset.intensity ?? 0.85).toFixed(2));
  const spread = Number((preset.spread ?? 14).toFixed(1));
  const curve = manifest.curve ?? 'ease-in-out';
  const encodedManifest = JSON.stringify(manifest).replace(/--/g, '- -');
  const stackXml = preset.layers?.some((layer) => layer.enabled)
    ? compilePremiereStackXml(preset)
        .replace(/<\?xml[^?]*\?>\s*/i, '')
        .replace(/<\/?PremiereData[^>]*>/gi, '')
        .trim()
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- FRAMEBASE_MANIFEST:${encodedManifest} -->
<PremiereData Version="3">
  <Tree ObjectRef="1"/>
  <Tree ObjectID="1" ClassID="177f2841-dd5b-43bd-9d9a-79e231bd47dd" Version="1">
    <RootBin ObjectRef="2"/>
  </Tree>
  <BinTreeItem ObjectID="2" ClassID="5e0f46fa-384f-4c09-bc53-0b8e2b7005b5" Version="4">
    <TreeItemBase Version="4">
      <Name>Framebase Presets</Name>
    </TreeItemBase>
    <Items Version="1">
      <Item Index="0" ObjectRef="3"/>
    </Items>
  </BinTreeItem>
  <FilterPresetItem ObjectID="3" ClassID="e56c9ba0-91cb-4f21-9174-c1b52448c6c9" Version="2">
    <TreeItemBase Version="4">
      <Name>${escapeXml(preset.name)}</Name>
    </TreeItemBase>
    <FilterPreset Version="3">
      <Description>${escapeXml(preset.description)}</Description>
      <MatchName>${matchName}</MatchName>
      <Type>${preset.category === 'transition' ? 'Transition' : 'Effect'}</Type>
      <Speed>${Number(preset.durationSeconds.toFixed(2))}</Speed>
      <Parameters>
        <Parameter Name="Intensity" Value="${intensity}"/>
        <Parameter Name="Feather" Value="${spread}"/>
        <Parameter Name="AccentColor" Value="${escapeXml(preset.accent)}"/>
        <Parameter Name="Curve" Value="${escapeXml(curve)}"/>
      </Parameters>
    </FilterPreset>
  </FilterPresetItem>
${stackXml}
</PremiereData>
`;
  return strToU8(xml);
}

export function createPremierePackage(preset: PresetRecord): Uint8Array {
  return premierePackageExtension(preset.category) === 'mogrt'
    ? createMogrtPackage(preset)
    : createPrfpsetPackage(preset);
}

export function parsePremiereBytes(
  fileName: string,
  bytes: Uint8Array,
  teamId: string
): { preset: PresetRecord; nativeFiles: NativeFile[] } {
  const lowerName = fileName.toLowerCase();
  const cleanFileStem = fileName.replace(/\.(mogrt|prfpset)$/i, '').replace(/[_-]+/g, ' ').trim();

  if (lowerName.endsWith('.mogrt')) {
    const entries = unzipSync(bytes);
    let manifest: Partial<PresetManifest> | undefined;
    const manifestEntry = Object.entries(entries).find(([entryPath]) => entryPath.toLowerCase().endsWith('manifest.json'));
    if (manifestEntry) {
      try {
        manifest = JSON.parse(strFromU8(manifestEntry[1])) as Partial<PresetManifest>;
      } catch {
        manifest = undefined;
      }
    }

    let definition: Record<string, unknown> | undefined;
    const definitionEntry = Object.entries(entries).find(([entryPath]) => entryPath.toLowerCase().endsWith('definition.json'));
    if (definitionEntry) {
      try {
        definition = JSON.parse(strFromU8(definitionEntry[1])) as Record<string, unknown>;
      } catch {
        definition = undefined;
      }
    }

    if (!manifest && !definition) {
      throw new Error('El paquete .mogrt no contiene un archivo definition.json válido.');
    }

    const controls = Array.isArray(definition?.clientControls)
      ? (definition.clientControls as Array<Record<string, unknown>>)
      : [];
    const textControl = controls.find((ctrl) => ctrl.type === 6);
    const colorControl = controls.find((ctrl) => ctrl.type === 4);
    const scaleControl = controls.find((ctrl) => ctrl.id === 'ctrl-scale' || ctrl.type === 2);

    const rawCategory = String(manifest?.category ?? definition?.category ?? '');
    const category: PresetCategory = isPresetCategory(rawCategory)
      ? rawCategory
      : lowerName.includes('sub') || lowerName.includes('caption')
        ? 'subtitle'
        : lowerName.includes('sticker')
          ? 'sticker'
          : lowerName.includes('lower') || lowerName.includes('label')
            ? 'graphic'
            : 'title';

    const frameRate = Number(definition?.frameRate ?? 24) || 24;
    const durationFrames = Number(definition?.duration ?? 0);
    const durationFromDef = durationFrames > 0 ? Number((durationFrames / frameRate).toFixed(2)) : 2.8;
    const extractedText = typeof manifest?.text === 'string'
      ? manifest.text
      : typeof (textControl?.value as { str?: unknown } | undefined)?.str === 'string'
        ? String((textControl!.value as { str: string }).str)
        : undefined;
    const extractedAccent = typeof manifest?.accent === 'string'
      ? manifest.accent
      : normalizedRgbToHex(colorControl?.value) ?? '#7c5cff';

    const nativeFiles: NativeFile[] = [{
      path: `Premiere/MOGRT/${safePresetFileName(cleanFileStem || 'Template')}.mogrt`,
      role: 'template',
      bytes,
    }];

    const preset: PresetRecord = {
      id: crypto.randomUUID(),
      version: 1,
      teamId,
      name: String(manifest?.name ?? definition?.capsuleName ?? cleanFileStem ?? categoryLabels[category]).trim(),
      description: String(manifest?.description ?? definition?.capsuleDescription ?? `Plantilla Motion Graphics importada desde ${fileName}.`).trim(),
      category,
      target: 'premiere',
      templateName: safePresetFileName(String(manifest?.templateName ?? definition?.capsuleName ?? cleanFileStem)),
      applyMode: applyModeFor(category),
      durationSeconds: Math.max(0.25, Number(manifest?.durationSeconds ?? durationFromDef)),
      text: extractedText,
      accent: extractedAccent,
      secondaryAccent: typeof manifest?.secondaryAccent === 'string'
        ? manifest.secondaryAccent
        : typeof definition?.secondaryAccent === 'string'
          ? definition.secondaryAccent
          : undefined,
      animation: typeof manifest?.animation === 'string' ? manifest.animation : 'Desvanecer',
      curve: manifest?.curve,
      positionX: typeof manifest?.positionX === 'number' ? manifest.positionX : undefined,
      positionY: typeof manifest?.positionY === 'number' ? manifest.positionY : undefined,
      anchorPoint: manifest?.anchorPoint,
      pivotX: typeof manifest?.pivotX === 'number' ? manifest.pivotX : undefined,
      pivotY: typeof manifest?.pivotY === 'number' ? manifest.pivotY : undefined,
      rotationDeg: typeof manifest?.rotationDeg === 'number' ? manifest.rotationDeg : undefined,
      scale: typeof manifest?.scale === 'number'
        ? manifest.scale
        : typeof scaleControl?.value === 'number'
          ? Number(scaleControl.value)
          : 1,
      fontFamily: manifest?.fontFamily,
      tracking: typeof manifest?.tracking === 'number' ? manifest.tracking : undefined,
      uppercase: typeof manifest?.uppercase === 'boolean' ? manifest.uppercase : undefined,
      shadow: typeof manifest?.shadow === 'boolean' ? manifest.shadow : undefined,
      backgroundBox: typeof manifest?.backgroundBox === 'boolean' ? manifest.backgroundBox : undefined,
      plateRadius: typeof manifest?.plateRadius === 'number' ? manifest.plateRadius : undefined,
      plateOpacity: typeof manifest?.plateOpacity === 'number' ? manifest.plateOpacity : undefined,
      layers: Array.isArray(manifest?.layers) ? manifest.layers : undefined,
      bezier: Array.isArray(manifest?.bezier) && manifest.bezier.length === 4 ? manifest.bezier : undefined,
      timelineMode: manifest?.timelineMode,
      keyframeTracks: Array.isArray(manifest?.keyframeTracks) ? manifest.keyframeTracks : undefined,
      timelinePhases: manifest?.timelinePhases,
      audioSfx: manifest?.audioSfx,
      aspectRatio: manifest?.aspectRatio,
      lutName: typeof manifest?.lutName === 'string' ? manifest.lutName : undefined,
      lutMix: typeof manifest?.lutMix === 'number' ? manifest.lutMix : undefined,
      lutData: typeof manifest?.lutData === 'string' ? manifest.lutData : undefined,
      tags: Array.isArray(manifest?.tags) ? manifest.tags.filter((tag): tag is string => typeof tag === 'string') : ['premiere', 'mogrt'],
      author: 'Importado',
      updatedAt: new Date().toISOString(),
      favorite: false,
      source: 'imported',
      nativeFiles,
    };

    return { preset, nativeFiles };
  }

  // .prfpset XML preset
  const xmlText = strFromU8(bytes);
  if (!xmlText.includes('<PremiereData')) {
    throw new Error('El archivo .prfpset no tiene una estructura XML válida de Premiere Pro.');
  }

  let manifest: Partial<PresetManifest> | undefined;
  const commentMatch = xmlText.match(/<!--\s*FRAMEBASE_MANIFEST:(\{[\s\S]*?\})\s*-->/);
  if (commentMatch) {
    try {
      manifest = JSON.parse(commentMatch[1]) as Partial<PresetManifest>;
    } catch {
      manifest = undefined;
    }
  }

  const allNames = [...xmlText.matchAll(/<Name>([\s\S]*?)<\/Name>/g)].map((m) => m[1].trim()).filter(Boolean);
  const presetXmlName = allNames.find((item) => item !== 'Framebase Presets') ?? allNames[0];
  const xmlDescription = xmlText.match(/<Description>([\s\S]*?)<\/Description>/)?.[1]?.trim();
  const xmlType = xmlText.match(/<Type>([\s\S]*?)<\/Type>/)?.[1]?.trim().toLowerCase();
  const matchName = xmlText.match(/<MatchName>([\s\S]*?)<\/MatchName>/)?.[1]?.trim().toLowerCase() ?? '';

  const category: PresetCategory = (manifest?.category && isPresetCategory(manifest.category))
    ? manifest.category
    : xmlType === 'transition' || matchName.includes('dissolve') || matchName.includes('wipe') || lowerName.includes('transition')
      ? 'transition'
      : 'effect';

  const nativeFiles: NativeFile[] = [{
    path: `Premiere/Presets/${safePresetFileName(cleanFileStem || 'Preset')}.prfpset`,
    role: 'template',
    bytes,
  }];

  const preset: PresetRecord = {
    id: crypto.randomUUID(),
    version: 1,
    teamId,
    name: manifest?.name?.trim() || presetXmlName || cleanFileStem || categoryLabels[category],
    description: manifest?.description?.trim() || xmlDescription || `Preset de Premiere Pro importado desde ${fileName}.`,
    category,
    target: 'premiere',
    templateName: manifest?.templateName || safePresetFileName(presetXmlName || cleanFileStem),
    applyMode: applyModeFor(category),
    durationSeconds: Math.max(0.25, Number(manifest?.durationSeconds ?? 1.4)),
    accent: typeof manifest?.accent === 'string' ? manifest.accent : '#38bdf8',
    secondaryAccent: typeof manifest?.secondaryAccent === 'string' ? manifest.secondaryAccent : undefined,
    animation: typeof manifest?.animation === 'string' ? manifest.animation : (category === 'transition' ? 'Fundido' : 'Constante'),
    curve: manifest?.curve,
    anchorPoint: manifest?.anchorPoint,
    pivotX: typeof manifest?.pivotX === 'number' ? manifest.pivotX : undefined,
    pivotY: typeof manifest?.pivotY === 'number' ? manifest.pivotY : undefined,
    rotationDeg: typeof manifest?.rotationDeg === 'number' ? manifest.rotationDeg : undefined,
    intensity: typeof manifest?.intensity === 'number' ? manifest.intensity : 0.85,
    spread: typeof manifest?.spread === 'number' ? manifest.spread : 14,
    transitionStyle: manifest?.transitionStyle,
    effectStyle: manifest?.effectStyle,
    layers: Array.isArray(manifest?.layers) ? manifest.layers : undefined,
    bezier: Array.isArray(manifest?.bezier) && manifest.bezier.length === 4 ? manifest.bezier : undefined,
    timelineMode: manifest?.timelineMode,
    keyframeTracks: Array.isArray(manifest?.keyframeTracks) ? manifest.keyframeTracks : undefined,
    timelinePhases: manifest?.timelinePhases,
    audioSfx: manifest?.audioSfx,
    aspectRatio: manifest?.aspectRatio,
    lutName: typeof manifest?.lutName === 'string' ? manifest.lutName : undefined,
    lutMix: typeof manifest?.lutMix === 'number' ? manifest.lutMix : undefined,
    lutData: typeof manifest?.lutData === 'string' ? manifest.lutData : undefined,
    tags: Array.isArray(manifest?.tags) ? manifest.tags.filter((tag): tag is string => typeof tag === 'string') : ['premiere', 'prfpset'],
    author: 'Importado',
    updatedAt: new Date().toISOString(),
    favorite: false,
    source: 'imported',
    nativeFiles,
  };

  return { preset, nativeFiles };
}
