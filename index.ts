// ============================================================
// Supabase Edge Function: create-checkout-session
// Kingdom Blueprint Legacy — The Blueprint Code™
//
// Requires an authenticated Supabase user (via the Authorization
// header the browser automatically sends when using supabase-js).
// Creates a Stripe Checkout Session in one-time "payment" mode and
// returns ONLY the secure checkout URL to the frontend.
//
// Required environment variables (set via `supabase secrets set`):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (server-side only — never in browser code)
//   STRIPE_SECRET_KEY           (server-side only — never in browser code)
//   STRIPE_PRICE_ID
//   PUBLIC_SITE_URL             (e.g. https://your-domain.pages.dev)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_PRICE_ID = Deno.env.get("STRIPE_PRICE_ID")!;
const PUBLIC_SITE_URL = Deno.env.get("PUBLIC_SITE_URL") ?? "http://localhost:8000";

const PRODUCT_CODE = "blueprint_code_90_day";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // tighten to your exact domain in production
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Require an authenticated Supabase user.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing Authorization header." }, 401);
    }

    // Use the anon key + the caller's JWT to identify the user
    // (this validates the token; it does NOT bypass RLS).
    const supabaseAuthClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabaseAuthClient.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Invalid or expired session. Please sign in again." }, 401);
    }
    const user = userData.user;
    if (!user.email) {
      return json({ error: "A verified email address is required before checkout." }, 400);
    }

    // Service-role client for privileged reads/writes (bypasses RLS).
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Optional: block re-purchase if the user already has active access.
    const { data: existingAccess } = await supabaseAdmin
      .from("product_access")
      .select("id, is_active")
      .eq("user_id", user.id)
      .eq("product_code", PRODUCT_CODE)
      .eq("is_active", true)
      .maybeSingle();

    if (existingAccess) {
      return json({ error: "You already have active lifetime access to this product." }, 400);
    }

    // 2–8. Create the Stripe Checkout Session.
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      customer_email: user.email,
      success_url: `${PUBLIC_SITE_URL}/purchase-success?session_id={CHECKOUT_SESSION_ID}&payment=success`,
      cancel_url: `${PUBLIC_SITE_URL}/?checkout=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        product_code: PRODUCT_CODE,
        access_type: "lifetime",
      },
    });

    // 9. Return only the secure checkout URL — never the session's
    // internal Stripe object or any secret key.
    return json({ url: session.url });
  } catch (err) {
    console.error("create-checkout-session error:", err);
    return json({ error: "Unable to start checkout. Please try again." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
