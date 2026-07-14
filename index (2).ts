// ============================================================
// Supabase Edge Function: stripe-webhook
// Kingdom Blueprint Legacy — The Blueprint Code™
//
// Receives events directly from Stripe (not from the browser).
// Verifies the webhook signature, then handles:
//   - checkout.session.completed
//   - charge.refunded
//   - checkout.session.async_payment_succeeded
//   - checkout.session.async_payment_failed
//
// Required environment variables:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//
// After deploying, register this function's URL as an endpoint in
// the Stripe Dashboard (Developers > Webhooks) subscribed to the
// events above, and copy the generated signing secret into
// STRIPE_WEBHOOK_SECRET.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@16?target=deno";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const PRODUCT_CODE = "blueprint_code_90_day";

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  // 1. Verify the Stripe webhook signature. Reject anything that
  // doesn't verify — this is what prevents a forged request from
  // granting free access.
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("Missing stripe-signature header");
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response("Webhook signature verification failed.", { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await supabaseAdmin
          .from("purchases")
          .update({ payment_status: "failed" })
          .eq("stripe_checkout_session_id", session.id);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await handleRefund(charge);
        break;
      }
      default:
        // Unhandled event types are simply acknowledged.
        break;
    }

    // 9. Return a successful response to Stripe.
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("stripe-webhook handler error:", err);
    // Returning a 500 tells Stripe to retry the event later.
    return new Response("Internal error handling webhook.", { status: 500 });
  }
});

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  // 3. Confirm payment_status equals "paid".
  if (session.payment_status !== "paid") {
    console.log(`Session ${session.id} not yet paid (status: ${session.payment_status}).`);
    return;
  }

  // 4. Read the authenticated user ID from Stripe metadata.
  const userId = session.metadata?.supabase_user_id;
  const productCode = session.metadata?.product_code || PRODUCT_CODE;
  const accessType = session.metadata?.access_type || "lifetime";

  if (!userId) {
    console.error(`Checkout session ${session.id} completed with no supabase_user_id in metadata.`);
    return;
  }

  // 8. Prevent duplicate purchase records (stripe_checkout_session_id
  // has a unique constraint; upsert on that key is idempotent even
  // if Stripe retries the same event).
  const { data: purchase, error: purchaseError } = await supabaseAdmin
    .from("purchases")
    .upsert(
      {
        user_id: userId,
        product_code: productCode,
        stripe_customer_id: (session.customer as string) || null,
        stripe_checkout_session_id: session.id,
        stripe_payment_intent_id: (session.payment_intent as string) || null,
        payment_status: "paid",
        amount_paid: session.amount_total ?? null,
        currency: session.currency ?? "usd",
        access_type: accessType,
        purchased_at: new Date().toISOString(),
        access_active: true,
      },
      { onConflict: "stripe_checkout_session_id" }
    )
    .select()
    .single();

  if (purchaseError) {
    console.error("Failed to upsert purchase record:", purchaseError);
    throw purchaseError;
  }

  // 6. Grant lifetime product access (idempotent: check for an
  // existing active access row for this user + product first).
  const { data: existingAccess } = await supabaseAdmin
    .from("product_access")
    .select("id")
    .eq("user_id", userId)
    .eq("product_code", productCode)
    .maybeSingle();

  if (existingAccess) {
    await supabaseAdmin
      .from("product_access")
      .update({
        purchase_id: purchase.id,
        access_type: accessType,
        access_granted_at: new Date().toISOString(),
        access_revoked_at: null,
        is_active: true,
      })
      .eq("id", existingAccess.id);
  } else {
    await supabaseAdmin.from("product_access").insert({
      user_id: userId,
      product_code: productCode,
      purchase_id: purchase.id,
      access_type: accessType,
      access_granted_at: new Date().toISOString(),
      is_active: true,
    });
  }

  console.log(`Access granted for user ${userId} on product ${productCode}.`);
}

async function handleRefund(charge: Stripe.Charge) {
  const paymentIntentId = charge.payment_intent as string | null;
  if (!paymentIntentId) return;

  // Only fully refunded charges revoke access automatically, per
  // business policy. Partial refunds are recorded but do not
  // change access_active — revoke manually if your policy differs.
  const isFullRefund = charge.amount_refunded >= charge.amount;

  const { data: purchase } = await supabaseAdmin
    .from("purchases")
    .select("id, user_id, product_code")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (!purchase) {
    console.error(`No purchase found for payment_intent ${paymentIntentId}.`);
    return;
  }

  if (!isFullRefund) {
    console.log(`Partial refund on purchase ${purchase.id}; access left unchanged.`);
    return;
  }

  await supabaseAdmin
    .from("purchases")
    .update({ payment_status: "refunded", refunded_at: new Date().toISOString(), access_active: false })
    .eq("id", purchase.id);

  await supabaseAdmin
    .from("product_access")
    .update({ is_active: false, access_revoked_at: new Date().toISOString() })
    .eq("purchase_id", purchase.id);

  console.log(`Access revoked for user ${purchase.user_id} due to full refund.`);
}
