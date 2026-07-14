# Automated Supabase Deployment via GitHub Actions

This repo includes `.github/workflows/deploy-supabase.yml`, which automatically:

1. Applies `supabase/schema.sql` to your database
2. Deploys all three Edge Functions (`create-checkout-session`,
   `stripe-webhook`, `verify-product-access`)
3. Sets their required secrets

It runs automatically on every push to `main` that touches the
`supabase/` folder, and can also be run manually anytime from the
**Actions** tab → **Deploy Supabase** → **Run workflow**.

You still need to create the Supabase project yourself (that part
requires your account/email — nothing can automate that), but once
it exists, this workflow handles everything else for you.

---

## One-time setup (about 10 minutes)

### 1. Push this project to a GitHub repository
If it isn't already, create a repo on GitHub and push this whole
folder (including the `.github/` and `supabase/` folders) to it.

### 2. Get your Supabase Access Token
Go to https://supabase.com/dashboard/account/tokens → **Generate
new token** → name it anything (e.g. "GitHub Actions") → copy it
immediately (it's only shown once).

### 3. Get your Supabase Project Ref
In your Supabase project, go to Settings → General. Your **Reference
ID** is the short string in your project URL, e.g. if your project
URL is `https://abcdefghijklmnop.supabase.co`, your Project Ref is
`abcdefghijklmnop`.

### 4. Find your Database Password
This is the password you set when you first created the project. If
you didn't save it, go to Settings → Database → **Reset database
password** to generate a new one.

### 5. Get your Service Role Key
Settings → API → **service_role** key (this is secret — never put
this one in the frontend HTML file).

### 6. Get your Stripe keys
- **STRIPE_SECRET_KEY**: Stripe Dashboard → Developers → API keys →
  Secret key.
- **STRIPE_PRICE_ID**: Products → your Blueprint Code product → the
  Price you created (starts with `price_...`).
- **STRIPE_WEBHOOK_SECRET**: you'll get this in step 8 below, *after*
  the webhook function is deployed — come back and add it once you
  have it.

### 7. Decide your Public Site URL
Wherever you're hosting the frontend (Cloudflare Pages, Netlify,
etc.), e.g. `https://your-domain.pages.dev`. If you don't have this
yet, use a placeholder for now and update the secret later.

### 8. Add all the values as GitHub repo secrets
In your GitHub repo: **Settings → Secrets and variables → Actions →
New repository secret**. Add each of these one at a time:

| Secret name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | from step 2 |
| `SUPABASE_PROJECT_REF` | from step 3 |
| `SUPABASE_DB_PASSWORD` | from step 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 5 |
| `STRIPE_SECRET_KEY` | from step 6 |
| `STRIPE_PRICE_ID` | from step 6 |
| `STRIPE_WEBHOOK_SECRET` | temporary placeholder value for now, e.g. `pending` — you'll update this in step 10 |
| `PUBLIC_SITE_URL` | from step 7 |

### 9. Run the workflow
Go to the **Actions** tab → **Deploy Supabase (schema + Edge
Functions)** → **Run workflow** → **Run workflow** button. Watch it
run — it should finish green in under a minute. This has now created
all your database tables and deployed all three functions.

### 10. Connect the Stripe webhook (one manual step that has to happen after deployment)
1. In Supabase, go to Edge Functions → `stripe-webhook` and copy its
   URL (looks like
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`).
2. In Stripe: Developers → Webhooks → **Add endpoint** → paste that
   URL → select events `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `charge.refunded` → Add
   endpoint.
3. Stripe will show you a **Signing secret** (starts with `whsec_`).
   Copy it, go back to GitHub repo secrets, and update
   `STRIPE_WEBHOOK_SECRET` with the real value.
4. Re-run the workflow (step 9) once more so the real webhook secret
   gets applied to the deployed function.

### 11. Update the frontend
Two values still need to go directly into
`blueprint-code-assessment.html` (these are public/safe values, so
they live in the browser code, not in GitHub secrets):

```js
const SUPABASE_URL = "https://<your-project-ref>.supabase.co";
const SUPABASE_ANON_KEY = "<anon-public-key-from-Settings-API>";
```

Paste me those two values whenever you have them and I'll drop them
into the file for you, exactly like before.

---

## After this is done
- Every future change to `supabase/schema.sql` or any of the three
  function files will redeploy automatically the next time you push
  to `main`.
- You will not need to run any Supabase CLI commands by hand again.
- The only things that ever require going back into a dashboard are
  rotating a secret or changing Stripe pricing.
