// worker/index.js
// Cloudflare Worker for spydersammy-ai
// Bindings required when deploying with wrangler:
// - KV_NAMESPACE (Workers KV namespace binding)
// - OPENAI_API_KEY (secret)
// The worker exposes:
//  - POST /generate-key  -> { key }
//  - POST /chat          -> { reply } or { error }

const RATE_LIMIT_PER_DAY = 100;
const KEY_PREFIX = 'key:';
const USAGE_PREFIX = 'usage:';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' })
  });
}

function jsonError(msg, status = 400) {
  return jsonResponse({ error: msg }, status);
}

function corsHeaders(extra = {}) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  }, extra);
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    if (request.method === 'POST' && pathname === '/generate-key') {
      return await handleGenerateKey(request);
    }
    if (request.method === 'POST' && pathname === '/chat') {
      return await handleChat(request);
    }
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  } catch (err) {
    // avoid leaking internals
    return jsonError('server_error', 500);
  }
}

function makeToken() {
  // 32 hex chars => 16 bytes
  const arr = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleGenerateKey(request) {
  const token = makeToken();
  const meta = { created: Date.now(), active: true };
  await KV_NAMESPACE.put(KEY_PREFIX + token, JSON.stringify(meta));
  return jsonResponse({ key: token });
}

function todayBucket() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function handleChat(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonError('invalid_json', 400);
  }
  const { key, message } = body || {};
  if (!key || !message) return jsonError('missing_key_or_message', 400);

  const raw = await KV_NAMESPACE.get(KEY_PREFIX + key);
  if (!raw) return jsonError('invalid_key', 404);
  let meta;
  try { meta = JSON.parse(raw); } catch (e) { meta = null; }
  if (!meta || !meta.active) return jsonError('key_inactive', 403);

  const day = todayBucket();
  const usageKey = `${USAGE_PREFIX}${key}:${day}`;
  const usedRaw = await KV_NAMESPACE.get(usageKey);
  const used = Number(usedRaw || '0');
  if (used >= RATE_LIMIT_PER_DAY) return jsonError('rate_limited', 429);
  await KV_NAMESPACE.put(usageKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 2 });

  // Forward to OpenAI (or other provider). Requires OPENAI_API_KEY secret binding.
  const openaiKey = GLOBAL_OPENAI_KEY();
  if (!openaiKey) return jsonError('backend_misconfigured', 500);

  // Construct request for OpenAI chat completions
  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are Sammy Bot, answer questions about SpyderSammy concisely.' },
        { role: 'user', content: message }
      ],
      max_tokens: 400
    })
  });

  if (!openaiRes.ok) {
    const txt = await openaiRes.text();
    return jsonError('upstream_error', 502);
  }
  const j = await openaiRes.json();
  const reply = j.choices?.[0]?.message?.content ?? (j.choices?.[0]?.text ?? '');
  return jsonResponse({ reply });
}

// Helper to access the secret in both module and classic workers
function GLOBAL_OPENAI_KEY() {
  // In classic worker runtime secrets are available as global variables named after the secret key.
  if (typeof OPENAI_API_KEY !== 'undefined') return OPENAI_API_KEY;
  // In Wrangler's newer Modules/ENV mapping you'd receive env in the handler; not used here.
  return undefined;
}
