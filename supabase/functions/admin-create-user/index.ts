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
// caller sends a valid Supabase Auth access token. That alone is NOT
// sufficient authorization for a privileged action like creating a new
// auth user, though: it only proves "some logged-in account is calling
// this", not "this account is allowed to create other accounts". Any
// self-registered user (see login.html's public sign-up) previously had a
// valid session and could call this function directly to mint arbitrary
// new accounts.
//
// SECURITY FIX: this function now looks up the caller's own verified
// email in cfo_users (the CFO/owner allowlist — the only role in this app
// that is allowed to create project-admin accounts from the Users menu in
// index.html) and returns 403 if the caller isn't listed there.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── AUTHORIZATION ────────────────────────────────────────────────────
  // Resolve the caller's identity from their verified access token (the
  // gateway already checked the JWT signature/expiry before routing here;
  // we still re-resolve the user server-side via Auth so we get a trusted
  // email, not one the client could spoof in the request body), then
  // require that email to be present in the cfo_users staff allowlist.
  const authHeader = req.headers.get("Authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!callerToken) {
    return new Response(JSON.stringify({ error: "Missing bearer token" }), { status: 401 });
  }

  const { data: callerData, error: callerErr } = await admin.auth.getUser(callerToken);
  const callerEmail = callerData?.user?.email;
  if (callerErr || !callerEmail) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), { status: 401 });
  }

  const { data: cfoRows, error: cfoErr } = await admin
    .from("cfo_users")
    .select("email")
    .ilike("email", callerEmail)
    .limit(1);

  if (cfoErr) {
    return new Response(JSON.stringify({ error: "Gagal memverifikasi hak akses" }), { status: 500 });
  }
  if (!cfoRows || cfoRows.length === 0) {
    return new Response(
      JSON.stringify({ error: "Forbidden: akun ini tidak memiliki hak untuk membuat admin baru" }),
      { status: 403 },
    );
  }

  // ── REQUEST BODY ─────────────────────────────────────────────────────
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
