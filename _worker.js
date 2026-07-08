/**
 * Sandbox IA — _worker.js (v2)
 * ------------------------------
 * Architecture : tout est un "Outil" (nom, catégorie, prompt système,
 * fournisseur, modèle). NyXia est un outil comme les autres — son prompt
 * système est éditable directement dans l'interface, pas figé dans le code.
 *
 * Ajouter/retirer un outil ou un fournisseur se fait via l'interface
 * (formulaires), plus besoin de curl.
 *
 * Secrets (Settings → Variables and Secrets, type Secret) :
 *   ADMIN_PASSWORD, SESSION_SECRET, OPENROUTER_API_KEY, AIMLAPI_API_KEY,
 *   PEXELS_KEY (déjà présente chez toi)
 *
 * KV lié : HUB_CONFIG (clés "providers" et "tools")
 */

const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

const DEFAULT_PROVIDERS = [
  {
    id: "openrouter", name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    api_key_secret: "OPENROUTER_API_KEY", format: "openai-compatible"
  },
  {
    id: "aimlapi", name: "AIMLAPI",
    base_url: "https://api.aimlapi.com/v1",
    api_key_secret: "AIMLAPI_API_KEY", format: "openai-compatible"
  }
];

const DEFAULT_TOOLS = [
  {
    id: "nyxia", name: "NyXia", icon: "💜", category: "conversation",
    providerId: "openrouter", model: "z-ai/glm-5.2",
    system_prompt: "Tu es NyXia, l'accompagnatrice réflexive de Diane Boyer. Tu utilises le tutoiement, un ton chaleureux et empathique, ancré dans la méthodologie A.M.I.E Neuro-Alchimie (Apaiser, Moduler, Intégrer, Émerger). Modifie ce prompt directement ici pour tester différentes versions de NyXia.",
    max_tokens: 2000, temperature: 0.8
  },
  { id: "claude", name: "Claude Sonnet 5", icon: "🤖", category: "conversation", providerId: "openrouter", model: "anthropic/claude-sonnet-5", system_prompt: "", max_tokens: 2000, temperature: 0.7 },
  { id: "gpt", name: "GPT-5.2", icon: "🤖", category: "conversation", providerId: "openrouter", model: "openai/gpt-5.2", system_prompt: "", max_tokens: 2000, temperature: 0.7 },
  { id: "gemini", name: "Gemini 3.1 Pro", icon: "🤖", category: "conversation", providerId: "openrouter", model: "google/gemini-3.1-pro", system_prompt: "", max_tokens: 2000, temperature: 0.7 },
  { id: "glm", name: "Z (GLM 5.2)", icon: "🤖", category: "conversation", providerId: "openrouter", model: "z-ai/glm-5.2", system_prompt: "", max_tokens: 2000, temperature: 0.7 },
  { id: "livre-claude", name: "Chapitre — Claude Opus 4.8", icon: "📖", category: "livre", providerId: "openrouter", model: "anthropic/claude-opus-4.8", system_prompt: "Tu écris un chapitre complet et cohérent en français, dans un style romanesque immersif. Vise environ 30 000 caractères sauf indication contraire.", max_tokens: 8000, temperature: 0.85 },
  { id: "narration-1", name: "Continuité personnages", icon: "🎭", category: "narration", providerId: "openrouter", model: "anthropic/claude-sonnet-5", system_prompt: "Tu es gardien de la continuité narrative de l'univers des Terres de Brume. Garde la cohérence des personnages, de leurs voix, et de la chronologie.", max_tokens: 3000, temperature: 0.9 }
];

const CATEGORY_LABELS = {
  conversation: { icon: "💬", name: "Conversation" },
  livre: { icon: "📖", name: "Écriture de livre" },
  narration: { icon: "🎭", name: "Narration & personnages" },
  consultation: { icon: "🧭", name: "Outils Consultation" },
  exercices: { icon: "✨", name: "Générateur d'exercices" },
  contenu: { icon: "🖋️", name: "Outils création contenu" },
  publication: { icon: "📣", name: "Publication de contenu" }
};

// ---- Auth (token signé, sans stockage serveur) ----

async function hmacSha256(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  let binary = "";
  new Uint8Array(sig).forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signSession(secret) {
  const payload = Date.now().toString();
  return `${payload}.${await hmacSha256(secret, payload)}`;
}
async function verifySession(secret, token) {
  if (!token || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if ((await hmacSha256(secret, payload)) !== sig) return false;
  const ts = Number(payload);
  return ts && (Date.now() - ts <= SESSION_MAX_AGE_MS);
}
function bearerToken(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// ---- Adaptateur texte (format OpenAI-compatible) ----

async function callOpenAiCompatible(provider, env, { model, messages, max_tokens, temperature, system_prompt }) {
  const apiKey = provider.api_key_secret ? env[provider.api_key_secret] : null;
  if (!apiKey) throw new Error(`Clé API manquante pour ${provider.id} (secret: ${provider.api_key_secret})`);

  let finalMessages = messages;
  if (system_prompt && (!messages[0] || messages[0].role !== "system")) {
    finalMessages = [{ role: "system", content: system_prompt }, ...messages];
  }

  const started = Date.now();
  const res = await fetch(`${provider.base_url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://nyxia-sandbox.internal",
      "X-Title": "NyXia Sandbox Hub"
    },
    body: JSON.stringify({ model, messages: finalMessages, max_tokens: max_tokens || 2000, temperature: temperature ?? 0.7 })
  });
  const elapsedMs = Date.now() - started;
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Erreur ${provider.id}: ${res.status}`);
  return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage || null, elapsedMs };
}

// ---- Helpers KV ----

async function getProviders(env) {
  if (env.HUB_CONFIG) { const s = await env.HUB_CONFIG.get("providers", "json"); if (s) return s; }
  return DEFAULT_PROVIDERS;
}
async function saveProviders(env, providers) {
  await env.HUB_CONFIG.put("providers", JSON.stringify(providers));
}
async function getTools(env) {
  if (env.HUB_CONFIG) { const s = await env.HUB_CONFIG.get("tools", "json"); if (s) return s; }
  return DEFAULT_TOOLS;
}
async function saveTools(env, tools) {
  await env.HUB_CONFIG.put("tools", JSON.stringify(tools));
}
function slugify(name) {
  return name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "outil";
}
function uniqueId(base, existingIds) {
  let id = base, i = 2;
  while (existingIds.includes(id)) { id = `${base}-${i}`; i++; }
  return id;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // ex: ["api","tools","nyxia"]

    // --- Connexion (non protégé) ---
    if (request.method === "POST" && url.pathname === "/api/login") {
      const { password } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ success: false, error: "Serveur mal configuré (secrets manquants)." }, 500);
      if (password !== env.ADMIN_PASSWORD) return json({ success: false, error: "Mot de passe incorrect." }, 401);
      return json({ success: true, token: await signSession(env.SESSION_SECRET) });
    }
    if (request.method === "POST" && url.pathname === "/api/check-auth") {
      const { token } = await request.json().catch(() => ({}));
      return json({ valid: await verifySession(env.SESSION_SECRET, token) });
    }

    // --- Tout le reste sous /api/ est protégé ---
    if (parts[0] === "api") {
      const ok = await verifySession(env.SESSION_SECRET, bearerToken(request));
      if (!ok) return json({ error: "Non autorisé" }, 401);
    }

    // --- Outils : GET liste / POST créer / PUT modifier / DELETE supprimer ---
    if (parts[0] === "api" && parts[1] === "tools") {
      const tools = await getTools(env);
      const toolId = parts[2];

      if (request.method === "GET" && !toolId) return json({ tools });

      if (request.method === "POST" && !toolId) {
        const body = await request.json();
        if (!body.name) return json({ error: "Nom requis" }, 400);
        const id = uniqueId(slugify(body.name), tools.map(t => t.id));
        const tool = {
          id, name: body.name, icon: body.icon || "⚙️", category: body.category || "conversation",
          providerId: body.providerId, model: body.model,
          system_prompt: body.system_prompt || "", max_tokens: Number(body.max_tokens) || 2000,
          temperature: body.temperature !== undefined ? Number(body.temperature) : 0.7
        };
        tools.push(tool);
        await saveTools(env, tools);
        return json({ ok: true, tool });
      }

      if (request.method === "PUT" && toolId) {
        const idx = tools.findIndex(t => t.id === toolId);
        if (idx === -1) return json({ error: "Outil introuvable" }, 404);
        const body = await request.json();
        tools[idx] = { ...tools[idx], ...body, id: toolId };
        await saveTools(env, tools);
        return json({ ok: true, tool: tools[idx] });
      }

      if (request.method === "DELETE" && toolId) {
        const filtered = tools.filter(t => t.id !== toolId);
        await saveTools(env, filtered);
        return json({ ok: true });
      }
    }

    // --- Fournisseurs : même principe ---
    if (parts[0] === "api" && parts[1] === "providers") {
      const providers = await getProviders(env);
      const providerId = parts[2];

      if (request.method === "GET" && !providerId) {
        return json({ providers });
      }

      if (request.method === "POST" && !providerId) {
        const body = await request.json();
        if (!body.name || !body.base_url || !body.api_key_secret) return json({ error: "Nom, URL de base et nom du secret requis" }, 400);
        const id = uniqueId(slugify(body.name), providers.map(p => p.id));
        const provider = { id, name: body.name, base_url: body.base_url.replace(/\/$/, ""), api_key_secret: body.api_key_secret, format: "openai-compatible" };
        providers.push(provider);
        await saveProviders(env, providers);
        return json({ ok: true, provider });
      }

      if (request.method === "PUT" && providerId) {
        const idx = providers.findIndex(p => p.id === providerId);
        if (idx === -1) return json({ error: "Fournisseur introuvable" }, 404);
        const body = await request.json();
        providers[idx] = { ...providers[idx], ...body, id: providerId };
        await saveProviders(env, providers);
        return json({ ok: true, provider: providers[idx] });
      }

      if (request.method === "DELETE" && providerId) {
        await saveProviders(env, providers.filter(p => p.id !== providerId));
        return json({ ok: true });
      }
    }

    // --- Chat (utilise un outil existant, ou fournisseur+modèle bruts) ---
    if (request.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await request.json();
        const providers = await getProviders(env);
        let providerId = body.providerId, model = body.model, system_prompt = body.system_prompt || "";
        let max_tokens = body.max_tokens, temperature = body.temperature;

        if (body.toolId) {
          const tools = await getTools(env);
          const tool = tools.find(t => t.id === body.toolId);
          if (!tool) return json({ error: "Outil introuvable" }, 400);
          providerId = tool.providerId; model = tool.model; system_prompt = tool.system_prompt;
          max_tokens = body.max_tokens || tool.max_tokens; temperature = body.temperature ?? tool.temperature;
        }

        const provider = providers.find(p => p.id === providerId);
        if (!provider) return json({ error: `Fournisseur inconnu: ${providerId}` }, 400);
        const result = await callOpenAiCompatible(provider, env, { model, messages: body.messages, max_tokens, temperature, system_prompt });
        return json(result);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Catalogue brut d'un fournisseur ---
    if (request.method === "GET" && url.pathname === "/api/models") {
      const providerId = url.searchParams.get("provider") || "openrouter";
      const providers = await getProviders(env);
      const provider = providers.find(p => p.id === providerId);
      if (!provider) return json({ error: "Fournisseur inconnu" }, 400);
      const res = await fetch(`${provider.base_url}/models`);
      return json(await res.json());
    }

    // --- Recherche Pexels (banque d'images) ---
    if (request.method === "GET" && url.pathname === "/api/pexels-search") {
      if (!env.PEXELS_KEY) return json({ error: "Clé PEXELS_KEY manquante" }, 500);
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Paramètre q requis" }, 400);
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15`, {
        headers: { Authorization: env.PEXELS_KEY }
      });
      const data = await res.json();
      return json({ photos: (data.photos || []).map(p => ({ id: p.id, thumb: p.src.medium, full: p.src.large2x, photographer: p.photographer, url: p.url })) });
    }

    // --- Fichiers statiques ---
    return env.ASSETS.fetch(request);
  }
};
