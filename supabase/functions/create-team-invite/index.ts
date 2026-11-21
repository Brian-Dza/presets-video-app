import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { corsHeaders, jsonResponse, readSupabaseKeys } from '../_shared/http.ts';

async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'Método no permitido.' });

  try {
    const { url, publicKey, secretKey } = readSupabaseKeys();
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) return jsonResponse(401, { error: 'Inicia sesión para invitar a una persona.' });
    const caller = createClient(url, publicKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user) return jsonResponse(401, { error: 'La sesión ya no es válida.' });

    const payload = await request.json() as { teamId?: string; email?: string };
    const teamId = payload.teamId?.trim();
    const email = payload.email?.trim().toLowerCase();
    if (!teamId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse(400, { error: 'Escribe un correo válido y selecciona un equipo.' });
    }

    const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: membership, error: membershipError } = await admin.from('team_members')
      .select('role').eq('team_id', teamId).eq('user_id', user.id).maybeSingle();
    if (membershipError || membership?.role !== 'owner') return jsonResponse(403, { error: 'Solo la persona propietaria puede invitar al equipo.' });

    const code = crypto.randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase();
    const tokenHash = await hashCode(code);
    const { error: insertError } = await admin.from('team_invitations').insert({
      team_id: teamId,
      email,
      token_hash: tokenHash,
      created_by: user.id,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (insertError) throw insertError;
    return jsonResponse(200, { code, expiresInDays: 7 });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'No se pudo crear la invitación.' });
  }
});
