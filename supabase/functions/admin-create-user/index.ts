// MKH Property — admin-create-user Edge Function
//
// Replaces the previous approach where index.html called
// POST {SUPABASE_URL}/auth/v1/admin/users directly from the browser using a
// service_role key that was hardcoded in the page source — meaning any
// visitor could read it from "view source" and get full, unrestricted
// service_role access to this entire shared Supabase project (bypassing RLS
// on every table, not just this one action).
//
// Deployed with the project default (verify_jwt = true, see supabase/
// config.toml — no per-function override here), so Supabase's gateway
// already rejects the request before it reaches this code unless the
// caller sends a valid Supabase Auth access token. That is a real
// improvement over the old client-side key even though this function does
// not yet check the caller's role beyond "is a logged-in user of this
// project" — this project's admin UI does not currently model per-user
// roles for the finance app itself, only for the created project-admin
// accounts.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return new Response(JSON.stringify({ error: "email and password are required" }), { status: 400 });
  }
  if (password.length < 6) {
    return new Response(JSON.stringify({ error: "Password minimal 6 karakter" }), { status: 400 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ id: data.user?.id, email: data.user?.email }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
