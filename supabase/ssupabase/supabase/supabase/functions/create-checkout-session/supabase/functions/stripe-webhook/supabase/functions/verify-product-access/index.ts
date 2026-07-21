// ============================================================
// Supabase Edge Function: verify-product-access
// Kingdom Blueprint Legacy — The Blueprint Code™
//
// Called by the frontend (with the user's auth token) to check
// whether the signed-in customer has verified, active access to
// The Blueprint Code™ 90-Day Journey. This is the ONLY source of
// truth the frontend should trust for unlocking paid content —
// never a `?payment=success` URL parameter alone.
//
// Required environment variables:
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PRODUCT_CODE = "blueprint_code_90_day";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ authenticated: false, hasAccess: false, error: "Missing Authorization header." }, 401);
  }

  const supabaseAuthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabaseAuthClient.auth.getUser();

  if (userError || !userData?.user) {
    return json({ authenticated: false, hasAccess: false }, 401);
  }
  const user = userData.user;

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: access, error: accessError } = await supabaseAdmin
    .from("product_access")
    .select("access_type, access_granted_at, purchase_id, is_active")
    .eq("user_id", user.id)
    .eq("product_code", PRODUCT_CODE)
    .eq("is_active", true)
    .maybeSingle();

  if (accessError) {
    console.error("verify-product-access lookup error:", accessError);
    return json({ authenticated: true, hasAccess: false, error: "Could not verify access." }, 500);
  }

  if (!access) {
    return json({ authenticated: true, productCode: PRODUCT_CODE, hasAccess: false });
  }

  // Look up amount paid for display purposes only (never expose
  // Stripe customer/session/payment-intent IDs to the browser).
  let amountPaid: number | null = null;
  if (access.purchase_id) {
    const { data: purchase } = await supabaseAdmin
      .from("purchases")
      .select("amount_paid")
      .eq("id", access.purchase_id)
      .maybeSingle();
    amountPaid = purchase?.amount_paid ?? null;
  }

  return json({
    authenticated: true,
    productCode: PRODUCT_CODE,
    hasAccess: true,
    accessType: access.access_type,
    purchasedAt: access.access_granted_at,
    amountPaid,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
