import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { EditorTarget, NativeFile, PresetCategory, PresetManifest, PresetRecord } from '../domain/preset';
import { applyModeFor, categoryLabels, categoryPaths, isPresetCategory } from '../domain/preset';
import { buildSfxWavBytes } from './audioSfx';
import { createPremierePackage, parsePremiereBytes, premierePackageExtension, premierePackageFileName } from './premiereFactory';
import { categoryFromTemplatePath, createFusionTemplate, safePresetFileName, templateFileName } from './templateFactory';

const MANIFEST_PATH = 'Framebase/manifest.json';
const PACK_MANIFEST_PATH = 'Framebase/pack.json';
const SUPPORTED_NATIVE_FILE_RE = /\.(setting|comp|png|jpe?g|svg|exr|tga|bmp|tiff?|webp|mov|mp4|wav|mp3|cube|3dl|lut|alut3|fbx)$/i;
const PREVIEW_FILE_RE = /\.(png|jpe?g|svg|webp)$/i;
const TEMPLATE_FILE_RE = /\.(setting|comp)$/i;

export interface PresetPackManifest {
  formatVersion: 1;
  packName: string;
  target: EditorTarget;
  exportedAt: string;
  presets: PresetManifest[];
}

const EDIT_SECTION_MAP: Record<string, string> = {
  titles: 'Titles',
  generators: 'Generators',
  effects: 'Effects',
  transitions: 'Transitions',
};

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function sanitizeArchivePath(rawPath: string): string | undefined {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (!normalized) return undefined;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '__MACOSX')) return undefined;
  const baseName = segments[segments.length - 1];
  if (baseName.startsWith('._') || baseName === '.DS_Store' || baseName.toLowerCase() === 'thumbs.db') return undefined;
  if (segments[0]?.toLowerCase() === 'templates' && segments.length > 1) {
    segments.shift();
  }
  if (segments[0]?.toLowerCase() === 'edit' && segments.length >= 3) {
    const canonicalSection = EDIT_SECTION_MAP[segments[1].toLowerCase()];
    if (canonicalSection) {
      return ['Edit', canonicalSection, ...segments.slice(2)].join('/');
    }
  }
  return segments.join('/');
}

function directoryOf(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index + 1);
}

function mapImportedPath(entryPath: string, templateDir: string, importedCategory: string): string {
  if (entryPath.startsWith('Edit/')) return entryPath;
  if (templateDir && entryPath.startsWith(templateDir)) {
    return `${importedCategory}/${entryPath.slice(templateDir.length)}`;
  }
  const withoutCategoryPrefix = entryPath.replace(/^(fusion|edit)\/[^/]+\//i, '');
  return `${importedCategory}/${withoutCategoryPrefix}`;
}

export interface ParsedPresetFile {
  preset: PresetRecord;
  nativeFiles: NativeFile[];
}

function inferCategory(path: string): PresetCategory {
  const known = categoryFromTemplatePath(path);
  if (known) return known;
  const name = path.toLowerCase();
  if (name.includes('transition') || name.includes('dissolve')) return 'transition';
  if (name.includes('effect') || name.includes('glow') || name.includes('blur')) return 'effect';
  if (name.includes('subtitle') || name.includes('caption')) return 'subtitle';
  if (name.includes('sticker')) return 'sticker';
  if (name.includes('title') || name.includes('text')) return 'title';
  return 'graphic';
}

function categoryFromManifest(value: unknown): PresetCategory | undefined {
  if (typeof value !== 'object' || value === null || !('category' in value)) return undefined;
  const category = (value as { category?: unknown }).category;
  return typeof category === 'string' && isPresetCategory(category) ? category : undefined;
}

function findJsonEntry<T>(files: Record<string, Uint8Array>, suffix: string): T | undefined {
  const lowerSuffix = suffix.toLowerCase();
  const entry = Object.entries(files).find(([path]) => {
    const clean = sanitizeArchivePath(path);
    return Boolean(clean && clean.toLowerCase().endsWith(lowerSuffix));
  });
  if (!entry) return undefined;
  try {
    return JSON.parse(strFromU8(entry[1])) as T;
  } catch {
    return undefined;
  }
}

export function buildManifestFromPreset(
  preset: PresetRecord,
  files: Array<{ path: string; role: NativeFile['role'] }>
): PresetManifest {
  return {
    formatVersion: 1,
    id: preset.id,
    version: preset.version,
    name: preset.name,
    description: preset.description,
    category: preset.category,
    target: preset.target,
    templateName: preset.templateName,
    applyMode: preset.applyMode,
    durationSeconds: preset.durationSeconds,
    text: preset.text,
    accent: preset.accent,
    secondaryAccent: preset.secondaryAccent,
    animation: preset.animation,
    curve: preset.curve,
    positionX: preset.positionX,
    positionY: preset.positionY,
    anchorPoint: preset.anchorPoint,
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
    pivotX: preset.pivotX,
    pivotY: preset.pivotY,
    tags: preset.tags,
    files,
  };
}

function recordFromManifestAndFiles(
  manifest: Partial<PresetManifest> | undefined,
  fallbackName: string,
  fallbackCategory: PresetCategory,
  fallbackTemplateStem: string,
  fileName: string,
  teamId: string,
  mappedFiles: NativeFile[]
): PresetRecord {
  const category = categoryFromManifest(manifest) ?? fallbackCategory;
  const templateName = (typeof manifest?.templateName === 'string' && manifest.templateName.trim()) || fallbackTemplateStem;
  return {
    id: crypto.randomUUID(),
    version: 1,
    teamId,
    name: manifest?.name?.trim() || fallbackName || categoryLabels[category],
    description: manifest?.description?.trim() || `Recurso importado desde ${fileName}.`,
    category,
    target: manifest?.target === 'premiere' ? 'premiere' : 'resolve',
    templateName,
    applyMode: applyModeFor(category),
    durationSeconds: Math.max(0.25, Number(manifest?.durationSeconds ?? 2.5)),
    text: typeof manifest?.text === 'string' ? manifest.text : undefined,
    accent: typeof manifest?.accent === 'string' ? manifest.accent : '#7c5cff',
    secondaryAccent: typeof manifest?.secondaryAccent === 'string' ? manifest.secondaryAccent : undefined,
    animation: typeof manifest?.animation === 'string' ? manifest.animation : 'Personalizada',
    curve: manifest?.curve,
    positionX: typeof manifest?.positionX === 'number' ? manifest.positionX : undefined,
    positionY: typeof manifest?.positionY === 'number' ? manifest.positionY : undefined,
    anchorPoint: manifest?.anchorPoint,
    pivotX: typeof manifest?.pivotX === 'number' ? manifest.pivotX : undefined,
    pivotY: typeof manifest?.pivotY === 'number' ? manifest.pivotY : undefined,
    rotationDeg: typeof manifest?.rotationDeg === 'number' ? manifest.rotationDeg : undefined,
    scale: typeof manifest?.scale === 'number' ? manifest.scale : undefined,
    intensity: typeof manifest?.intensity === 'number' ? manifest.intensity : undefined,
    spread: typeof manifest?.spread === 'number' ? manifest.spread : undefined,
    fontFamily: manifest?.fontFamily,
    tracking: typeof manifest?.tracking === 'number' ? manifest.tracking : undefined,
    uppercase: typeof manifest?.uppercase === 'boolean' ? manifest.uppercase : undefined,
    shadow: typeof manifest?.shadow === 'boolean' ? manifest.shadow : undefined,
    backgroundBox: typeof manifest?.backgroundBox === 'boolean' ? manifest.backgroundBox : undefined,
    plateRadius: typeof manifest?.plateRadius === 'number' ? manifest.plateRadius : undefined,
    plateOpacity: typeof manifest?.plateOpacity === 'number' ? manifest.plateOpacity : undefined,
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
    tags: Array.isArray(manifest?.tags) ? manifest.tags.filter((tag): tag is string => typeof tag === 'string') : ['importado'],
    author: 'Importado',
    updatedAt: new Date().toISOString(),
    favorite: false,
    source: 'imported',
    nativeFiles: mappedFiles,
  };
}

export async function parsePresetCollectionFile(file: File, teamId: string): Promise<ParsedPresetFile[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.mogrt') || lowerName.endsWith('.prfpset')) {
    return [parsePremiereBytes(file.name, bytes, teamId)];
  }

  const isZip = lowerName.endsWith('.drfx') || lowerName.endsWith('.zip');
  const rawFiles = isZip ? unzipSync(bytes) : { [file.name]: bytes };

  // Check if ZIP contains Premiere .mogrt / .prfpset packages
  const premiereEntries: Array<{ cleanPath: string; value: Uint8Array }> = [];
  for (const [rawPath, value] of Object.entries(rawFiles)) {
    const cleanPath = sanitizeArchivePath(rawPath);
    if (cleanPath && value.length > 0 && /\.(mogrt|prfpset)$/i.test(cleanPath)) {
      premiereEntries.push({ cleanPath, value });
    }
  }
  if (premiereEntries.length > 0) {
    return premiereEntries.map(({ cleanPath, value }) => {
      const base = cleanPath.split('/').pop() ?? cleanPath;
      return parsePremiereBytes(base, value, teamId);
    });
  }

  // Check if Framebase multi-preset pack.json is present
  const cleanEntries = new Map<string, Uint8Array>();
  const entriesList: Array<{ cleanPath: string; value: Uint8Array }> = [];
  for (const [rawPath, value] of Object.entries(rawFiles)) {
    const cleanPath = sanitizeArchivePath(rawPath);
    if (cleanPath && value.length > 0) {
      cleanEntries.set(cleanPath, value);
      if (SUPPORTED_NATIVE_FILE_RE.test(cleanPath)) {
        entriesList.push({ cleanPath, value });
      }
    }
  }

  const packManifest = findJsonEntry<PresetPackManifest>(rawFiles, 'pack.json');
  if (packManifest && Array.isArray(packManifest.presets) && packManifest.presets.length > 0) {
    const importedPack: ParsedPresetFile[] = [];
    for (const itemManifest of packManifest.presets) {
      const itemFiles: NativeFile[] = [];
      for (const fileDesc of itemManifest.files ?? []) {
        const clean = sanitizeArchivePath(fileDesc.path);
        const foundBytes = clean ? cleanEntries.get(clean) : undefined;
        if (clean && foundBytes) {
          itemFiles.push({ path: clean, role: fileDesc.role, bytes: foundBytes });
        }
      }
      if (itemFiles.length === 0) continue;
      const preset = recordFromManifestAndFiles(
        itemManifest,
        itemManifest.name,
        itemManifest.category,
        itemManifest.templateName,
        file.name,
        teamId,
        itemFiles
      );
      importedPack.push({ preset, nativeFiles: itemFiles });
    }
    if (importedPack.length > 0) return importedPack;
  }

  // Single preset or multi-.setting third-party DRFX bundle
  const settings = entriesList.filter(({ cleanPath }) => TEMPLATE_FILE_RE.test(cleanPath));
  if (settings.length === 0) {
    throw new Error('El archivo no contiene una plantilla compatible (.setting, .comp, .drfx, .mogrt o .prfpset).');
  }

  const singleManifest = findJsonEntry<Partial<PresetManifest>>(rawFiles, 'manifest.json');
  const cleanFileStem = file.name.replace(/\.(drfx|zip|setting|comp)$/i, '').replace(/[_-]+/g, ' ').trim();

  // If single manifest or single template, import as one rich preset with all bundled assets
  if (singleManifest || settings.length === 1) {
    const firstTemplate = settings[0];
    const fallbackCategory = inferCategory(firstTemplate.cleanPath);
    const category = categoryFromManifest(singleManifest) ?? fallbackCategory;
    const templateDir = directoryOf(firstTemplate.cleanPath);
    const importedCategory = categoryPaths[category];
    const templateStem = firstTemplate.cleanPath.split('/').pop()?.replace(TEMPLATE_FILE_RE, '') ?? cleanFileStem;
    const mappedFiles: NativeFile[] = entriesList.map(({ cleanPath, value }) => {
      const baseName = cleanPath.split('/').pop() ?? cleanPath;
      const stem = baseName.replace(/\.[^.]+$/, '');
      const role: NativeFile['role'] = TEMPLATE_FILE_RE.test(cleanPath)
        ? 'template'
        : PREVIEW_FILE_RE.test(cleanPath) && stem.toLowerCase() === templateStem.toLowerCase()
          ? 'preview'
          : 'asset';
      return {
        path: mapImportedPath(cleanPath, templateDir, importedCategory),
        role,
        bytes: value,
      };
    });
    const preset = recordFromManifestAndFiles(
      singleManifest,
      cleanFileStem,
      category,
      templateStem,
      file.name,
      teamId,
      mappedFiles
    );
    return [{ preset, nativeFiles: mappedFiles }];
  }

  // Multi-template third-party DRFX pack without Framebase manifest
  return settings.map((templateEntry) => {
    const category = inferCategory(templateEntry.cleanPath);
    const templateDir = directoryOf(templateEntry.cleanPath);
    const importedCategory = categoryPaths[category];
    const templateStem = templateEntry.cleanPath.split('/').pop()?.replace(TEMPLATE_FILE_RE, '') ?? 'Template';
    const relatedEntries = entriesList.filter(({ cleanPath }) => {
      if (cleanPath === templateEntry.cleanPath) return true;
      if (TEMPLATE_FILE_RE.test(cleanPath)) return false;
      return templateDir ? cleanPath.startsWith(templateDir) : false;
    });
    const mappedFiles: NativeFile[] = relatedEntries.map(({ cleanPath, value }) => {
      const baseName = cleanPath.split('/').pop() ?? cleanPath;
      const stem = baseName.replace(/\.[^.]+$/, '');
      const role: NativeFile['role'] = TEMPLATE_FILE_RE.test(cleanPath)
        ? 'template'
        : PREVIEW_FILE_RE.test(cleanPath) && stem.toLowerCase() === templateStem.toLowerCase()
          ? 'preview'
          : 'asset';
      return {
        path: mapImportedPath(cleanPath, templateDir, importedCategory),
        role,
        bytes: value,
      };
    });
    const friendlyName = templateStem.replace(/[_-]+/g, ' ').trim();
    const preset = recordFromManifestAndFiles(
      undefined,
      friendlyName,
      category,
      templateStem,
      file.name,
      teamId,
      mappedFiles
    );
    return { preset, nativeFiles: mappedFiles };
  });
}

export async function parsePresetFile(file: File, teamId: string): Promise<ParsedPresetFile> {
  const results = await parsePresetCollectionFile(file, teamId);
  return results[0];
}

function ensureResolveTemplate(preset: PresetRecord, files: NativeFile[]): NativeFile[] {
  const resolveFiles = files.filter((file) => !file.path.startsWith('Premiere/') && !/\.(mogrt|prfpset)$/i.test(file.path));
  if (resolveFiles.some((file) => TEMPLATE_FILE_RE.test(file.path))) return resolveFiles;
  return [
    ...resolveFiles,
    {
      path: `${categoryPaths[preset.category]}/${templateFileName(preset)}`,
      bytes: createFusionTemplate(preset),
      role: 'template',
    },
  ];
}

export function createDrfx(preset: PresetRecord, nativeFiles: NativeFile[]): Uint8Array {
  const packaged = ensureResolveTemplate(preset, nativeFiles);
  const archiveEntries: Array<{ targetPath: string; role: NativeFile['role']; bytes: Uint8Array }> = [];
  const normalized = new Set<string>();

  for (const nativeFile of packaged) {
    const cleanPath = sanitizeArchivePath(nativeFile.path);
    if (!cleanPath) continue;
    const targetPath = cleanPath.startsWith('Edit/')
      ? cleanPath
      : `${categoryPaths[preset.category]}/${cleanPath.replace(/^(fusion|edit)\/[^/]+\//i, '')}`;
    if (normalized.has(targetPath.toLowerCase())) continue;
    normalized.add(targetPath.toLowerCase());
    archiveEntries.push({ targetPath, role: nativeFile.role, bytes: nativeFile.bytes });
  }

  const manifest = buildManifestFromPreset(
    preset,
    archiveEntries.map(({ targetPath, role }) => ({ path: targetPath, role }))
  );
  const archive: Record<string, Uint8Array> = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
    'Framebase/README.txt': strToU8('Framebase Presets\r\n\r\nPaquete de plantillas Fusion para DaVinci Resolve.\r\nInstala el archivo .drfx haciendo doble clic o usando Enviar a Resolve desde Framebase.\r\n'),
  };
  for (const entry of archiveEntries) {
    archive[entry.targetPath] = entry.bytes;
  }
  if (
    preset.audioSfx &&
    preset.audioSfx.sfxId !== 'none' &&
    preset.audioSfx.sfxId !== 'custom' &&
    !archiveEntries.some((entry) => /\.(wav|mp3)$/i.test(entry.targetPath))
  ) {
    const sfxPath = `Framebase/Audio/${preset.audioSfx.sfxId}.wav`;
    archive[sfxPath] = buildSfxWavBytes(preset.audioSfx.sfxId, preset.audioSfx.gainDb);
  }
  if (preset.lutData && preset.lutName) {
    const lutPath = `Framebase/LUTs/${safePresetFileName(preset.lutName.replace(/\.cube$/i, ''))}.cube`;
    archive[lutPath] = strToU8(preset.lutData);
  }
  return zipSync(archive, { level: 6 });
}

export function createDrfxPack(
  items: Array<{ preset: PresetRecord; nativeFiles: NativeFile[] }>,
  packName: string
): Uint8Array {
  const archive: Record<string, Uint8Array> = {};
  const manifests: PresetManifest[] = [];
  const usedPaths = new Set<string>();

  for (const { preset, nativeFiles } of items) {
    const packaged = ensureResolveTemplate(preset, nativeFiles);
    const presetFilesDesc: Array<{ path: string; role: NativeFile['role'] }> = [];
    for (const nativeFile of packaged) {
      const cleanPath = sanitizeArchivePath(nativeFile.path);
      if (!cleanPath) continue;
      let targetPath = cleanPath.startsWith('Edit/')
        ? cleanPath
        : `${categoryPaths[preset.category]}/${cleanPath.replace(/^(fusion|edit)\/[^/]+\//i, '')}`;
      if (usedPaths.has(targetPath.toLowerCase())) {
        const extIndex = targetPath.lastIndexOf('.');
        targetPath = extIndex > -1
          ? `${targetPath.slice(0, extIndex)}_${safePresetFileName(preset.id.slice(0, 6))}${targetPath.slice(extIndex)}`
          : `${targetPath}_${safePresetFileName(preset.id.slice(0, 6))}`;
      }
      usedPaths.add(targetPath.toLowerCase());
      archive[targetPath] = nativeFile.bytes;
      presetFilesDesc.push({ path: targetPath, role: nativeFile.role });
    }
    manifests.push(buildManifestFromPreset(preset, presetFilesDesc));
  }

  const packManifest: PresetPackManifest = {
    formatVersion: 1,
    packName,
    target: 'resolve',
    exportedAt: new Date().toISOString(),
    presets: manifests,
  };
  archive[PACK_MANIFEST_PATH] = strToU8(JSON.stringify(packManifest, null, 2));
  archive['Framebase/README.txt'] = strToU8(
    `Framebase Collection Pack — ${packName}\r\nIncluye ${manifests.length} plantillas listas para DaVinci Resolve.\r\nHaz doble clic en este archivo .drfx para instalar toda la colección.\r\n`
  );
  return zipSync(archive, { level: 6 });
}

export function createPremierePackZip(
  items: Array<{ preset: PresetRecord; nativeFiles: NativeFile[] }>,
  packName: string
): Uint8Array {
  const archive: Record<string, Uint8Array> = {};
  const manifests: PresetManifest[] = [];

  for (const { preset, nativeFiles } of items) {
    const exported = exportPackageForTarget(preset, nativeFiles, 'premiere');
    const folder = exported.extension === 'mogrt' ? 'Motion Graphics Templates' : 'Effect Presets';
    const entryPath = `${folder}/${exported.fileName}`;
    archive[entryPath] = exported.bytes;
    manifests.push(buildManifestFromPreset({ ...preset, target: 'premiere' }, [{ path: entryPath, role: 'template' }]));
  }

  const packManifest: PresetPackManifest = {
    formatVersion: 1,
    packName,
    target: 'premiere',
    exportedAt: new Date().toISOString(),
    presets: manifests,
  };
  archive[PACK_MANIFEST_PATH] = strToU8(JSON.stringify(packManifest, null, 2));
  archive['Framebase/README.txt'] = strToU8(
    `Framebase Collection Pack — ${packName}\r\nIncluye ${manifests.length} recursos (.mogrt y .prfpset) para Adobe Premiere Pro.\r\n`
  );
  return zipSync(archive, { level: 6 });
}

export function packageFileName(preset: PresetRecord): string {
  return `${safePresetFileName(preset.name)}.drfx`;
}

export function packageFileNameForTarget(preset: PresetRecord, target: EditorTarget): string {
  return target === 'premiere' ? premierePackageFileName(preset) : packageFileName(preset);
}

export function exportPackageForTarget(
  preset: PresetRecord,
  nativeFiles: NativeFile[],
  target: EditorTarget
): { fileName: string; bytes: Uint8Array; extension: 'drfx' | 'mogrt' | 'prfpset' } {
  if (target === 'premiere') {
    const extension = premierePackageExtension(preset.category);
    const existingPremiere = preset.source === 'imported' && preset.version === 1
      ? nativeFiles.find((file) => file.path.toLowerCase().endsWith(`.${extension}`))
      : undefined;
    return {
      fileName: premierePackageFileName(preset),
      bytes: existingPremiere ? existingPremiere.bytes : createPremierePackage(preset),
      extension,
    };
  }
  return {
    fileName: packageFileName(preset),
    bytes: createDrfx(preset, nativeFiles),
    extension: 'drfx',
  };
}

async function triggerFileDownload(fileName: string, bytes: Uint8Array): Promise<boolean> {
  const host = window.nativeHost;
  if (host?.saveFile) {
    return host.saveFile(fileName, bytesToBase64(bytes));
  }
  const blob = new Blob([bytes.slice().buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function savePresetPackage(
  preset: PresetRecord,
  nativeFiles: NativeFile[],
  target: EditorTarget = 'resolve'
): Promise<boolean> {
  const { fileName, bytes } = exportPackageForTarget(preset, nativeFiles, target);
  return triggerFileDownload(fileName, bytes);
}

export async function savePresetCollectionPack(
  items: Array<{ preset: PresetRecord; nativeFiles: NativeFile[] }>,
  packName: string,
  target: EditorTarget = 'resolve'
): Promise<{ saved: boolean; fileName: string }> {
  const safePack = safePresetFileName(packName || 'Coleccion_Framebase');
  const fileName = target === 'premiere' ? `${safePack}_Premiere.zip` : `${safePack}.drfx`;
  const bytes = target === 'premiere'
    ? createPremierePackZip(items, packName)
    : createDrfxPack(items, packName);
  const saved = await triggerFileDownload(fileName, bytes);
  return { saved, fileName };
}

export async function saveDrfxFile(preset: PresetRecord, nativeFiles: NativeFile[]): Promise<boolean> {
  return savePresetPackage(preset, nativeFiles, 'resolve');
}
