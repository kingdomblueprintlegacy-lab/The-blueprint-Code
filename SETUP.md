# The Blueprint Code™ — Production Setup Guide
Kingdom Blueprint Legacy

This guide connects the frontend (`blueprint-code-assessment.html`) to a real
Supabase project and Stripe account. Nothing in the frontend can go live
until the steps below are completed — until then, sign-up/sign-in/checkout
will show connection errors, which is expected and safe (it means no one
can fake a purchase).

---

## 1. Supabase project setup

1. Create a project at https://supabase.com.
2. Note your **Project URL** and **anon public key** (Settings → API).
   These two values are safe to put in browser code.
3. Note your **service_role key** (Settings → API). This key must
   **never** appear in the HTML/JS file or any public repo — it is used
   only inside the two server-side Edge Functions.

## 2. Database SQL

1. Open the Supabase SQL Editor.
2. Paste and run the contents of `supabase/schema.sql` (included with this
   delivery). This creates all 8 tables (`profiles`, `assessment_results`,
   `purchases`, `product_access`, `journey_progress`, `journal_entries`,
   `weekly_check_ins`, `certificates`) with Row-Level Security enabled.

## 3. Row-Level Security policies

Already included in `schema.sql`. Key points to understand:

- Every table restricts `select` (and, where applicable, `insert`/`update`)
  to `auth.uid() = user_id`.
- `purchases` and `product_access` have **no** insert/update policy for
  logged-in users — only the service-role key (used exclusively inside
  Edge Functions) can write to them. This is what prevents a customer
  from granting themselves free access via browser dev tools.

## 4. Authentication configuration

1. In Supabase, go to Authentication → Providers and confirm **Email**
   is enabled.
2. Authentication → URL Configuration: set your **Site URL** to your
   production domain (e.g. `https://your-domain.pages.dev`), and add
   `/purchase-success` and any other routes you use as **Redirect URLs**.
3. Optional: enable **Magic Link** under Authentication → Providers if you
   want passwordless sign-in later (the frontend has a placeholder for it).
4. Customize the email templates (confirmation, password reset) under
   Authentication → Email Templates.

## 5. Stripe account setup

1. Create/log into a Stripe account at https://stripe.com.
2. Complete business verification before going live (test mode works
   immediately for development).

## 6. Stripe product and $27 Price creation

1. Products → Add Product: name it
   **"The Blueprint Code™ Personalized 90-Day Growth Journey"**.
2. Add a **one-time price** of **$27.00 USD**.
3. Copy the generated **Price ID** (starts with `price_...`).
4. Optionally also record the $65 regular value as a second (unused)
   price or simply as display copy — the app shows $65 as a struck-
   through reference price, not a second live Stripe price.

## 7. Stripe Checkout configuration

No separate Checkout configuration is required — the
`create-checkout-session` Edge Function creates a Checkout Session in
`payment` (one-time) mode programmatically using the Price ID above.

## 8. Webhook setup

1. Deploy the `stripe-webhook` Edge Function (step 9 below) first, so you
   have its public URL.
2. In Stripe: Developers → Webhooks → Add endpoint.
   - Endpoint URL: `https://<your-project-ref>.supabase.co/functions/v1/stripe-webhook`
   - Events to send: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `charge.refunded`.
3. Copy the **Signing secret** (starts with `whsec_...`) into
   `STRIPE_WEBHOOK_SECRET` (see environment variables below).

## 9. Deploying the Edge Functions

With the Supabase CLI installed and logged in:

```bash
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy verify-product-access
```

`stripe-webhook` uses `--no-verify-jwt` because Stripe calls it directly
(with its own signature, verified inside the function) — it is never
called by the browser.

## 10. Required environment variables

Set these as Supabase Edge Function secrets:

```bash
supabase secrets set SUPABASE_URL=https://<your-project-ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
supabase secrets set STRIPE_SECRET_KEY=<sk_live_or_sk_test_...>
supabase secrets set STRIPE_WEBHOOK_SECRET=<whsec_...>
supabase secrets set STRIPE_PRICE_ID=<price_...>
supabase secrets set PUBLIC_SITE_URL=https://your-domain.pages.dev
```

`SUPABASE_ANON_KEY` does not need to be set as a secret — Supabase
injects it automatically for Edge Functions, and it also belongs in the
**public** frontend config (see below).

In the frontend HTML file, fill in near the top of the `<script>` block:

```js
const SUPABASE_URL = "https://<your-project-ref>.supabase.co"; // public
const SUPABASE_ANON_KEY = "<anon-public-key>";                  // public
```

Only these two may ever appear in browser code. `SUPABASE_SERVICE_ROLE_KEY`,
`STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` must stay server-side only.

## 11. Local testing instructions

```bash
supabase start                     # local Supabase stack
supabase functions serve           # serve Edge Functions locally
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
```

Point the frontend's `SUPABASE_URL`/`SUPABASE_ANON_KEY` at your local
instance while testing.

## 12. Stripe test-card instructions

In test mode, use card number `4242 4242 4242 4242`, any future expiry,
any 3-digit CVC, and any postal code. Use `4000 0000 0000 9995` to
simulate a decline, and `4000 0000 0000 0341` to test a card that fails
after being attached.

## 13. Production deployment instructions

1. Host the static HTML file on Cloudflare Pages, Netlify, or a similar
   static host — drag-and-drop or connect a Git repo.
2. Set `PUBLIC_SITE_URL` (Edge Function secret) to the final production
   URL, and update Supabase Auth's Site URL/Redirect URLs to match.
3. Switch `STRIPE_SECRET_KEY` and the Price ID from test mode to live
   mode, and re-point the Stripe webhook endpoint's signing secret.
4. Set `DEVELOPMENT_PREVIEW_MODE = false` in the frontend (already the
   default) before publishing.

## 14. Cal.com variables still needed

In `CAL_BOOKING_TYPES` (frontend), every entry except `generalStrategy`
currently reads `"ADD_EXACT_CAL_EVENT_LINK"`. Replace each with the real
Cal.com event URL for that coaching type as those offerings go live.
Until replaced, the app safely falls back to the general strategy link:
`https://cal.com/kingdom-blueprint-legacy-qj14cj`.

## 15. Support email placeholder

Set `const SUPPORT_EMAIL = "ADD_SUPPORT_EMAIL";` in the frontend to a
real monitored inbox before launch.

## 16. Privacy and terms placeholders

The Terms of Use, Privacy Policy, Refund Policy, and Digital Product
License links on the paywall/offer screen currently point to `#`.
Replace with real pages before accepting live payments — this is a
legal requirement in most jurisdictions, not just good practice.

## 17. Changing the sale price later

1. In Stripe, create a new Price on the same Product (Stripe prices are
   immutable once created).
2. Update `STRIPE_PRICE_ID` (Edge Function secret) to the new Price ID.
3. Update `PRODUCT_CONFIG.salePrice` in the frontend to match, so the
   displayed price stays in sync with what Stripe actually charges.

## 18. Restoring the regular $65 price

To end the launch sale and charge $65 going forward:

1. Create a new $65 one-time Stripe Price.
2. Update `STRIPE_PRICE_ID` to that Price ID.
3. In the frontend, set `PRODUCT_CONFIG.salePrice = 65` and remove or
   update the "Launch Sale" / "You Save $38" messaging so it no longer
   references a discount that no longer applies.

---

## Important limitations (please read before assuming this is free to run)

- **Supabase** has a free tier with usage limits (database size, monthly
  active users, Edge Function invocations). Growth beyond those limits
  requires a paid plan.
- **Hosting** (Cloudflare Pages / Netlify) has a free tier with bandwidth
  and build-minute limits; heavy traffic may require a paid tier.
- **Stripe** has no standard monthly fee but charges a per-transaction
  processing fee (typically around 2.9% + $0.30 per US card transaction;
  confirm current rates on Stripe's pricing page).
- **A custom domain** is a separate cost from your domain registrar if you
  don't already own one.
- **Email service**: this build only prepares placeholders for automated
  emails (welcome, reminders, receipts). A transactional email provider
  (e.g. Postmark, Resend, SendGrid) will likely require its own paid plan
  once you exceed its free tier.
- **Customer volume**: as sign-ups and purchases grow, expect to revisit
  Supabase, hosting, Stripe, and email pricing tiers.

Nothing above is a reason not to launch — it simply means "free to start,
not free at any scale," which is normal for this kind of stack.
