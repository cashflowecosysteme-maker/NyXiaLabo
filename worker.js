/**
 * Sandbox IA — _worker.js
 * -----------------------
 * Convention Cloudflare Pages : ce fichier intercepte toutes les requêtes.
 * Les routes /api/* sont traitées ici, tout le reste retombe sur les
 * fichiers statiques (login.html, dashboard.html, js/starry-bg.js, tes
 * images) via env.ASSETS.fetch().
 *
 * Auth : un seul mot de passe (tu es la seule utilisatrice), token de
 * session signé (HMAC), pas de gestion de comptes. Rien n'est stocké côté
 * serveur pour les sessions — le token se vérifie lui-même.
 *
 * Secrets à créer dans Cloudflare Pages → Settings → Environment variables
 * (type Secret, jamais Variable en clair) :
 *   ADMIN_PASSWORD        → ton mot de passe de connexion
 *   SESSION_SECRET         → chaîne aléatoire longue, sert à signer les tokens
 *   OPENROUTER_API_KEY     → ta clé OpenRouter
 *   AIMLAPI_API_KEY         → ta clé AIMLAPI
 *
 * KV à lier (Settings → Functions → KV namespace bindings) :
 *   HUB_CONFIG              → stocke la liste des fournisseurs/modèles
 */

const CONFIG_KV_KEY = "providers";
const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000; // 7 jours

const DEFAULT_CONFIG = [
  {
    id: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    api_key_secret: "OPENROUTER_API_KEY",
    format: "openai-compatible",
    featured_models: [
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", division: "conversation" },
      { id: "openai/gpt-5.2", label: "GPT-5.2", division: "conversation" },
      { id: "google/gemini-3.1-pro", label: "Gemini 3.1 Pro", division: "conversation" },
      { id: "z-ai/glm-5.2", label: "GLM (Z)", division: "conversation" },
      { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8 — Livre", division: "livre" },
      { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 — Narration", division: "narration" }
    ]
  },
  {
    id: "aimlapi",
    name: "AIMLAPI",
    base_url: "https://api.aimlapi.com/v1",
    api_key_secret: "AIMLAPI_API_KEY",
    format: "openai-compatible",
    featured_models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", division: "conversation" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8 — Livre", division: "livre" },
      { id: "gpt-5-5", label: "GPT-5.5", division: "conversation" },
      { id: "gemini-3-5-flash", label: "Gemini 3.5 Flash", division: "conversation" },
      { id: "grok-4-3", label: "Grok 4.3", division: "conversation" },
      { id: "nemotron-3-ultra", label: "Nemotron 3 Ultra — 1M contexte", division: "conversation" }
    ]
  }
];

// ---- Auth : token signé sans stockage serveur ------------------------

async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signSession(secret) {
  const payload = Date.now().toString();
  const sig = await hmacSha256(secret, payload);
  return `${payload}.${sig}`;
}

async function verifySession(secret, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  const expected = await hmacSha256(secret, payload);
  if (expected !== sig) return false;
  const ts = Number(payload);
  if (!ts || Date.now() - ts > SESSION_MAX_AGE_MS) return false;
  return true;
}

function bearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function requireAuth(request, env) {
  const token = bearerToken(request);
  return verifySession(env.SESSION_SECRET, token);
}

// ---- Adaptateur fournisseurs (format OpenAI-compatible) ---------------

async function callOpenAiCompatible(provider, env, { model, messages, max_tokens, temperature }) {
  const apiKey = provider.api_key_secret ? env[provider.api_key_secret] : null;
  if (!apiKey) throw new Error(`Clé API manquante pour ${provider.id} (secret: ${provider.api_key_secret})`);

  const started = Date.now();
  const res = await fetch(`${provider.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nyxia-sandbox.internal",
      "X-Title": "NyXia Sandbox Hub"
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: max_tokens || 2000,
      temperature: temperature ?? 0.7
    })
  });

  const elapsedMs = Date.now() - started;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Erreur ${provider.id}: ${res.status}`);

  return {
    text: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage || null,
    elapsedMs
  };
}

const ADAPTERS = { "openai-compatible": callOpenAiCompatible };

// ---- Helpers ----------------------------------------------------------

async function getConfig(env) {
  if (env.HUB_CONFIG) {
    const stored = await env.HUB_CONFIG.get(CONFIG_KV_KEY, "json");
    if (stored) return stored;
  }
  return DEFAULT_CONFIG;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

// ---- Router ----------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- Connexion ---
    if (request.method === "POST" && url.pathname === "/api/login") {
      const { password } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
        return json({ success: false, error: "Serveur mal configuré (secrets manquants)." }, 500);
      }
      if (password !== env.ADMIN_PASSWORD) {
        return json({ success: false, error: "Mot de passe incorrect." }, 401);
      }
      const token = await signSession(env.SESSION_SECRET);
      return json({ success: true, token });
    }

    if (request.method === "POST" && url.pathname === "/api/check-auth") {
      const { token } = await request.json().catch(() => ({}));
      const valid = await verifySession(env.SESSION_SECRET, token);
      return json({ valid });
    }

    // --- Routes protégées ---
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/login" && url.pathname !== "/api/check-auth") {
      const ok = await requireAuth(request, env);
      if (!ok) return json({ error: "Non autorisé" }, 401);
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      const config = await getConfig(env);
      const safe = config.map(({ api_key_secret, ...rest }) => rest);
      return json({ providers: safe });
    }

    if (request.method === "PUT" && url.pathname === "/api/config") {
      if (!env.HUB_CONFIG) return json({ error: "KV HUB_CONFIG non lié" }, 500);
      const body = await request.json();
      await env.HUB_CONFIG.put(CONFIG_KV_KEY, JSON.stringify(body.providers || body));
      return json({ ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const { providerId, model, messages, max_tokens, temperature } = await request.json();
        const config = await getConfig(env);
        const provider = config.find(p => p.id === providerId);
        if (!provider) return json({ error: `Fournisseur inconnu: ${providerId}` }, 400);
        const adapter = ADAPTERS[provider.format];
        if (!adapter) return json({ error: `Format non supporté: ${provider.format}` }, 400);
        const result = await adapter(provider, env, { model, messages, max_tokens, temperature });
        return json(result);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/models") {
      const providerId = url.searchParams.get("provider") || "openrouter";
      const config = await getConfig(env);
      const provider = config.find(p => p.id === providerId);
      if (!provider) return json({ error: "Fournisseur inconnu" }, 400);
      const res = await fetch(`${provider.base_url}/models`);
      return json(await res.json());
    }

    // --- Tout le reste : fichiers statiques (login.html, dashboard.html, js/, images) ---
    return env.ASSETS.fetch(request);
  }
};
