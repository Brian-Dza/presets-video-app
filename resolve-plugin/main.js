const fs = require('node:fs/promises');
const path = require('node:path');

const PLUGIN_ID = 'com.framebase.presets';
const SUPPORTED_NATIVE_FILE_RE = /\.(setting|comp|png|jpe?g|svg|exr|tga|bmp|tiff?|webp|mov|mp4|wav|cube|3dl|lut|alut3|fbx)$/i;

function normalizeVersion(rawVersion) {
  if (typeof rawVersion === 'string' && rawVersion.trim()) return rawVersion.trim();
  if (Array.isArray(rawVersion)) {
    const numeric = rawVersion.filter((part) => typeof part === 'number' || (typeof part === 'string' && /^\d+$/.test(part)));
    if (numeric.length > 0) return numeric.join('.');
  }
  return undefined;
}

function templateFolder(category) {
  if (category === 'transition') return 'Transitions';
  if (category === 'effect') return 'Effects';
  if (category === 'graphic' || category === 'sticker') return 'Generators';
  return 'Titles';
}

function sanitizeRelativeSegments(rawPath) {
  const normalized = String(rawPath ?? '')
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
  if (!SUPPORTED_NATIVE_FILE_RE.test(baseName)) return null;

  const cleaned = segments
    .map((segment) => segment.replace(/[^\w .-]/g, '_').trim().slice(0, 120))
    .filter(Boolean);
  return cleaned.length === segments.length ? cleaned : null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function matchFusionEffect(effectsList, candidates) {
  if (!Array.isArray(effectsList) || effectsList.length === 0) return undefined;
  const lowered = candidates.map((item) => item.toLowerCase());
  const orderedEffects = [
    ...effectsList.filter((effect) => String(effect?.category ?? '').toLowerCase() === 'fusion'),
    ...effectsList.filter((effect) => String(effect?.category ?? '').toLowerCase() !== 'fusion'),
  ];
  for (const candidate of lowered) {
    const found = orderedEffects.find((effect) => {
      const name = String(effect?.name ?? '').trim().toLowerCase();
      const id = String(effect?.id ?? '').trim().toLowerCase();
      return (
        name === candidate
        || id === candidate
        || id.endsWith(`/${candidate}`)
        || id.endsWith(`.${candidate}`)
        || id.endsWith(`:${candidate}`)
      );
    });
    if (found?.id) return found;
  }
  return undefined;
}

async function getTimelineFrameRate(timeline) {
  try {
    const settings = await timeline.GetSettings?.();
    const parsed = Number.parseFloat(String(settings?.timelineFrameRate ?? ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    // Use default 24 fps when timeline settings are unavailable.
  }
  return 24;
}

function createResolvePluginController(options = {}) {
  const templateRoot = options.templateRoot;
  const getWorkflowIntegration = options.getWorkflowIntegration
    ?? (() => require(path.join(__dirname, 'WorkflowIntegration.node')));

  let resolveObject;
  let resolveInitPromise;

  async function getResolve() {
    if (resolveObject) return resolveObject;
    if (resolveInitPromise) return resolveInitPromise;
    resolveInitPromise = (async () => {
      const workflowIntegration = getWorkflowIntegration();
      const ready = workflowIntegration.InitializePromise
        ? await workflowIntegration.InitializePromise(PLUGIN_ID)
        : workflowIntegration.Initialize(PLUGIN_ID);
      if (!ready) throw new Error('Resolve no está disponible para Framebase.');
      const instance = workflowIntegration.GetResolvePromise
        ? await workflowIntegration.GetResolvePromise()
        : await workflowIntegration.GetResolve();
      if (!instance) throw new Error('No se pudo conectar con DaVinci Resolve.');
      resolveObject = instance;
      return instance;
    })().catch((error) => {
      resolveInitPromise = undefined;
      throw error;
    });
    return resolveInitPromise;
  }

  async function getTimelineContext() {
    const resolve = await getResolve();
    const manager = await resolve.GetProjectManager();
    const project = manager ? await manager.GetCurrentProject() : null;
    if (!project) throw new Error('Abre un proyecto antes de aplicar un preset.');
    const timeline = await project.GetCurrentTimeline();
    if (!timeline) throw new Error('Selecciona una línea de tiempo antes de aplicar un preset.');
    return { resolve, manager, project, timeline };
  }

  async function installNativeFiles(category, files = []) {
    if (!templateRoot) return [];
    const folder = path.resolve(templateRoot, templateFolder(category));
    await fs.mkdir(folder, { recursive: true });
    const storedPaths = [];
    for (const file of files) {
      const segments = sanitizeRelativeSegments(file?.path);
      if (!segments || typeof file?.base64 !== 'string') continue;
      const target = path.resolve(folder, ...segments);
      if (!target.startsWith(`${folder}${path.sep}`)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(file.base64, 'base64'));
      storedPaths.push(target);
    }
    return storedPaths;
  }

  async function getContext() {
    try {
      const resolve = await getResolve();
      const rawVersion = (await resolve.GetVersionString?.()) ?? (await resolve.GetVersion?.());
      const manager = await resolve.GetProjectManager();
      const project = manager ? await manager.GetCurrentProject() : null;
      const timeline = project ? await project.GetCurrentTimeline() : null;
      const selected = timeline ? await timeline.GetSelectedClips?.() : [];
      return {
        connected: true,
        version: normalizeVersion(rawVersion),
        projectName: project ? await project.GetName() : undefined,
        timelineName: timeline ? await timeline.GetName() : undefined,
        selectedClipCount: Array.isArray(selected) ? selected.length : 0,
        playheadTimecode: timeline ? await timeline.GetCurrentTimecode() : undefined,
      };
    } catch (error) {
      return {
        connected: false,
        selectedClipCount: 0,
        error: error instanceof Error ? error.message : 'Resolve no está conectado.',
      };
    }
  }

  async function applyPreset(_event, payload) {
    try {
      const { resolve, timeline } = await getTimelineContext();
      const selected = (await timeline.GetSelectedClips?.()) ?? [];
      const currentClip = selected[0] ?? (await timeline.GetCurrentVideoItem?.());
      const installedPaths = await installNativeFiles(payload.category, payload.nativeFiles);
      const installedSetting = installedPaths.find((file) => /\.setting$/i.test(file));
      const installedComp = installedPaths.find((file) => /\.comp$/i.test(file));
      const installedStem = installedSetting ? path.basename(installedSetting).replace(/\.setting$/i, '') : undefined;

      if (payload.applyMode === 'transition') {
        if (!currentClip) return { success: false, message: 'Selecciona un clip junto al corte donde quieres poner la transición.' };
        const fps = await getTimelineFrameRate(timeline);
        const duration = Math.max(1, Math.round((payload.durationSeconds || 1) * fps));
        const attempts = [];
        if (payload.templateName === 'Cross Dissolve') {
          if (installedStem) attempts.push({ type: installedStem, category: 'fusion' });
          attempts.push({ type: 'Cross Dissolve', category: 'simple' });
        } else {
          for (const candidate of uniqueStrings([payload.templateName, installedStem, payload.name])) {
            attempts.push({ type: candidate, category: 'fusion' });
          }
        }
        let transition = null;
        for (const attempt of attempts) {
          transition = await currentClip.AddTransition?.({
            type: attempt.type,
            category: attempt.category,
            position: 'end',
            alignment: 'center',
            duration,
          });
          if (transition) break;
        }
        if (!transition) {
          return {
            success: false,
            message: 'Resolve no encontró esa transición o el clip no tiene margen suficiente en el corte. Reinicia Resolve si acabas de instalar la plantilla.',
          };
        }
        return { success: true, message: `“${payload.name}” se añadió al corte del clip seleccionado.` };
      }

      if (payload.applyMode === 'clip-effect') {
        if (!currentClip) return { success: false, message: 'Selecciona primero el clip al que quieres aplicar el efecto.' };
        if (installedComp) {
          const composition = await currentClip.ImportFusionComp?.(installedComp);
          if (composition) return { success: true, message: `“${payload.name}” se aplicó al clip seleccionado.` };
        }
        const candidates = uniqueStrings([
          payload.templateName,
          installedStem,
          payload.name,
          payload.templateName?.replace(/_/g, ' '),
          installedStem?.replace(/_/g, ' '),
        ]);
        const effectsList = (await resolve.GetEffectsList?.('video')) ?? [];
        const matchedEffect = matchFusionEffect(effectsList, candidates);
        if (matchedEffect) {
          const applied = await currentClip.AddEffect?.(matchedEffect.category || 'fusion', matchedEffect.id);
          if (applied) return { success: true, message: `“${payload.name}” se aplicó al clip seleccionado.` };
        }
        return {
          success: false,
          message: 'La plantilla de efecto se instaló en Resolve. Reinicia DaVinci Resolve para que aparezca en Efectos de Fusion y vuelve a aplicarla, o importa una composición .comp.',
        };
      }

      const method = ['title', 'subtitle'].includes(payload.category)
        ? 'InsertFusionTitleIntoTimeline'
        : 'InsertFusionGeneratorIntoTimeline';
      const candidates = uniqueStrings([
        payload.templateName,
        installedStem,
        payload.name,
        payload.templateName?.replace(/_/g, ' '),
      ]);
      let inserted = null;
      for (const candidate of candidates) {
        inserted = await timeline[method]?.(candidate);
        if (inserted) break;
      }
      if (!inserted) {
        return {
          success: false,
          message: 'No se pudo insertar la plantilla. Si acabas de instalarla, reinicia Resolve y vuelve a intentarlo.',
        };
      }
      return { success: true, message: `“${payload.name}” se insertó en el cabezal de reproducción.` };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Resolve no pudo aplicar este preset.' };
    }
  }

  async function saveProject() {
    try {
      const resolve = await getResolve();
      const manager = await resolve.GetProjectManager();
      return Boolean(await manager?.SaveProject?.());
    } catch {
      return false;
    }
  }

  function cleanUp() {
    resolveObject = undefined;
    resolveInitPromise = undefined;
    try {
      getWorkflowIntegration().CleanUp?.();
    } catch {
      // Resolve may already be shutting down.
    }
  }

  return {
    getResolve,
    getContext,
    applyPreset,
    saveProject,
    installNativeFiles,
    cleanUp,
  };
}

const electronModule = process.versions?.electron ? require('electron') : null;
const isElectronRuntime = Boolean(
  electronModule
  && typeof electronModule === 'object'
  && electronModule.app
);

if (isElectronRuntime) {
  const { app, BrowserWindow, dialog, ipcMain } = electronModule;
  const templateRoot = path.join(
    app.getPath('appData'),
    'Blackmagic Design',
    'DaVinci Resolve',
    'Support',
    'Fusion',
    'Templates',
    'Edit'
  );
  const controller = createResolvePluginController({ templateRoot });
  let mainWindow;

  function registerHandlers() {
    ipcMain.handle('framebase:resolve-context', () => controller.getContext());
    ipcMain.handle('framebase:apply-preset', (event, payload) => controller.applyPreset(event, payload));
    ipcMain.handle('framebase:save-project', () => controller.saveProject());
    ipcMain.handle('framebase:save-file', async (_event, payload) => {
      const safeName = path.basename(String(payload?.fileName || 'Framebase-Preset.drfx'));
      const ext = path.extname(safeName).replace(/^\./, '').toLowerCase() || 'drfx';
      const filterName = ext === 'mogrt'
        ? 'Plantilla Motion Graphics Premiere'
        : ext === 'prfpset'
          ? 'Preset Adobe Premiere Pro'
          : 'Paquete DaVinci Resolve';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Exportar paquete de preset',
        defaultPath: safeName,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, Buffer.from(String(payload?.base64 || ''), 'base64'));
      return true;
    });
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1420,
      height: 900,
      minWidth: 1000,
      minHeight: 680,
      backgroundColor: '#090b10',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
    mainWindow.on('closed', () => { mainWindow = undefined; });
  }

  app.whenReady().then(() => {
    registerHandlers();
    createWindow();
  });

  app.on('before-quit', () => controller.cleanUp());
  app.on('window-all-closed', () => app.quit());
}

module.exports = {
  PLUGIN_ID,
  normalizeVersion,
  templateFolder,
  sanitizeRelativeSegments,
  matchFusionEffect,
  createResolvePluginController,
};
