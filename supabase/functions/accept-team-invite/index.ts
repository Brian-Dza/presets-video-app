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
    if (!authHeader) return jsonResponse(401, { error: 'Inicia sesión para aceptar una invitación.' });
    const caller = createClient(url, publicKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await caller.auth.getUser();
    if (userError || !user?.email) return jsonResponse(401, { error: 'La sesión ya no es válida.' });

    const payload = await request.json() as { code?: string };
    const code = payload.code?.trim().replace(/\s/g, '').toUpperCase();
    if (!code || code.length !== 24) return jsonResponse(400, { error: 'El código de invitación no es válido.' });

    const admin = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: invitation, error: inviteError } = await admin.from('team_invitations')
      .select('id, team_id, email, expires_at, accepted_at')
      .eq('token_hash', await hashCode(code))
      .eq('email', user.email.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (inviteError || !invitation) return jsonResponse(404, { error: 'No hay una invitación vigente para este correo y código.' });

    const { error: memberError } = await admin.from('team_members').upsert({
      team_id: invitation.team_id,
      user_id: user.id,
      role: 'editor',
    }, { onConflict: 'team_id,user_id', ignoreDuplicates: true });
    if (memberError) throw memberError;
    const { error: updateError } = await admin.from('team_invitations')
      .update({ accepted_at: new Date().toISOString() }).eq('id', invitation.id);
    if (updateError) throw updateError;
    return jsonResponse(200, { teamId: invitation.team_id, role: 'editor' });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : 'No se pudo aceptar la invitación.' });
  }
});
