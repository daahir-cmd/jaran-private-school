import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = (origin: string | null) => ({
  ...(origin && ['https://daahir-cmd.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request.headers.get('Origin')) });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405, request.headers.get('Origin'));

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return jsonResponse({ error: 'Sign in as an administrator first.' }, 401, request.headers.get('Origin'));
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return jsonResponse({ error: 'Account service is not configured.' }, 500, request.headers.get('Origin'));

  const token = authorization.slice('Bearer '.length);
  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: 'Your session is invalid. Sign in again.' }, 401, request.headers.get('Origin'));

  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: caller, error: callerError } = await adminClient.from('profiles')
    .select('role').eq('user_id', userData.user.id).maybeSingle();
  if (callerError) {
    console.error('Unable to verify account administrator.', callerError.message);
    return jsonResponse({ error: 'Unable to verify administrator access.' }, 500, request.headers.get('Origin'));
  }
  if (caller?.role !== 'admin') return jsonResponse({ error: 'Only administrators can reset accounts.' }, 403, request.headers.get('Origin'));

  let input: unknown;
  try { input = await request.json(); } catch { return jsonResponse({ error: 'Invalid request.' }, 400, request.headers.get('Origin')); }
  const loginId = isRecord(input) && typeof input.loginId === 'string' ? input.loginId.trim().toUpperCase() : '';
  if (!/^[A-Z][A-Z0-9_-]{2,31}$/.test(loginId)) return jsonResponse({ error: 'Invalid account ID.' }, 400, request.headers.get('Origin'));

  const { data: profile, error: profileError } = await adminClient.from('profiles')
    .select('user_id,role').eq('login_id', loginId).maybeSingle();
  if (profileError) {
    console.error('Unable to find account for password reset.', profileError.message);
    return jsonResponse({ error: 'Unable to find that account.' }, 500, request.headers.get('Origin'));
  }
  if (!profile || profile.role === 'admin') return jsonResponse({ error: 'That account cannot be reset here.' }, 404, request.headers.get('Origin'));

  const temporaryPassword = createTemporaryPassword();
  const { error: flagError } = await adminClient.from('profiles')
    .update({ must_change_password: true }).eq('user_id', profile.user_id);
  if (flagError) {
    console.error('Unable to require a password change after reset.', flagError.message);
    return jsonResponse({ error: 'Unable to prepare the account reset.' }, 500, request.headers.get('Origin'));
  }
  const { error: passwordError } = await adminClient.auth.admin.updateUserById(profile.user_id, { password: temporaryPassword });
  if (passwordError) {
    console.error('Unable to reset account password.', passwordError.message);
    return jsonResponse({ error: 'Unable to reset this account.' }, 500, request.headers.get('Origin'));
  }
  return jsonResponse({ loginId, temporaryPassword }, 200, request.headers.get('Origin'));
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function jsonResponse(body: Record<string, string>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

