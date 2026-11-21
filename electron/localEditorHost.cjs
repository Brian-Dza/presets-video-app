const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SUPPORTED_RESOLVE_FILE_RE = /\.(setting|comp|png|jpe?g|svg|exr|tga|bmp|tiff?|webp|mov|mp4|wav|cube|3dl|lut|alut3|fbx)$/i;

function safeStem(value, fallback = 'Framebase_Preset') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return cleaned || fallback;
}

function templateFolder(category) {
  if (category === 'transition') return 'Transitions';
  if (category === 'effect') return 'Effects';
  if (category === 'graphic' || category === 'sticker') return 'Generators';
  return 'Titles';
}

function sanitizeResolveRelativeSegments(rawPath) {
  const normalized = String(rawPath || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '');
  if (!normalized) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.some((segment) => segment === '.' || segment === '..' || segment === '__MACOSX')) return null;

  if (segments[0]?.toLowerCase() === 'templates' && segments.length > 1) {
    segments.shift();
  }
  if ((segments[0]?.toLowerCase() === 'edit' || segments[0]?.toLowerCase() === 'fusion') && segments.length >= 3) {
    segments.splice(0, 2);
  }

  const baseName = segments[segments.length - 1];
  if (!baseName || baseName.startsWith('._') || baseName === '.DS_Store' || baseName.toLowerCase() === 'thumbs.db') {
    return null;
  }
  if (!SUPPORTED_RESOLVE_FILE_RE.test(baseName)) return null;
  if (segments.some((segment) => /[<>:"|?*\x00-\x1f]/.test(segment))) return null;
  return segments;
}

function resolveEditTemplatesRoot() {
  if (process.env.FRAMEBASE_RESOLVE_TEMPLATES_DIR) {
    return process.env.FRAMEBASE_RESOLVE_TEMPLATES_DIR;
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Templates', 'Edit');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Templates', 'Edit');
  }
  return path.join(os.homedir(), '.local', 'share', 'DaVinciResolve', 'Fusion', 'Templates', 'Edit');
}

function findResolveExe() {
  if (process.env.FRAMEBASE_RESOLVE_EXE) {
    return fsSync.existsSync(process.env.FRAMEBASE_RESOLVE_EXE) ? process.env.FRAMEBASE_RESOLVE_EXE : null;
  }
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Blackmagic Design', 'DaVinci Resolve', 'Resolve.exe'),
        'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe',
      ]
    : process.platform === 'darwin'
      ? ['/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/MacOS/Resolve']
      : ['/opt/resolve/bin/resolve'];

  for (const candidate of candidates) {
    if (candidate && fsSync.existsSync(candidate)) return candidate;
  }
  return null;
}

function premiereMogrtRoot() {
  if (process.env.FRAMEBASE_PREMIERE_MOGRT_DIR) {
    return process.env.FRAMEBASE_PREMIERE_MOGRT_DIR;
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Adobe', 'Common', 'Motion Graphics Templates', 'Framebase');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Adobe', 'Common', 'Motion Graphics Templates', 'Framebase');
  }
  return path.join(os.homedir(), 'Documents', 'Adobe', 'Motion Graphics Templates', 'Framebase');
}

function premierePresetsRoot() {
  if (process.env.FRAMEBASE_PREMIERE_PRESETS_DIR) {
    return process.env.FRAMEBASE_PREMIERE_PRESETS_DIR;
  }
  return path.join(os.homedir(), 'Documents', 'Adobe', 'Premiere Pro', 'Framebase Presets');
}

function findPremiereExe() {
  if (process.env.FRAMEBASE_PREMIERE_EXE) {
    return fsSync.existsSync(process.env.FRAMEBASE_PREMIERE_EXE) ? process.env.FRAMEBASE_PREMIERE_EXE : null;
  }
  if (process.platform === 'win32') {
    const adobeRoot = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Adobe');
    if (fsSync.existsSync(adobeRoot)) {
      try {
        const dirs = fsSync.readdirSync(adobeRoot)
          .filter((entry) => /^Adobe Premiere Pro/i.test(entry))
          .sort()
          .reverse();
        for (const dir of dirs) {
          const exePath = path.join(adobeRoot, dir, 'Adobe Premiere Pro.exe');
          if (fsSync.existsSync(exePath)) return exePath;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

function spawnDetached(command, args) {
  if (process.env.FRAMEBASE_DISABLE_SPAWN === '1') return false;
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function getEditorsStatus() {
  const resolveExePath = findResolveExe();
  const premiereExePath = findPremiereExe();
  return {
    available: true,
    resolveInstalled: Boolean(resolveExePath),
    resolveExePath,
    resolveTemplatesDir: resolveEditTemplatesRoot(),
    premiereInstalled: Boolean(premiereExePath),
    premiereExePath,
    premiereMogrtDir: premiereMogrtRoot(),
    premierePresetsDir: premierePresetsRoot(),
  };
}

async function installInResolve(payload = {}) {
  const category = String(payload.category || 'title');
  const folderName = templateFolder(category);
  const categoryDir = path.join(resolveEditTemplatesRoot(), folderName);
  const resolvedRoot = path.resolve(categoryDir);
  await fs.mkdir(resolvedRoot, { recursive: true });

  const nativeFiles = Array.isArray(payload.nativeFiles) ? payload.nativeFiles : [];
  let writtenCount = 0;

  for (const file of nativeFiles) {
    if (!file || typeof file.path !== 'string' || typeof file.base64 !== 'string') continue;
    const segments = sanitizeResolveRelativeSegments(file.path);
    if (!segments) continue;
    const destination = path.resolve(resolvedRoot, ...segments);
    const relative = path.relative(resolvedRoot, destination);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, Buffer.from(file.base64, 'base64'));
    writtenCount += 1;
  }

  let drfxPath = null;
  if (typeof payload.drfxBase64 === 'string' && payload.drfxBase64.length > 0) {
    const tempDir = process.env.FRAMEBASE_TEMP_DIR || path.join(os.tmpdir(), 'Framebase');
    await fs.mkdir(tempDir, { recursive: true });
    drfxPath = path.join(tempDir, `${safeStem(payload.presetName)}.drfx`);
    await fs.writeFile(drfxPath, Buffer.from(payload.drfxBase64, 'base64'));
  }

  const resolveExePath = findResolveExe();
  let openedEditor = false;
  if (payload.openInResolve !== false && resolveExePath && drfxPath) {
    openedEditor = spawnDetached(resolveExePath, [drfxPath]);
  }

  const sectionLabel = folderName === 'Titles'
    ? 'Títulos'
    : folderName === 'Generators'
      ? 'Generadores'
      : folderName === 'Effects'
        ? 'Efectos'
        : 'Transiciones';

  return {
    success: writtenCount > 0 || Boolean(drfxPath),
    openedEditor,
    installedPath: resolvedRoot,
    drfxPath,
    writtenCount,
    message: openedEditor
      ? `Instalado en Biblioteca de efectos → ${sectionLabel} y abierto en DaVinci Resolve.`
      : `Instalado en DaVinci Resolve → Biblioteca de efectos → ${sectionLabel}. Búscalo en la página Edición.`,
  };
}

async function installInPremiere(payload = {}) {
  const extension = payload.extension === 'prfpset' ? 'prfpset' : 'mogrt';
  const targetDir = extension === 'mogrt' ? premiereMogrtRoot() : premierePresetsRoot();
  const resolvedRoot = path.resolve(targetDir);
  await fs.mkdir(resolvedRoot, { recursive: true });

  const safeName = `${safeStem(payload.presetName || payload.fileName)}.${extension}`;
  const destination = path.join(resolvedRoot, safeName);
  if (typeof payload.packageBase64 !== 'string' || payload.packageBase64.length === 0) {
    return {
      success: false,
      openedEditor: false,
      installedPath: destination,
      message: 'No se recibió contenido válido para instalar en Premiere Pro.',
    };
  }

  await fs.writeFile(destination, Buffer.from(payload.packageBase64, 'base64'));

  const premiereExePath = findPremiereExe();
  let openedEditor = false;
  if (payload.launchPremiere && premiereExePath) {
    openedEditor = spawnDetached(premiereExePath, []);
  } else if (payload.openFolder && process.platform === 'win32') {
    spawnDetached('explorer.exe', [`/select,${destination}`]);
  }

  return {
    success: true,
    openedEditor,
    installedPath: destination,
    message: extension === 'mogrt'
      ? 'Plantilla .mogrt instalada en Adobe Motion Graphics Templates (Gráficos esenciales → Mis plantillas → Framebase).'
      : `Preset .prfpset guardado en ${resolvedRoot}. Impórtalo desde Efectos → Ajustes preestablecidos en Premiere Pro.`,
  };
}

module.exports = {
  getEditorsStatus,
  installInResolve,
  installInPremiere,
  resolveEditTemplatesRoot,
  premiereMogrtRoot,
  premierePresetsRoot,
};
