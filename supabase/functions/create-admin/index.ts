import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const allowedOrigin = Deno.env.get("ADMIN_PROVISIONING_ORIGIN") ?? "";
const isProduction = (Deno.env.get("APP_ENV") ?? "production").toLowerCase() === "production";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Provisioning-Secret",
};
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!allowedOrigin || req.headers.get("origin") !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);

  const provisioningSecret = Deno.env.get("ADMIN_PROVISIONING_SECRET");
  if (!provisioningSecret || req.headers.get("X-Provisioning-Secret") !== provisioningSecret) return json({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const email = Deno.env.get("ADMIN_EMAIL");
  const password = Deno.env.get("ADMIN_PASSWORD");
  if (!url || !serviceRoleKey || !email || !password || password.length < 12) return json({ error: "Admin provisioning environment is incomplete" }, 500);

  const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const claimToken = crypto.randomUUID();
  const { data: claimed, error: claimError } = await supabase.rpc("claim_admin_bootstrap", { p_claim_token: claimToken, p_ttl_seconds: 300 });
  if (claimError) return json({ error: "Bootstrap state unavailable" }, 500);
  if (!claimed) return json({ error: "Admin bootstrap is already consumed or being processed" }, 409);

  try {
    let foundUser = null;
    const perPage = 1000;
    for (let page = 1; page <= 20 && !foundUser; page += 1) {
      const result = await supabase.auth.admin.listUsers({ page, perPage });
      if (result.error) throw result.error;
      foundUser = result.data.users.find((candidate) => candidate.email?.toLowerCase() === email.toLowerCase()) ?? null;
      if (result.data.users.length < perPage) break;
    }

    let user = foundUser;
    if (user) {
      const updated = await supabase.auth.admin.updateUserById(user.id, { password, email_confirm: true });
      if (updated.error) throw updated.error;
      user = updated.data.user;
    } else {
      const created = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      user = created.data.user;
    }

    const profile = await supabase.from("staff_profiles").upsert({ user_id: user.id, role: "ADMIN", is_active: true }, { onConflict: "user_id" });
    if (profile.error) throw profile.error;

    const marked = await supabase
      .from("admin_bootstrap")
      .update({ used_at: new Date().toISOString(), used_by: user.id })
      .eq("id", true)
      .eq("claim_token", claimToken)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (marked.error || !marked.data) return json({ error: "Bootstrap claim was lost before completion" }, 409);

    return json({ message: "Admin user provisioned", id: user.id });
  } catch (err) {
    await supabase.from("admin_bootstrap").update({ claim_token: null, claimed_at: null, expires_at: null }).eq("id", true).eq("claim_token", claimToken).is("used_at", null);
    if (!isProduction) console.error(err);
    return json({ error: "Admin provisioning failed" }, 500);
  }
});
