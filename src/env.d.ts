/// <reference types="vite/client" />

import type { MemberRole, PresetCategory, PresetRecord } from './domain/preset';

export interface ResolveContext {
  connected: boolean;
  version?: string | Array<number | string>;
  projectName?: string;
  timelineName?: string;
  selectedClipCount: number;
  playheadTimecode?: string;
  error?: string;
}

export interface PremiereContext {
  connected: boolean;
  version?: string;
  projectName?: string;
  sequenceName?: string;
  playheadSeconds?: number;
  error?: string;
}

export interface ResolveApplyResult {
  success: boolean;
  message: string;
}

export interface LocalEditorsStatus {
  available: boolean;
  resolveInstalled: boolean;
  resolveExePath?: string | null;
  resolveTemplatesDir?: string;
  premiereInstalled: boolean;
  premiereExePath?: string | null;
  premiereMogrtDir?: string;
  premierePresetsDir?: string;
}

export interface LocalInstallResult {
  success: boolean;
  openedEditor: boolean;
  installedPath?: string;
  drfxPath?: string | null;
  writtenCount?: number;
  message: string;
}

declare global {
  interface Window {
    nativeHost?: {
      isDesktop: true;
      version: string;
      platform: string;
      saveFile: (fileName: string, base64: string) => Promise<boolean>;
      getEditorsStatus?: () => Promise<LocalEditorsStatus>;
      installInResolve?: (payload: {
        presetName: string;
        category: PresetCategory;
        drfxBase64?: string;
        nativeFiles?: Array<{ path: string; base64: string }>;
        openInResolve?: boolean;
      }) => Promise<LocalInstallResult>;
      installInPremiere?: (payload: {
        presetName: string;
        fileName: string;
        extension: 'mogrt' | 'prfpset';
        packageBase64: string;
        openFolder?: boolean;
        launchPremiere?: boolean;
      }) => Promise<LocalInstallResult>;
      getAlwaysOnTop?: () => Promise<boolean>;
      setAlwaysOnTop?: (enabled: boolean) => Promise<boolean>;
    };
    resolveBridge?: {
      getContext: () => Promise<ResolveContext>;
      applyPreset: (payload: {
        id: string;
        name: string;
        category: PresetCategory;
        applyMode: PresetRecord['applyMode'];
        templateName: string;
        durationSeconds: number;
        nativeFiles?: Array<{ path: string; base64: string }>;
      }) => Promise<ResolveApplyResult>;
      saveProject: () => Promise<boolean>;
    };
    premiereBridge?: {
      getContext: () => Promise<PremiereContext>;
      applyPreset: (payload: {
        id: string;
        name: string;
        category: PresetCategory;
        applyMode: PresetRecord['applyMode'];
        extension: 'mogrt' | 'prfpset';
        fileName: string;
        packageBase64: string;
      }) => Promise<ResolveApplyResult>;
      saveProject: () => Promise<boolean>;
    };
    framebaseApp?: {
      createLocalTeam: (name: string) => { id: string; name: string; role: MemberRole };
    };
  }
}

export {};
