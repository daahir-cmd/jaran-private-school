import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = (origin: string | null) => ({
  ...(origin && ['https://daahir-cmd.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173'].includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}),
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

const loginIdPattern = /^[A-Z][A-Z0-9_-]{2,31}$/;
const allowedRoles = new Set(['teacher', 'finance', 'student']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(request.headers.get('Origin')) });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, request.headers.get('Origin'));
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Sign in as an administrator first.' }, 401, request.headers.get('Origin'));
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'Account service is not configured.' }, 500, request.headers.get('Origin'));
  }

  const token = authorization.slice('Bearer '.length);
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Your session is invalid. Sign in again.' }, 401, request.headers.get('Origin'));
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data: caller, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (profileError) {
    console.error('Unable to verify account administrator.', profileError.message);
    return jsonResponse({ error: 'Unable to verify administrator access.' }, 500, request.headers.get('Origin'));
  }
  if (caller?.role !== 'admin') {
    return jsonResponse({ error: 'Only administrators can create accounts.' }, 403, request.headers.get('Origin'));
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request.' }, 400, request.headers.get('Origin'));
  }
  if (!isRecord(input)) {
    return jsonResponse({ error: 'Invalid request.' }, 400, request.headers.get('Origin'));
  }

  const loginId = typeof input.loginId === 'string' ? input.loginId.trim().toUpperCase() : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  const role = typeof input.role === 'string' ? input.role : '';
  const classId = typeof input.classId === 'string' ? input.classId : null;
  const studentId = typeof input.studentId === 'string' ? input.studentId : null;
  if (!loginIdPattern.test(loginId) || !displayName || displayName.length > 100 || !allowedRoles.has(role)) {
    return jsonResponse({ error: 'Check the account ID, name, and role.' }, 400, request.headers.get('Origin'));
  }
  if ((role === 'teacher' || role === 'student') && !isUuid(classId)) {
    return jsonResponse({ error: 'Choose a valid class for this account.' }, 400, request.headers.get('Origin'));
  }
  if (role === 'student' && !isUuid(studentId)) {
    return jsonResponse({ error: 'Choose a valid student record.' }, 400, request.headers.get('Origin'));
  }
  if (role !== 'student' && studentId) {
    return jsonResponse({ error: 'Only student accounts may be linked to a student record.' }, 400, request.headers.get('Origin'));
  }

  if (classId) {
    const { data: store, error: storeError } = await adminClient
      .from('school_store')
      .select('data')
      .eq('id', 1)
      .single();
    if (storeError) {
      console.error('Unable to validate account assignment.', storeError.message);
      return jsonResponse({ error: 'Unable to verify the selected class.' }, 500, request.headers.get('Origin'));
    }
    const classes = Array.isArray(store.data?.classes) ? store.data.classes : [];
    const selectedClass = classes.find((entry: unknown) =>
      isRecord(entry) && entry.id === classId
    );
    if (!selectedClass) {
      return jsonResponse({ error: 'The selected class does not exist.' }, 400, request.headers.get('Origin'));
    }
    if (role === 'student') {
      const students = Array.isArray(selectedClass.students) ? selectedClass.students : [];
      if (!students.some((entry: unknown) => isRecord(entry) && entry.id === studentId)) {
        return jsonResponse({ error: 'The student is not in the selected class.' }, 400, request.headers.get('Origin'));
      }
    }
  }

  const email = `${loginId.toLowerCase()}@accounts.jaran.invalid`;
  const temporaryPassword = createTemporaryPassword();
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (createError || !created.user) {
    if (createError?.message.includes('already been registered')) {
      return jsonResponse({ error: 'That account ID is already in use.' }, 409, request.headers.get('Origin'));
    }
    console.error('Unable to create account.', createError?.message);
    return jsonResponse({ error: 'Unable to create the account.' }, 500, request.headers.get('Origin'));
  }

  const { error: insertError } = await adminClient.from('profiles').insert({
    user_id: created.user.id,
    login_id: loginId,
    display_name: displayName,
    role,
    class_id: role === 'teacher' || role === 'student' ? classId : null,
    student_id: role === 'student' ? studentId : null,
    must_change_password: true,
  });
  if (insertError) {
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error('Unable to roll back incomplete account.', deleteError.message);
    }
    console.error('Unable to save account profile.', insertError.message);
    return jsonResponse({ error: 'Unable to save the account profile.' }, 500, request.headers.get('Origin'));
  }

  return jsonResponse({ loginId, temporaryPassword }, 201, request.headers.get('Origin'));
});

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function jsonResponse(body: Record<string, string>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

