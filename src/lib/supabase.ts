import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const RUNTIME_CONFIG_KEY = 'framebase.supabase.config.v1';

export interface CloudConfigSummary {
  url: string;
  anonKey: string;
  source: 'env' | 'runtime' | 'none';
  configured: boolean;
}

let cachedKey = '';
let cachedClient: SupabaseClient | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validatePublicCloudCredentials(rawUrl: string, rawKey: string): { valid: boolean; error?: string } {
  const cleanUrl = rawUrl.trim();
  const cleanKey = rawKey.trim();

  if (!cleanUrl || !cleanKey) {
    return { valid: false, error: 'Ingresa tanto el URL del proyecto como la clave pública (anon / publishable).' };
  }

  let parsed: URL;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    return { valid: false, error: 'El URL de Supabase no tiene un formato válido (ej. https://tu-proyecto.supabase.co).' };
  }

  const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    return { valid: false, error: 'El URL de Supabase debe usar HTTPS.' };
  }

  if (cleanKey.startsWith('sb_secret_') || cleanKey.toLowerCase().includes('service_role')) {
    return {
      valid: false,
      error: 'Por seguridad, nunca uses una clave privada (service_role / sb_secret_) en el cliente. Usa únicamente la clave pública anon o sb_publishable_.',
    };
  }

  const payload = decodeJwtPayload(cleanKey);
  if (payload && payload.role === 'service_role') {
    return {
      valid: false,
      error: 'Esta clave JWT corresponde a service_role. Usa exclusivamente la clave anon pública en la aplicación.',
    };
  }

  if (cleanKey.length < 20) {
    return { valid: false, error: 'La clave pública parece incompleta.' };
  }

  return { valid: true };
}

function readRuntimeConfig(): { url: string; anonKey: string } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(RUNTIME_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { url?: unknown; anonKey?: unknown };
    if (typeof parsed.url !== 'string' || typeof parsed.anonKey !== 'string') return null;
    const check = validatePublicCloudCredentials(parsed.url, parsed.anonKey);
    if (!check.valid) return null;
    return { url: parsed.url.trim().replace(/\/+$/, ''), anonKey: parsed.anonKey.trim() };
  } catch {
    return null;
  }
}

export function getCloudConfig(): CloudConfigSummary {
  const runtime = readRuntimeConfig();
  if (runtime) {
    return { url: runtime.url, anonKey: runtime.anonKey, source: 'runtime', configured: true };
  }
  const envUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (envUrl && envKey && validatePublicCloudCredentials(envUrl, envKey).valid) {
    return { url: envUrl.replace(/\/+$/, ''), anonKey: envKey, source: 'env', configured: true };
  }
  return { url: '', anonKey: '', source: 'none', configured: false };
}

export function isCloudConfiguredNow(): boolean {
  return getCloudConfig().configured;
}

export function getSupabaseClient(): SupabaseClient | null {
  const cfg = getCloudConfig();
  if (!cfg.configured) {
    cachedKey = '';
    cachedClient = null;
    return null;
  }
  const nextKey = `${cfg.url}::${cfg.anonKey}`;
  if (cachedClient && cachedKey === nextKey) {
    return cachedClient;
  }
  cachedKey = nextKey;
  cachedClient = createClient(cfg.url, cfg.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

export function saveRuntimeCloudConfig(rawUrl: string, rawKey: string): SupabaseClient {
  const check = validatePublicCloudCredentials(rawUrl, rawKey);
  if (!check.valid) {
    throw new Error(check.error);
  }
  const payload = {
    url: rawUrl.trim().replace(/\/+$/, ''),
    anonKey: rawKey.trim(),
  };
  localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(payload));
  const client = getSupabaseClient();
  if (!client) throw new Error('No se pudo inicializar el cliente de Supabase.');
  return client;
}

export function clearRuntimeCloudConfig(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(RUNTIME_CONFIG_KEY);
  }
  cachedKey = '';
  cachedClient = null;
}

export async function testCloudConnection(rawUrl: string, rawKey: string): Promise<{ ok: boolean; message: string }> {
  const check = validatePublicCloudCredentials(rawUrl, rawKey);
  if (!check.valid) {
    return { ok: false, message: check.error || 'Credenciales no válidas.' };
  }
  const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
  const cleanKey = rawKey.trim();
  try {
    const response = await fetch(`${cleanUrl}/auth/v1/settings`, {
      method: 'GET',
      headers: {
        apikey: cleanKey,
        Authorization: `Bearer ${cleanKey}`,
      },
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Supabase respondió con estado HTTP ${response.status}. Verifica el URL y la clave anon pública.`,
      };
    }
    return { ok: true, message: 'Conexión verificada correctamente con tu proyecto Supabase.' };
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? `No se pudo conectar: ${cause.message}` : 'No se pudo conectar al servidor de Supabase.',
    };
  }
}

export const isCloudConfigured = isCloudConfiguredNow();
export const supabase = getSupabaseClient();

export function getCloudSetupHint(): string | undefined {
  if (isCloudConfiguredNow()) return undefined;
  return 'Conecta tu proyecto Supabase desde Ajustes o define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.';
}
