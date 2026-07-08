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
  },
  {
    id: "alexya", name: "Alexya",
    base_url: "https://alexya.ai/api/v1",
    api_key_secret: "ALEXYA_KEY", format: "alexya-async"
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
  { id: "grok", name: "Grok 4.3", icon: "🤖", category: "conversation", providerId: "openrouter", model: "x-ai/grok-4.3", system_prompt: "", max_tokens: 2000, temperature: 0.7 },
  { id: "livre-claude", name: "Chapitre — Claude Opus 4.8", icon: "📖", category: "livre", providerId: "openrouter", model: "anthropic/claude-opus-4.8", system_prompt: "Tu écris un chapitre complet et cohérent en français, dans un style romanesque immersif. Vise environ 30 000 caractères sauf indication contraire.", max_tokens: 8000, temperature: 0.85 },
  { id: "livre-grok", name: "Chapitre — Grok 4.3", icon: "📖", category: "livre", providerId: "openrouter", model: "x-ai/grok-4.3", system_prompt: "Tu écris un chapitre complet et cohérent en français, dans un style romanesque immersif. Vise environ 30 000 caractères sauf indication contraire.", max_tokens: 8000, temperature: 0.85 },
  { id: "narration-1", name: "Continuité personnages", icon: "🎭", category: "narration", providerId: "openrouter", model: "anthropic/claude-sonnet-5", system_prompt: "Tu es gardien de la continuité narrative de l'univers des Terres de Brume. Garde la cohérence des personnages, de leurs voix, et de la chronologie.", max_tokens: 3000, temperature: 0.9 },
  { id: "img-gpt2", name: "GPT Image 2", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "openai/gpt-image-2" },
  { id: "img-gpt15", name: "GPT Image 1.5", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "openai/gpt-image-1-5" },
  { id: "img-grok", name: "Grok Imagine Image Pro", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "x-ai/grok-imagine-image-pro", aspect_ratio: "16:9" },
  { id: "img-imagen4u", name: "Imagen 4.0 Ultra", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "imagen-4.0-ultra-generate-preview-06-06", aspect_ratio: "1:1" },
  { id: "img-imagen4ug", name: "Imagen 4.0 Ultra Generate", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "google/imagen-4.0-ultra-generate-001", aspect_ratio: "1:1" },
  { id: "img-recraft", name: "Recraft V3", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "recraft-v3" },
  { id: "img-wan27", name: "Wan 2.7 Pro", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "alibaba/wan-2-7-image-pro" },
  { id: "img-gemini25", name: "Gemini 2.5 Flash Image", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "google/gemini-2.5-flash-image" },
  { id: "img-zturbo", name: "Z-Image Turbo", icon: "🎨", category: "image", kind: "image", providerId: "aimlapi", model: "alibaba/z-image-turbo" },
  { id: "img-alexya-fast", name: "Alexya Image (Fast)", icon: "🎨", category: "image", kind: "image-async", providerId: "alexya", model: "fast", aspect_ratio: "1:1" },
  { id: "img-alexya-hq", name: "Alexya Image (Haute qualité)", icon: "🎨", category: "image", kind: "image-async", providerId: "alexya", model: "high_quality", aspect_ratio: "1:1" }
];

const CATEGORY_LABELS = {
  conversation: { icon: "💬", name: "Conversation" },
  livre: { icon: "📖", name: "Écriture de livre" },
  narration: { icon: "🎭", name: "Narration & personnages" },
  image: { icon: "🎨", name: "Génération d'image" },
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

async function callImageGeneration(provider, env, { model, prompt, aspect_ratio, image_urls }) {
  const apiKey = provider.api_key_secret ? env[provider.api_key_secret] : null;
  if (!apiKey) throw new Error(`Clé API manquante pour ${provider.id} (secret: ${provider.api_key_secret})`);

  const started = Date.now();
  const payload = { model, prompt };
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (image_urls && image_urls.length) payload.image_urls = image_urls;

  const res = await fetch(`${provider.base_url}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const elapsedMs = Date.now() - started;
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && (data.error.message || JSON.stringify(data.error))) || `Erreur ${provider.id}: ${res.status}`);

  const images = (data.data || []).map(d => d.url || (d.b64_json ? "data:image/png;base64," + d.b64_json : null)).filter(Boolean);
  return { images, elapsedMs };
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
  if (env.HUB_CONFIG) {
    const stored = await env.HUB_CONFIG.get("tools", "json");
    if (stored) {
      const storedIds = new Set(stored.map(t => t.id));
      const missingDefaults = DEFAULT_TOOLS.filter(t => !storedIds.has(t.id));
      if (missingDefaults.length) {
        const merged = [...stored, ...missingDefaults];
        await saveTools(env, merged);
        return merged;
      }
      return stored;
    }
  }
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
          kind: body.kind || "chat",
          providerId: body.providerId, model: body.model,
          system_prompt: body.system_prompt || "", max_tokens: Number(body.max_tokens) || 2000,
          temperature: body.temperature !== undefined ? Number(body.temperature) : 0.7,
          aspect_ratio: body.aspect_ratio || undefined
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

    // --- Recherche Pexels (photos) ---
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

    // --- Recherche Pexels (vidéos) ---
    if (request.method === "GET" && url.pathname === "/api/pexels-video-search") {
      if (!env.PEXELS_KEY) return json({ error: "Clé PEXELS_KEY manquante" }, 500);
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Paramètre q requis" }, 400);
      const res = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=12`, {
        headers: { Authorization: env.PEXELS_KEY }
      });
      const data = await res.json();
      const videos = (data.videos || []).map(v => {
        const files = (v.video_files || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
        const sd = files.find(f => f.width && f.width <= 960) || files[0];
        const hd = files.slice().reverse()[0];
        return { id: v.id, thumb: v.image, preview: sd ? sd.link : null, full: hd ? hd.link : null, duration: v.duration, photographer: v.user ? v.user.name : "", url: v.url };
      });
      return json({ videos });
    }

    // --- Alexya : soumission d'une génération d'image (async) ---
    if (request.method === "POST" && url.pathname === "/api/alexya/generate") {
      try {
        const body = await request.json();
        const tools = await getTools(env);
        const tool = tools.find(t => t.id === body.toolId);
        if (!tool) return json({ error: "Outil introuvable" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === tool.providerId);
        if (!provider) return json({ error: `Fournisseur inconnu: ${tool.providerId}` }, 400);
        const apiKey = env[provider.api_key_secret];
        if (!apiKey) return json({ error: `Clé manquante (${provider.api_key_secret})` }, 500);

        const res = await fetch(`${provider.base_url}/image/generate`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: body.prompt, mode: tool.model, aspect_ratio: body.aspect_ratio || tool.aspect_ratio || "1:1" })
        });
        const data = await res.json();
        if (!res.ok) return json({ error: data.error?.message || data.message || `Erreur Alexya: ${res.status}` }, 500);
        return json({ id: data.id, status: data.status, poll_url: data.poll_url });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Alexya : statut d'une génération ---
    if (request.method === "GET" && url.pathname === "/api/alexya/status") {
      try {
        const genId = url.searchParams.get("id");
        if (!genId) return json({ error: "Paramètre id requis" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === "alexya");
        if (!provider) return json({ error: "Fournisseur Alexya introuvable" }, 400);
        const apiKey = env[provider.api_key_secret];
        if (!apiKey) return json({ error: `Clé manquante (${provider.api_key_secret})` }, 500);

        const res = await fetch(`${provider.base_url}/generations/${genId}`, { headers: { "Authorization": `Bearer ${apiKey}` } });
        const data = await res.json();
        return json({ status: data.status, output_url: data.output_url, thumbnail_url: data.thumbnail_url, error: data.error });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Génération d'image (outils de type "image") ---
    if (request.method === "POST" && url.pathname === "/api/generate-image") {
      try {
        const body = await request.json();
        const tools = await getTools(env);
        const tool = tools.find(t => t.id === body.toolId);
        if (!tool) return json({ error: "Outil introuvable" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === tool.providerId);
        if (!provider) return json({ error: `Fournisseur inconnu: ${tool.providerId}` }, 400);
        const result = await callImageGeneration(provider, env, { model: tool.model, prompt: body.prompt, aspect_ratio: body.aspect_ratio || tool.aspect_ratio, image_urls: body.image_urls });
        return json(result);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- HeyGen : créer un nouvel avatar (Photo Avatar) à partir d'une image ---
    if (request.method === "POST" && url.pathname === "/api/heygen/create-avatar") {
      if (!env.HEYGEN_API_KEY) return json({ error: "Clé HEYGEN_API_KEY manquante" }, 500);
      try {
        const body = await request.json();
        const name = body.name || "Avatar sans nom";
        const imageBase64 = body.image_base64 || ""; // data URL complète: data:image/jpeg;base64,...
        if (!imageBase64) return json({ error: "Image requise" }, 400);

        const matches = imageBase64.match(/^data:(.+?);base64,(.+)$/);
        if (!matches) return json({ error: "Format d'image invalide" }, 400);
        const mimeType = matches[1];
        const raw = atob(matches[2]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const blob = new Blob([bytes], { type: mimeType });

        // Étape 1 : upload de l'asset
        const form = new FormData();
        form.append("file", blob, "avatar-photo." + (mimeType.split("/")[1] || "jpg"));
        const uploadRes = await fetch("https://api.heygen.com/v3/assets", {
          method: "POST",
          headers: { "X-Api-Key": env.HEYGEN_API_KEY },
          body: form
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok || !uploadData.data || !uploadData.data.url) {
          return json({ error: (uploadData.error && uploadData.error.message) || "Échec de l'upload de la photo" }, 500);
        }

        // Étape 2 : création de l'avatar à partir de l'asset uploadé
        const avatarRes = await fetch("https://api.heygen.com/v3/avatars", {
          method: "POST",
          headers: { "X-Api-Key": env.HEYGEN_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ type: "photo", name, file: { type: "url", url: uploadData.data.url } })
        });
        const avatarData = await avatarRes.json();
        if (!avatarRes.ok || !avatarData.data) {
          return json({ error: (avatarData.error && avatarData.error.message) || "Échec de la création de l'avatar" }, 500);
        }

        return json({ ok: true, avatar: avatarData.data.avatar_item, group: avatarData.data.avatar_group });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- HeyGen : liste de TES avatars uniquement (pas la bibliothèque publique) ---
    if (request.method === "GET" && url.pathname === "/api/heygen/avatars") {
      if (!env.HEYGEN_API_KEY) return json({ error: "Clé HEYGEN_API_KEY manquante" }, 500);
      try {
        const groupsRes = await fetch("https://api.heygen.com/v2/avatar_group.list", { headers: { "X-Api-Key": env.HEYGEN_API_KEY } });
        const groupsData = await groupsRes.json();
        const groups = (groupsData.data && groupsData.data.avatar_group_list) || groupsData.avatar_group_list || [];

        const avatars = [];
        for (const g of groups) {
          try {
            const looksRes = await fetch(`https://api.heygen.com/v2/avatar_group/${g.id}/avatars`, { headers: { "X-Api-Key": env.HEYGEN_API_KEY } });
            const looksData = await looksRes.json();
            const looks = (looksData.data && (looksData.data.avatar_list || looksData.data.avatars)) || looksData.avatars || [];
            if (looks.length) {
              looks.forEach(l => avatars.push({
                id: l.avatar_id || l.id,
                name: (g.name || "Avatar") + (looks.length > 1 ? " — " + (l.name || l.avatar_id || l.id) : ""),
                preview: l.image_url || l.preview_image_url || g.preview_image_url
              }));
            } else {
              // Fallback : au moins montrer le groupe si le détail des looks échoue
              avatars.push({ id: g.id, name: g.name || "Avatar", preview: g.preview_image || g.preview_image_url });
            }
          } catch (e) {
            avatars.push({ id: g.id, name: g.name || "Avatar", preview: g.preview_image || g.preview_image_url });
          }
        }
        return json({ avatars, raw_groups_count: groups.length, debug_raw: avatars.length === 0 ? groupsData : undefined });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }


    // --- HeyGen : liste de TES voix clonées uniquement (type=private) ---
    if (request.method === "GET" && url.pathname === "/api/heygen/voices") {
      if (!env.HEYGEN_API_KEY) return json({ error: "Clé HEYGEN_API_KEY manquante" }, 500);
      const res = await fetch("https://api.heygen.com/v3/voices?type=private", { headers: { "X-Api-Key": env.HEYGEN_API_KEY } });
      const data = await res.json();
      const voices = (data.data || []).map(v => ({ id: v.voice_id, name: v.name, language: v.language, gender: v.gender })).slice(0, 300);
      return json({ voices });
    }

    // --- HeyGen : générer une vidéo avatar ---
    if (request.method === "POST" && url.pathname === "/api/heygen/generate") {
      if (!env.HEYGEN_API_KEY) return json({ error: "Clé HEYGEN_API_KEY manquante" }, 500);
      try {
        const body = await request.json();
        const payload = {
          video_inputs: [{
            character: { type: "avatar", avatar_id: body.avatar_id, avatar_style: "normal" },
            voice: { type: "text", input_text: body.script, voice_id: body.voice_id }
          }],
          dimension: { width: 1280, height: 720 }
        };
        const res = await fetch("https://api.heygen.com/v2/video/generate", {
          method: "POST",
          headers: { "X-Api-Key": env.HEYGEN_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || data.error) return json({ error: (data.error && data.error.message) || `Erreur HeyGen: ${res.status}` }, 500);
        return json({ video_id: data.data.video_id });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- HeyGen : statut d'une vidéo ---
    if (request.method === "GET" && url.pathname === "/api/heygen/status") {
      if (!env.HEYGEN_API_KEY) return json({ error: "Clé HEYGEN_API_KEY manquante" }, 500);
      const videoId = url.searchParams.get("video_id");
      if (!videoId) return json({ error: "Paramètre video_id requis" }, 400);
      const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
        headers: { "X-Api-Key": env.HEYGEN_API_KEY }
      });
      const data = await res.json();
      const d = data.data || {};
      return json({ status: d.status, video_url: d.video_url, error: d.error });
    }

    // --- Wan (DashScope) : génération d'images ---
    if (request.method === "POST" && url.pathname === "/api/wan-image") {
      const DASHSCOPE_KEY = env.DASHSCOPE_API_KEY || "";
      if (!DASHSCOPE_KEY) return json({ success: false, error: "Clé DASHSCOPE_API_KEY non configurée." }, 500);
      try {
        const body = await request.json();
        const prompt = body.prompt || "";
        const model = body.model || "wan2.7-image";
        const sizeSpec = body.size || "2K";
        const format = body.format || "";
        const n = Math.min(body.n || 1, 4);
        if (!prompt) return json({ success: false, error: "Prompt requis." }, 400);

        const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1";
        const endpoint = `${DASHSCOPE_BASE}/services/aigc/multimodal-generation/generation`;

        let finalSize = sizeSpec;
        if (format) {
          const IMG_SIZE_MAP = {
            "1K": { "1:1": "1024*1024", "4:5": "896*1120", "9:16": "768*1344", "16:9": "1344*768" },
            "2K": { "1:1": "2048*2048", "4:5": "1792*2240", "9:16": "1536*2688", "16:9": "2688*1536" },
            "4K": { "1:1": "4096*4096", "4:5": "3584*4480", "9:16": "3072*5376", "16:9": "5376*3072" }
          };
          const group = IMG_SIZE_MAP[sizeSpec] || IMG_SIZE_MAP["2K"];
          finalSize = group[format] || sizeSpec;
        }

        const payload = {
          model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] },
          parameters: { size: finalSize, n, watermark: false }
        };
        if (model === "wan2.7-image-pro") payload.parameters.thinking_mode = true;

        const imgRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${DASHSCOPE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const imgData = await imgRes.json();
        if (!imgRes.ok) return json({ success: false, error: imgData.message || "Erreur lors de la génération d'image" }, 500);

        const choices = imgData.output?.choices || [];
        const images = [];
        for (const choice of choices) for (const item of (choice.message?.content || [])) if (item.image) images.push(item.image);
        if (!images.length) return json({ success: false, error: imgData.output?.choices?.[0]?.message?.content?.[0]?.text || "Aucune image générée — essaie un autre prompt" }, 500);

        return json({ success: true, images });
      } catch (e) {
        return json({ success: false, error: "Erreur serveur : " + e.message }, 500);
      }
    }

    // --- Wan (DashScope) : génération vidéo (T2V / I2V) — soumission async ---
    if (request.method === "POST" && url.pathname === "/api/wan-video") {
      const DASHSCOPE_KEY = env.DASHSCOPE_API_KEY || "";
      if (!DASHSCOPE_KEY) return json({ success: false, error: "Clé DASHSCOPE_API_KEY non configurée." }, 500);
      try {
        const body = await request.json();
        const prompt = body.prompt || "";
        const model = body.model || "wan2.6-t2v";
        const resolution = body.resolution || "720p";
        const duration = body.duration || 5;
        const mode = body.mode || "t2v";
        const imageB64 = body.image_base64 || "";
        if (!prompt) return json({ success: false, error: "Prompt requis." }, 400);
        if (mode === "i2v" && !imageB64) return json({ success: false, error: "Image requise pour le mode Image → Vidéo." }, 400);

        const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1";
        const format = body.format || "16:9";
        const SIZE_MAP = {
          "480p": { "16:9": "832*480", "9:16": "480*832", "1:1": "624*624" },
          "720p": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960" },
          "1080p": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440" }
        };
        const sizeGroup = SIZE_MAP[resolution] || SIZE_MAP["720p"];
        const size = sizeGroup[format] || sizeGroup["16:9"];

        let endpoint = `${DASHSCOPE_BASE}/services/aigc/video-generation/video-synthesis`;
        let payload;
        if (mode === "i2v") {
          let imgUrlValue = imageB64;
          if (imageB64 && !imageB64.startsWith("data:") && !imageB64.startsWith("http")) imgUrlValue = "data:image/jpeg;base64," + imageB64;
          payload = {
            model: model || "wan2.6-i2v-flash",
            input: { prompt, img_url: imgUrlValue },
            parameters: { resolution: resolution.toUpperCase(), prompt_extend: true, watermark: false, duration: parseInt(duration) }
          };
        } else {
          payload = {
            model: model || "wan2.6-t2v",
            input: { prompt },
            parameters: { size, prompt_extend: true, watermark: false, duration: parseInt(duration) }
          };
        }

        const wanRes = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${DASHSCOPE_KEY}`, "Content-Type": "application/json", "X-DashScope-Async": "enable" },
          body: JSON.stringify(payload)
        });
        const wanData = await wanRes.json();
        if (!wanRes.ok || !wanData.output || !wanData.output.task_id) {
          return json({ success: false, error: wanData.message || wanData.output?.message || "Erreur lors de la génération vidéo" }, 500);
        }
        return json({ success: true, taskId: wanData.output.task_id, status: wanData.output.task_status });
      } catch (e) {
        return json({ success: false, error: "Erreur serveur : " + e.message }, 500);
      }
    }

    // --- Wan (DashScope) : statut d'une tâche vidéo ---
    if (request.method === "POST" && url.pathname === "/api/wan-video/status") {
      const DASHSCOPE_KEY = env.DASHSCOPE_API_KEY || "";
      if (!DASHSCOPE_KEY) return json({ success: false, error: "Clé DASHSCOPE_API_KEY non configurée." }, 500);
      try {
        const body = await request.json();
        const taskId = body.taskId || "";
        if (!taskId) return json({ success: false, error: "taskId requis." }, 400);

        const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1";
        const pollRes = await fetch(`${DASHSCOPE_BASE}/tasks/${taskId}`, { headers: { "Authorization": `Bearer ${DASHSCOPE_KEY}` } });
        const pollData = await pollRes.json();
        if (!pollRes.ok || !pollData.output) return json({ success: false, error: pollData.message || "Erreur lors du polling" }, 500);

        const status = pollData.output.task_status;
        let videoUrl = null, errorMsg = null;
        if (status === "SUCCEEDED") {
          videoUrl = pollData.output.video_url || (pollData.output.results && pollData.output.results[0] && pollData.output.results[0].url) || null;
        }
        if (status === "FAILED") {
          errorMsg = pollData.output.message || pollData.output.task_metrics?.error || "Génération échouée";
        }
        return json({ success: true, status, videoUrl, errorMsg, taskId });
      } catch (e) {
        return json({ success: false, error: "Erreur serveur : " + e.message }, 500);
      }
    }

    // --- Fichiers statiques ---
    return env.ASSETS.fetch(request);
  }
};
