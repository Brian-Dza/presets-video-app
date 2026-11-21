import type { EditorTarget, NativeFile, PresetRecord } from '../domain/preset';
import type { LocalEditorsStatus, LocalInstallResult, ResolveApplyResult } from '../env';
import { bytesToBase64, createDrfx, exportPackageForTarget, savePresetPackage } from './presetFiles';

const OFFLINE_STATUS: LocalEditorsStatus = {
  available: false,
  resolveInstalled: false,
  premiereInstalled: false,
};

function canUseLoopbackHttp(): boolean {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  const { protocol, hostname } = window.location;
  if (protocol !== 'http:' && protocol !== 'https:') return false;
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

export async function fetchLocalEditorsStatus(): Promise<LocalEditorsStatus> {
  if (window.nativeHost?.getEditorsStatus) {
    try {
      return await window.nativeHost.getEditorsStatus();
    } catch {
      return OFFLINE_STATUS;
    }
  }

  if (!canUseLoopbackHttp()) return OFFLINE_STATUS;
  try {
    const response = await fetch(`${window.location.origin}/__framebase/host/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return OFFLINE_STATUS;
    return (await response.json()) as LocalEditorsStatus;
  } catch {
    return OFFLINE_STATUS;
  }
}

async function postLocalHost<T>(endpoint: string, payload: unknown): Promise<T | null> {
  if (!canUseLoopbackHttp()) return null;
  try {
    const response = await fetch(`${window.location.origin}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function installPresetLocallyInResolve(
  preset: PresetRecord,
  nativeFiles: NativeFile[],
  openInResolve = true
): Promise<LocalInstallResult | null> {
  const drfxBytes = createDrfx(preset, nativeFiles);
  const payload = {
    presetName: preset.name,
    category: preset.category,
    drfxBase64: openInResolve ? bytesToBase64(drfxBytes) : undefined,
    nativeFiles: nativeFiles.map((file) => ({ path: file.path, base64: bytesToBase64(file.bytes) })),
    openInResolve,
  };

  if (window.nativeHost?.installInResolve) {
    return window.nativeHost.installInResolve(payload);
  }
  return postLocalHost<LocalInstallResult>('/__framebase/host/install-resolve', payload);
}

export async function installPresetLocallyInPremiere(
  preset: PresetRecord,
  nativeFiles: NativeFile[],
  options?: { openFolder?: boolean; launchPremiere?: boolean }
): Promise<LocalInstallResult | null> {
  const exported = exportPackageForTarget(preset, nativeFiles, 'premiere');
  const payload = {
    presetName: preset.name,
    fileName: exported.fileName,
    extension: exported.extension === 'prfpset' ? ('prfpset' as const) : ('mogrt' as const),
    packageBase64: bytesToBase64(exported.bytes),
    openFolder: options?.openFolder ?? false,
    launchPremiere: options?.launchPremiere ?? false,
  };

  if (window.nativeHost?.installInPremiere) {
    return window.nativeHost.installInPremiere(payload);
  }
  return postLocalHost<LocalInstallResult>('/__framebase/host/install-premiere', payload);
}

export async function applyPresetToEditor(
  preset: PresetRecord,
  nativeFiles: NativeFile[],
  target: EditorTarget
): Promise<ResolveApplyResult & { mode: 'bridge' | 'local-install' | 'download' }> {
  if (target === 'resolve') {
    if (window.resolveBridge) {
      const bridgeResult = await window.resolveBridge.applyPreset({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        applyMode: preset.applyMode,
        templateName: preset.templateName,
        durationSeconds: preset.durationSeconds,
        nativeFiles: nativeFiles.map((file) => ({ path: file.path, base64: bytesToBase64(file.bytes) })),
      });
      return { ...bridgeResult, mode: 'bridge' };
    }

    const localResult = await installPresetLocallyInResolve(preset, nativeFiles, true);
    if (localResult) {
      return {
        success: localResult.success,
        message: localResult.message,
        mode: 'local-install',
      };
    }

    const saved = await savePresetPackage(preset, nativeFiles, 'resolve');
    return {
      success: saved,
      message: saved
        ? 'Se descargó el paquete .drfx. Haz doble clic sobre el archivo para instalarlo en DaVinci Resolve.'
        : 'Se canceló la descarga del paquete .drfx.',
      mode: 'download',
    };
  }

  // Adobe Premiere Pro target
  const exported = exportPackageForTarget(preset, nativeFiles, 'premiere');
  const premiereExtension = exported.extension === 'prfpset' ? 'prfpset' : 'mogrt';

  if (window.premiereBridge) {
    const bridgeResult = await window.premiereBridge.applyPreset({
      id: preset.id,
      name: preset.name,
      category: preset.category,
      applyMode: preset.applyMode,
      extension: premiereExtension,
      fileName: exported.fileName,
      packageBase64: bytesToBase64(exported.bytes),
    });
    return { ...bridgeResult, mode: 'bridge' };
  }

  const localResult = await installPresetLocallyInPremiere(preset, nativeFiles, { openFolder: false });
  if (localResult) {
    return {
      success: localResult.success,
      message: localResult.message,
      mode: 'local-install',
    };
  }

  const saved = await savePresetPackage(preset, nativeFiles, 'premiere');
  return {
    success: saved,
    message: saved
      ? `Se exportó ${exported.fileName}. Impórtalo en Gráficos esenciales o Efectos de Premiere Pro.`
      : 'Se canceló la exportación para Premiere Pro.',
    mode: 'download',
  };
}
