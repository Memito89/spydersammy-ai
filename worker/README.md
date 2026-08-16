Cloudflare Worker for spydersammy-ai

This folder contains a simple Cloudflare Worker that implements two endpoints used by the static site:

- POST /generate-key  -> returns JSON { key: "..." }
- POST /chat          -> accepts { key, message } and returns { reply }

The worker expects the following bindings when deployed:

- KV namespace binding named: KV_NAMESPACE
- Secret named: OPENAI_API_KEY

Quick deploy steps (using wrangler)

1. Install wrangler (if you do not have it):
   npm i -g wrangler

2. Create a Workers KV namespace in the Cloudflare dashboard. Note its id.

3. Update worker/wrangler.toml
   - Set `account_id` to your Cloudflare account id (optional for workers_dev deployments)
   - Replace the `id` field under [[kv_namespaces]] with the KV namespace id from step 2

4. Bind the OPENAI_API_KEY secret:
   wrangler secret put OPENAI_API_KEY
   (When prompted, paste your OpenAI API key or other provider key.)

5. Publish the worker:
   cd worker
   wrangler publish

Notes & configuration

- The worker uses a KV key naming scheme `key:<token>` for generated client keys and `usage:<token>:YYYY-MM-DD` for daily usage counters.
- The default daily rate limit is 100 messages per key. Change RATE_LIMIT_PER_DAY in worker/index.js if you want a different limit.
- The worker returns CORS headers (Access-Control-Allow-Origin: *) so the static site can call it directly from the browser.
- If you want to restrict CORS to your Pages domain, edit the corsHeaders function in worker/index.js and replace '*' with your pages origin.

If you want, I can also create a GitHub Actions workflow to deploy the Worker automatically when you push to main; tell me if you'd like that and provide the Cloudflare account id and KV id (or I can leave placeholders and instructions).