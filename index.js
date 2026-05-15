import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}

function makeTempPassword() {
  return 'LM' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function validEmail(email) {
  return /^\S+@\S+\.\S+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration is incomplete.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { data: userData, error: userError } =
    await authClient.auth.getUser();

  if (userError || !userData.user) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  const { data: callerProfile, error: callerError } =
    await authClient
      .from('profiles')
      .select('role, active')
      .eq('id', userData.user.id)
      .single();

  if (
    callerError ||
    !callerProfile ||
    callerProfile.active === false ||
    callerProfile.role !== 'admin'
  ) {
    return json({
      error: 'Only admin can create staff accounts.'
    }, 403);
  }

  const payload = await req.json().catch(() => ({}));

  const email = String(payload.email || '')
    .trim()
    .toLowerCase();

  const username = String(payload.username || '')
    .trim()
    .toLowerCase();

  const fullName = String(payload.fullName || '').trim();

  const role =
    payload.role === 'admin' ||
    payload.role === 'warehouse_manager'
      ? payload.role
      : 'staff';

  const location =
    role === 'admin' || role === 'warehouse_manager'
      ? 'All'
      : payload.location === 'Morocco'
        ? 'Morocco'
        : 'Alabar';

  if (!validEmail(email)) {
    return json({
      error: 'A valid email is required.'
    }, 400);
  }

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return json({
      error: 'A valid username is required.'
    }, 400);
  }

  if (!fullName) {
    return json({
      error: 'Full name is required.'
    }, 400);
  }

  const tempPassword = makeTempPassword();

  try {
    const { data: createdUser, error: createUserError } =
      await serviceClient.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          username,
          full_name: fullName,
          role,
          location,
          must_change_password: true
        }
      });

    if (createUserError || !createdUser?.user) {
      return json({
        error:
          createUserError?.message ||
          'Could not create auth user.'
      }, 400);
    }

    const upsertPayload = {
      id: createdUser.user.id,
      email,
      username,
      full_name: fullName,
      role,
      location,
      active: true,
      must_change_password: true
    };

    const { data: profileData, error: profileError } =
      await serviceClient
        .from('profiles')
        .upsert(upsertPayload)
        .select(
          'id, email, username, full_name, role, location, active, must_change_password'
        )
        .single();

    if (profileError) {
      try {
        await serviceClient.auth.admin.deleteUser(
          createdUser.user.id
        );
      } catch (_) {}

      return json({
        error:
          profileError.message ||
          'Could not create profile.'
      }, 400);
    }

    return json({
  tempPassword,
  userId: createdUser.user.id,

  // debug
  receivedRole: payload.role,
  savedRole: role,
  savedLocation: location,

  profile: profileData || upsertPayload
});

  } catch (err) {
    return json({
      error:
        err?.message ||
        'Unexpected server error'
    }, 500);
  }
});