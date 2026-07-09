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
    id: "aimlapi-music", name: "AIMLAPI (Musique)",
    base_url: "https://api.aimlapi.com/v1",
    api_key_secret: "NyXia_Musique", format: "openai-compatible"
  },
  {
    id: "alexya", name: "Alexya",
    base_url: "https://alexya.ai/api/v1",
    api_key_secret: "Alexya_KEY", format: "alexya-async"
  },
  {
    id: "openai", name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    api_key_secret: "OpenAi_KEY", format: "openai-compatible"
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
  { id: "img-alexya-hq", name: "Alexya Image (Haute qualité)", icon: "🎨", category: "image", kind: "image-async", providerId: "alexya", model: "high_quality", aspect_ratio: "1:1" },
  { id: "music-freesound", name: "Freesound (Sons)", icon: "🔎", category: "banque-gratuite", kind: "audio-search" },
  { id: "bank-pexels", name: "Pexels (Photos & Vidéos)", icon: "🖼️", category: "banque-gratuite", kind: "pexels" },
  { id: "bank-unsplash", name: "Unsplash (Photos)", icon: "📷", category: "banque-gratuite", kind: "unsplash" },
  { id: "music-stable-audio", name: "Stable Audio", icon: "🎼", category: "musique", kind: "audio", providerId: "aimlapi-music", model: "stable-audio" },
  { id: "music-eleven", name: "Eleven Music", icon: "🎼", category: "musique", kind: "audio", providerId: "aimlapi-music", model: "elevenlabs/eleven_music" },
  { id: "music-lyria2", name: "Lyria 2", icon: "🎼", category: "musique", kind: "audio", providerId: "aimlapi-music", model: "google/lyria2" },
  { id: "music-minimax", name: "MiniMax Music 2.6", icon: "🎤", category: "musique", kind: "audio", needs_lyrics: true, providerId: "aimlapi-music", model: "minimax/music-2.6" },
  { id: "video-luma-ray2", name: "Luma Ray 2", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "luma/ray-2" },
  { id: "video-gen4-turbo", name: "Runway Gen4 Turbo", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "runway/gen4_turbo" },
  { id: "video-gen3a-turbo", name: "Runway Gen3a Turbo", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "runway/gen3a_turbo" },
  { id: "video-ltxv2", name: "LTXV 2", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "ltxv/ltxv-2" },
  { id: "video-pixverse", name: "PixVerse V5", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "pixverse/v5/text-to-video" },
  { id: "video-veo31-t2v", name: "Veo 3.1 (Texte → Vidéo)", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "google/veo-3.1-t2v" },
  { id: "video-veo31-i2v", name: "Veo 3.1 (Image → Vidéo)", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "google/veo-3.1-i2v" },
  { id: "video-kling", name: "Kling 2.6 Pro (à confirmer)", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "kling-video/v2.6-pro/text-to-video" },
  { id: "video-minimax", name: "MiniMax Hailuo 2.3 Fast (à confirmer)", icon: "🎬", category: "video", kind: "video", providerId: "aimlapi", model: "minimax/hailuo-2.3-fast" },
  { id: "eso-horoscope", name: "Horoscope du jour", icon: "🔮", category: "esoterisme", kind: "esoteric", source: "horoscope" },
  { id: "eso-moonphase", name: "Phase de lune", icon: "🌙", category: "esoterisme", kind: "esoteric", source: "moonphase" },
  { id: "eso-zenquotes", name: "Citation inspirante", icon: "💬", category: "esoterisme", kind: "esoteric", source: "zenquotes" },
  { id: "eso-sunrise", name: "Lever / Coucher du soleil", icon: "☀️", category: "esoterisme", kind: "esoteric", source: "sunrise" },
  { id: "eso-tarot", name: "Tarot (à confirmer)", icon: "🃏", category: "esoterisme", kind: "esoteric", source: "tarot" },
  { id: "eso-astrology-yearly", name: "Horoscope annuel détaillé", icon: "🔮", category: "esoterisme", kind: "rapidapi", source: "astrology-yearly" },
  { id: "stt-whisper", name: "Whisper Large v3", icon: "🎙️", category: "transcription", kind: "transcribe", providerId: "aimlapi", model: "#g1_whisper-large" },
  { id: "stt-gpt4o", name: "GPT-4o Transcribe", icon: "🎙️", category: "transcription", kind: "transcribe", providerId: "openai", model: "gpt-4o-transcribe" },
  { id: "stt-gpt4o-mini", name: "GPT-4o Mini Transcribe (économique)", icon: "🎙️", category: "transcription", kind: "transcribe", providerId: "openai", model: "gpt-4o-mini-transcribe" },
  { id: "apy-translate-webpage", name: "Traduire une page web", icon: "🌐", category: "utilites", kind: "apyhub", source: "translate-webpage" },
  { id: "apy-analyze-webpage", name: "Analyser une page web", icon: "🌐", category: "utilites", kind: "apyhub", source: "analyze-webpage" },
  { id: "apy-audio-convert", name: "Convertir WAV → MP3", icon: "🔊", category: "utilites", kind: "apyhub", source: "audio-wav-to-mp3" },
  { id: "apy-extract-contact", name: "Extraire des contacts", icon: "📇", category: "utilites", kind: "apyhub", source: "extract-contact" },
  { id: "apy-thumbnail", name: "Créer une miniature", icon: "🖼️", category: "utilites", kind: "apyhub", source: "image-thumbnail" },
  { id: "apy-webpage-audit", name: "Audit technique de site", icon: "🔍", category: "utilites", kind: "apyhub", source: "webpage-audit" },
  { id: "apy-market-trends", name: "Tendances de marché", icon: "📈", category: "utilites", kind: "apyhub", source: "market-trends" },
  { id: "apy-product-intro", name: "Description produit", icon: "🛍️", category: "utilites", kind: "apyhub", source: "product-intro" },
  { id: "apy-qrcode", name: "Générer un QR code", icon: "📱", category: "utilites", kind: "apyhub", source: "qr-code" },
  { id: "apy-watermark", name: "Filigrane sur image", icon: "💧", category: "utilites", kind: "apyhub", source: "image-watermark" },
  { id: "apy-compress", name: "Compresser une image", icon: "🗜️", category: "utilites", kind: "apyhub", source: "image-compress" },
  { id: "apy-crop", name: "Recadrer une image", icon: "✂️", category: "utilites", kind: "apyhub", source: "image-crop" },
  { id: "apy-resize", name: "Redimensionner une image", icon: "📐", category: "utilites", kind: "apyhub", source: "image-resize" },
  { id: "apy-translate-text", name: "Traduire un texte", icon: "📝", category: "utilites", kind: "apyhub", source: "translate-text" },
  { id: "apy-pdf-watermark", name: "Filigrane sur PDF", icon: "📄", category: "utilites", kind: "apyhub", source: "pdf-watermark" },
  { id: "apy-pdf-watermark-footer", name: "PDF — en-tête/pied de page", icon: "📄", category: "utilites", kind: "apyhub", source: "pdf-watermark-footer" },
  { id: "apy-summarize", name: "Résumer un texte", icon: "📋", category: "utilites", kind: "apyhub", source: "summarize-text" },
  { id: "apy-paraphrase", name: "Paraphraser un texte", icon: "🔄", category: "utilites", kind: "apyhub", source: "paraphrase-text" },
  { id: "dl-yt-audio", name: "YouTube — Langues/Audio", icon: "📺", category: "downloader", kind: "rapidapi", source: "yt-download" },
  { id: "dl-tiktok-user", name: "TikTok — Vidéos d'un profil", icon: "🎵", category: "downloader", kind: "rapidapi", source: "tiktok-user" },
  { id: "dl-instagram-reels", name: "Instagram — Télécharger Reel", icon: "📷", category: "downloader", kind: "rapidapi", source: "instagram-reels" },
  { id: "dl-tiktok-nowm", name: "TikTok — Sans filigrane", icon: "🎵", category: "downloader", kind: "rapidapi", source: "tiktok-nowm" },
  { id: "dl-yt-fast-audio", name: "YouTube — Audio rapide", icon: "📺", category: "downloader", kind: "rapidapi", source: "yt-fast-audio" },
  { id: "dl-yt-transcript", name: "YouTube — Transcription", icon: "📺", category: "downloader", kind: "rapidapi", source: "yt-transcript" },
  { id: "dl-all-media", name: "Télécharger média (universel)", icon: "⬇️", category: "downloader", kind: "rapidapi", source: "all-media" },
  { id: "dl-spotify", name: "Spotify — Télécharger MP3", icon: "🎧", category: "downloader", kind: "rapidapi", source: "spotify-download" },
  { id: "dl-all-video", name: "Télécharger vidéo (universel)", icon: "⬇️", category: "downloader", kind: "rapidapi", source: "all-video" },
  { id: "dl-tiktok-comments", name: "TikTok — Réponses aux commentaires", icon: "💬", category: "downloader", kind: "rapidapi", source: "tiktok-comments" },
  { id: "dl-bg-removal", name: "Supprimer l'arrière-plan", icon: "🖼️", category: "downloader", kind: "rapidapi", source: "bg-removal" },
  { id: "dl-media2text", name: "Média → Texte", icon: "📝", category: "downloader", kind: "rapidapi", source: "media2text" }
];

const CATEGORY_LABELS = {
  conversation: { icon: "💬", name: "Conversation" },
  livre: { icon: "📖", name: "Écriture de livre" },
  narration: { icon: "🎭", name: "Narration & personnages" },
  image: { icon: "🎨", name: "Génération d'image" },
  "musique-libre": { icon: "🆓", name: "Musique libre de droit" },
  "musique-ambiance": { icon: "🎼", name: "Ambiances instrumentales" },
  "musique-chanson": { icon: "🎤", name: "Chansons complètes" },
  musique: { icon: "🎵", name: "Musique" },
  "banque-gratuite": { icon: "🆓", name: "Banque gratuite" },
  video: { icon: "🎬", name: "Génération vidéo" },
  esoterisme: { icon: "🔮", name: "Ésotérisme" },
  transcription: { icon: "🎙️", name: "Transcription" },
  utilites: { icon: "🧩", name: "Utilités" },
  downloader: { icon: "⬇️", name: "Downloader" },
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
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.error?.message || `Erreur ${provider.id}: ${res.status}`);
  return { text: data.choices?.[0]?.message?.content ?? "", usage: data.usage || null, elapsedMs };
}

async function callImageGeneration(provider, env, { model, prompt, aspect_ratio, image_urls }) {
  const apiKey = provider.api_key_secret ? env[provider.api_key_secret] : null;
  if (!apiKey) throw new Error(`Clé API manquante pour ${provider.id} (secret: ${provider.api_key_secret})`);

  const started = Date.now();

  // Les modèles GPT Image ignorent l'image en JSON — ils exigent l'endpoint /images/edits en multipart
  if (image_urls && image_urls.length && model.startsWith("openai/gpt-image")) {
    const dataUrl = image_urls[0];
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) throw new Error("Format d'image de référence invalide pour l'édition GPT Image");
    const mimeType = match[1];
    const raw = atob(match[2]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType });

    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("image", blob, "reference." + (mimeType.split("/")[1] || "png"));

    const res = await fetch(`${provider.base_url}/images/edits`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: form
    });
    const elapsedMs = Date.now() - started;
    const data = await safeJson(res);
    if (!res.ok) throw new Error((data.error && (data.error.message || JSON.stringify(data.error))) || `Erreur ${provider.id}: ${res.status}`);
    const images = (data.data || []).map(d => d.url || (d.b64_json ? "data:image/png;base64," + d.b64_json : null)).filter(Boolean);
    return { images, elapsedMs };
  }

  const payload = { model, prompt };
  if (aspect_ratio) payload.aspect_ratio = aspect_ratio;
  if (image_urls && image_urls.length) {
    // Certains modèles (ex. Wan 2.7 Pro) attendent du base64 brut, sans le préfixe "data:...;base64,"
    payload.image_urls = image_urls.map(u => u.startsWith("data:") ? u.split(",")[1] : u);
  }

  const res = await fetch(`${provider.base_url}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const elapsedMs = Date.now() - started;
  const data = await safeJson(res);
  if (!res.ok) throw new Error((data.error && (data.error.message || JSON.stringify(data.error))) || `Erreur ${provider.id}: ${res.status}`);

  const images = (data.data || []).map(d => d.url || (d.b64_json ? "data:image/png;base64," + d.b64_json : null)).filter(Boolean);
  return { images, elapsedMs };
}

const APYHUB_TOOLS = {
  "translate-webpage": { method: "POST", path: "/namastesumalya/api/translate", type: "json" },
  "analyze-webpage": { method: "GET", path: "/namastesumalya/api/analyze", type: "query" },
  "audio-wav-to-mp3": { method: "POST", path: "/convert/audio/wav-file/mp3-file", type: "multipart", query: { output: "sample.mp3" }, fileFields: ["file"] },
  "extract-contact": { method: "POST", path: "/chisleroff/extract/contact", type: "json" },
  "image-thumbnail": { method: "POST", path: "/generate/image/thumbnail/file", type: "multipart", query: { output: "thumbnail", auto_orientation: "false", preserve_format: "true" }, fileFields: ["image"], queryFromFields: ["width", "height"] },
  "webpage-audit": { method: "POST", path: "/namastesumalya/api/audit", type: "json" },
  "market-trends": { method: "POST", path: "/namastesumalya/api/market-trends", type: "json" },
  "product-intro": { method: "POST", path: "/sharpapi/api/v1/ecommerce/product_intro", type: "json" },
  "qr-code": { method: "POST", path: "/generate/qr-code/file", type: "json", query: { output: "sample.png" } },
  "image-watermark": { method: "POST", path: "/processor/image/watermark/file", type: "multipart", query: { output: "test-sample", preserve_format: "true" }, fileFields: ["image", "watermark_image"] },
  "image-compress": { method: "POST", path: "/processor/image/compress/file", type: "multipart", query: { output: "test-sample", preserve_format: "true" }, fileFields: ["image"], queryFromFields: ["compression_percentage"] },
  "image-crop": { method: "POST", path: "/processor/image/crop/file", type: "multipart", query: { output: "test-sample", preserve_format: "true" }, fileFields: ["image"], formFields: ["top"] },
  "image-resize": { method: "POST", path: "/processor/image/resize/file", type: "multipart", query: { output: "test-sample", auto_orientation: "false", preserve_format: "true" }, fileFields: ["image"], queryFromFields: ["width", "height"] },
  "translate-text": { method: "POST", path: "/sharpapi/api/v1/content/translate", type: "json" },
  "pdf-watermark": { method: "POST", path: "/stamp/pdf/watermark/file", type: "multipart", query: { output: "test-sample" }, fileFields: ["file"], formFields: ["watermark_text"] },
  "pdf-watermark-footer": { method: "POST", path: "/stamp/pdf/watermark-footers/file", type: "multipart", query: { output: "test-sample" }, fileFields: ["file", "watermark_image"], formFields: ["header_text", "footer_text"] },
  "summarize-text": { method: "POST", path: "/sharpapi/api/v1/content/summarize", type: "json" },
  "paraphrase-text": { method: "POST", path: "/sharpapi/api/v1/content/paraphrase", type: "json" }
};

async function safeJson(res) {
  const raw = await res.text();
  try { return JSON.parse(raw); }
  catch (e) { return { error: `Réponse invalide du serveur (${res.status}) : ${raw.slice(0, 200)}` }; }
}

async function callApyHub(env, source, fields, files) {
  const config = APYHUB_TOOLS[source];
  if (!config) throw new Error(`Outil ApyHub inconnu: ${source}`);
  if (!env.ApyHub_KEY) throw new Error("Clé ApyHub_KEY manquante");

  const base = "https://api.apyhub.com";
  let queryParams = new URLSearchParams(config.query || {});
  if (config.queryFromFields) config.queryFromFields.forEach(f => { if (fields[f]) queryParams.set(f, fields[f]); });

  if (config.type === "query") {
    Object.keys(fields || {}).forEach(k => { if (fields[k]) queryParams.set(k, fields[k]); });
    const res = await fetch(`${base}${config.path}?${queryParams.toString()}`, {
      headers: { "apy-token": env.ApyHub_KEY, "Content-Type": "application/json" }
    });
    return await safeJson(res);
  }

  if (config.type === "json") {
    const qs = queryParams.toString();
    const res = await fetch(`${base}${config.path}${qs ? "?" + qs : ""}`, {
      method: "POST",
      headers: { "apy-token": env.ApyHub_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(fields || {})
    });
    return await safeJson(res);
  }

  // multipart
  const form = new FormData();
  for (const fieldName of (config.fileFields || [])) {
    const dataUrl = files && files[fieldName];
    if (!dataUrl) continue;
    const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!match) continue;
    const mimeType = match[1];
    const raw = atob(match[2]);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    form.append(fieldName, new Blob([bytes], { type: mimeType }), fieldName + "." + (mimeType.split("/")[1] || "bin"));
  }
  for (const fieldName of (config.formFields || [])) {
    if (fields && fields[fieldName]) form.append(fieldName, fields[fieldName]);
  }
  const qs = queryParams.toString();
  const res = await fetch(`${base}${config.path}${qs ? "?" + qs : ""}`, {
    method: "POST",
    headers: { "apy-token": env.ApyHub_KEY },
    body: form
  });
  return await safeJson(res);
}

const RAPIDAPI_TOOLS = {
  "yt-download": { host: "youtube-mp3-audio-video-downloader.p.rapidapi.com", method: "GET", pathTemplate: "/language_list/{videoId}", query: { response_mode: "default" } },
  "tiktok-user": { host: "tiktok-video-downloader-api.p.rapidapi.com", method: "GET", pathTemplate: "/user/{username}" },
  "instagram-reels": { host: "instagram-reels-downloader-api.p.rapidapi.com", method: "GET", pathTemplate: "/download", queryFromFields: ["url"] },
  "tiktok-nowm": { host: "tiktok-download-video-no-watermark.p.rapidapi.com", method: "GET", pathTemplate: "/tiktok/info", queryFromFields: ["url"] },
  "yt-fast-audio": { host: "youtube-video-fast-downloader-24-7.p.rapidapi.com", method: "GET", pathTemplate: "/download_audio/{videoId}", query: { quality: "251" } },
  "yt-transcript": { host: "youtube-transcripts.p.rapidapi.com", method: "GET", pathTemplate: "/youtube/transcript", queryFromFields: ["url", "videoId"], query: { chunkSize: "500", text: "false", lang: "en" } },
  "all-media": { host: "all-media-downloader1.p.rapidapi.com", method: "POST", pathTemplate: "/all", bodyType: "form", bodyFields: ["url", "cookies", "cookies_file"] },
  "spotify-download": { host: "spotify-music-mp3-downloader-api.p.rapidapi.com", method: "GET", pathTemplate: "/download", queryFromFields: ["link"] },
  "all-video": { host: "all-video-downloader1.p.rapidapi.com", method: "POST", pathTemplate: "/all", bodyType: "form", bodyFields: ["url", "cookies", "cookies_file"] },
  "tiktok-comments": { host: "tiktok-download5.p.rapidapi.com", method: "GET", pathTemplate: "/commentReply", queryFromFields: ["comment_id", "count", "cursor", "video_id"] },
  "bg-removal": { host: "background-removal.p.rapidapi.com", method: "POST", pathTemplate: "/remove", bodyType: "form", bodyFields: ["image_url", "image_base64", "output_format", "to_remove", "color_removal"] },
  "media2text": { host: "media2text.p.rapidapi.com", method: "POST", pathTemplate: "/", bodyType: "json", bodyFields: ["file_url", "openai_key"] },
  "astrology-yearly": { host: "best-daily-astrology-and-horoscope-api.p.rapidapi.com", method: "GET", pathTemplate: "/api/Detailed-Horoscope/yearly/", queryFromFields: ["zodiacSign"] }
};

async function callRapidApi(env, source, fields) {
  const config = RAPIDAPI_TOOLS[source];
  if (!config) throw new Error(`Outil inconnu: ${source}`);
  const apiKey = env["X-RapidAPI-Key"];
  if (!apiKey) throw new Error("Clé X-RapidAPI-Key manquante");

  let path = config.pathTemplate.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(fields[name] || ""));
  const queryParams = new URLSearchParams(config.query || {});
  (config.queryFromFields || []).forEach(f => { if (fields[f]) queryParams.set(f, fields[f]); });
  const qs = queryParams.toString();
  const fullUrl = `https://${config.host}${path}${qs ? "?" + qs : ""}`;

  const headers = { "x-rapidapi-host": config.host, "x-rapidapi-key": apiKey };
  let body;
  if (config.bodyType === "form") {
    const form = new URLSearchParams();
    (config.bodyFields || []).forEach(f => form.set(f, fields[f] || ""));
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = form.toString();
  } else if (config.bodyType === "json") {
    const obj = {};
    (config.bodyFields || []).forEach(f => { if (fields[f]) obj[f] = fields[f]; });
    if (source === "media2text" && env.OpenAi_KEY) obj.openai_key = env.OpenAi_KEY;
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(obj);
  } else {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(fullUrl, { method: config.method, headers, body: config.method === "GET" ? undefined : body });
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { error: `Réponse invalide du serveur (${res.status}) : ${raw.slice(0, 200)}` };
  }
}

async function getCustomTools(env) {
  if (env.HUB_CONFIG) { const s = await env.HUB_CONFIG.get("customTools", "json"); if (s) return s; }
  return [];
}
async function saveCustomTools(env, list) {
  await env.HUB_CONFIG.put("customTools", JSON.stringify(list));
}

async function callCustomTool(env, toolConfig, fields) {
  let path = toolConfig.pathTemplate.replace(/\{(\w+)\}/g, (_, name) => encodeURIComponent(fields[name] || ""));
  const queryParams = new URLSearchParams(toolConfig.query || {});
  (toolConfig.fields || []).filter(f => f.location === "query").forEach(f => { if (fields[f.name]) queryParams.set(f.name, fields[f.name]); });
  const qs = queryParams.toString();
  const fullUrl = `https://${toolConfig.host}${path}${qs ? "?" + qs : ""}`;

  const apiKey = toolConfig.authSecretName ? env[toolConfig.authSecretName] : null;
  if (toolConfig.authSecretName && !apiKey) throw new Error(`Clé manquante (${toolConfig.authSecretName})`);
  const headers = {};
  if (toolConfig.authHeaderName) headers[toolConfig.authHeaderName] = (toolConfig.authHeaderPrefix || "") + apiKey;

  let body;
  if (toolConfig.bodyType === "json") {
    const obj = {};
    (toolConfig.fields || []).filter(f => f.location === "body").forEach(f => { if (fields[f.name]) obj[f.name] = fields[f.name]; });
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(obj);
  } else if (toolConfig.bodyType === "form") {
    const form = new URLSearchParams();
    (toolConfig.fields || []).filter(f => f.location === "body").forEach(f => form.set(f.name, fields[f.name] || ""));
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = form.toString();
  }

  const res = await fetch(fullUrl, { method: toolConfig.method, headers, body: toolConfig.method === "GET" ? undefined : body });
  return await safeJson(res);
}

// ---- Helpers KV ----

async function getProviders(env) {
  if (env.HUB_CONFIG) { const s = await env.HUB_CONFIG.get("providers", "json"); if (s) return s; }
  return DEFAULT_PROVIDERS;
}
async function saveProviders(env, providers) {
  await env.HUB_CONFIG.put("providers", JSON.stringify(providers));
}
const CATEGORY_MIGRATIONS = {
  "musique-libre": "musique",
  "musique-ambiance": "musique",
  "musique-chanson": "musique"
};

async function getTools(env) {
  if (env.HUB_CONFIG) {
    const stored = await env.HUB_CONFIG.get("tools", "json");
    if (stored) {
      let changed = false;
      stored.forEach(t => {
        if (CATEGORY_MIGRATIONS[t.category]) { t.category = CATEGORY_MIGRATIONS[t.category]; changed = true; }
        if (!t.kind && (!t.system_prompt || !t.system_prompt.trim())) {
          t.system_prompt = "Tu utilises toujours le tutoiement (« tu »), jamais le vouvoiement (« vous »), sauf si on te demande explicitement le contraire.";
          changed = true;
        }
      });
      const deletedIds = new Set((await env.HUB_CONFIG.get("deletedToolIds", "json")) || []);
      const storedIds = new Set(stored.map(t => t.id));
      const missingDefaults = DEFAULT_TOOLS.filter(t => !storedIds.has(t.id) && !deletedIds.has(t.id));
      const merged = missingDefaults.length ? [...stored, ...missingDefaults] : stored;
      if (changed || missingDefaults.length) { await saveTools(env, merged); return merged; }
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

    // --- Outils API personnalisés : CRUD ---
    if (parts[0] === "api" && parts[1] === "custom-tools") {
      const customTools = await getCustomTools(env);
      const ctId = parts[2];

      if (request.method === "GET" && !ctId) return json({ customTools });

      if (request.method === "POST" && !ctId) {
        const body = await request.json();
        if (!body.name || !body.host) return json({ error: "Nom et hôte requis" }, 400);
        const id = uniqueId("custom-" + slugify(body.name), customTools.map(t => t.id));
        const tool = { ...body, id };
        customTools.push(tool);
        await saveCustomTools(env, customTools);
        return json({ ok: true, tool });
      }

      if (request.method === "DELETE" && ctId) {
        await saveCustomTools(env, customTools.filter(t => t.id !== ctId));
        return json({ ok: true });
      }
    }

    // --- Exécution d'un outil API personnalisé ---
    if (request.method === "POST" && url.pathname === "/api/custom-tools/call") {
      try {
        const body = await request.json();
        const customTools = await getCustomTools(env);
        const toolConfig = customTools.find(t => t.id === body.id);
        if (!toolConfig) return json({ error: "Outil introuvable" }, 400);
        const data = await callCustomTool(env, toolConfig, body.fields || {});
        return json(data);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Outils : GET liste / POST créer / PUT modifier / DELETE supprimer ---
    if (parts[0] === "api" && parts[1] === "tools") {
      const tools = await getTools(env);
      const toolId = parts[2];

      if (request.method === "GET" && !toolId) {
        const customTools = await getCustomTools(env);
        const customAsTools = customTools.map(t => ({ id: t.id, name: t.name, icon: t.icon || "🧩", category: t.category, kind: "custom-api" }));
        return json({ tools: [...tools, ...customAsTools] });
      }

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
        const deletedIds = new Set((await env.HUB_CONFIG.get("deletedToolIds", "json")) || []);
        deletedIds.add(toolId);
        await env.HUB_CONFIG.put("deletedToolIds", JSON.stringify([...deletedIds]));
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
      return json(await safeJson(res));
    }

    // --- Recherche Pexels (photos) ---
    if (request.method === "GET" && url.pathname === "/api/pexels-search") {
      if (!env.PEXELS_KEY) return json({ error: "Clé PEXELS_KEY manquante" }, 500);
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Paramètre q requis" }, 400);
      const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=15`, {
        headers: { Authorization: env.PEXELS_KEY }
      });
      const data = await safeJson(res);
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
      const data = await safeJson(res);
      const videos = (data.videos || []).map(v => {
        const files = (v.video_files || []).slice().sort((a, b) => (a.width || 0) - (b.width || 0));
        const sd = files.find(f => f.width && f.width <= 960) || files[0];
        const hd = files.slice().reverse()[0];
        return { id: v.id, thumb: v.image, preview: sd ? sd.link : null, full: hd ? hd.link : null, duration: v.duration, photographer: v.user ? v.user.name : "", url: v.url };
      });
      return json({ videos });
    }

    // --- Vidéo (AIMLAPI) : soumission ---
    if (request.method === "POST" && url.pathname === "/api/generate-video") {
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

        const v2Base = provider.base_url.replace(/\/v1$/, "/v2");
        const payload = { model: tool.model, prompt: body.prompt };
        if (body.image_url) payload.image_url = body.image_url;

        const res = await fetch(`${v2Base}/video/generations`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await safeJson(res);
        if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
        return json({ id: data.id, status: data.status });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Vidéo (AIMLAPI) : statut ---
    if (request.method === "GET" && url.pathname === "/api/generate-video/status") {
      try {
        const genId = url.searchParams.get("id");
        if (!genId) return json({ error: "Paramètre id requis" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === "aimlapi");
        const apiKey = env[provider.api_key_secret];
        const v2Base = provider.base_url.replace(/\/v1$/, "/v2");

        const res = await fetch(`${v2Base}/video/generations?generation_id=${encodeURIComponent(genId)}`, { headers: { "Authorization": `Bearer ${apiKey}` } });
        const data = await safeJson(res);
        return json({ status: data.status, video_url: data.video ? data.video.url : null, error: data.error });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Unsplash : recherche de photos (banque gratuite) ---
    if (request.method === "GET" && url.pathname === "/api/unsplash-search") {
      if (!env.UNSPLASH_KEY) return json({ error: "Clé UNSPLASH_KEY manquante" }, 500);
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Paramètre q requis" }, 400);
      const res = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=15`, {
        headers: { Authorization: `Client-ID ${env.UNSPLASH_KEY}` }
      });
      const data = await safeJson(res);
      if (!res.ok) return json({ error: data.errors ? data.errors.join(", ") : `Erreur Unsplash: ${res.status}` }, 500);
      const results = (data.results || []).map(p => ({
        id: p.id, thumb: p.urls.small, full: p.urls.regular, photographer: p.user ? p.user.name : "", link: p.links ? p.links.html : ""
      }));
      return json({ results });
    }

    // --- Freesound : recherche par mots-clés (libre de droit) ---
    if (request.method === "GET" && url.pathname === "/api/freesound-search") {
      if (!env.FREESOUND_API_KEY) return json({ error: "Clé FREESOUND_API_KEY manquante" }, 500);
      const q = url.searchParams.get("q") || "";
      if (!q) return json({ error: "Paramètre q requis" }, 400);
      const res = await fetch(`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&fields=id,name,previews,duration,username,license&page_size=15&token=${env.FREESOUND_API_KEY}`);
      const data = await safeJson(res);
      if (!res.ok) return json({ error: data.detail || `Erreur Freesound: ${res.status}` }, 500);
      const results = (data.results || []).map(s => ({
        id: s.id, name: s.name, duration: s.duration, username: s.username, license: s.license,
        preview: s.previews ? (s.previews["preview-hq-mp3"] || s.previews["preview-lq-mp3"]) : null
      }));
      return json({ results });
    }

    // --- Musique (AIMLAPI) : soumission d'une génération audio ---
    if (request.method === "POST" && url.pathname === "/api/generate-audio") {
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

        const v2Base = provider.base_url.replace(/\/v1$/, "/v2");
        const payload = { model: tool.model, prompt: body.prompt };
        if (body.lyrics) payload.lyrics = body.lyrics;

        const res = await fetch(`${v2Base}/generate/audio`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await safeJson(res);
        if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
        return json({ id: data.id, status: data.status });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Musique (AIMLAPI) : statut d'une génération audio ---
    if (request.method === "GET" && url.pathname === "/api/generate-audio/status") {
      try {
        const genId = url.searchParams.get("id");
        if (!genId) return json({ error: "Paramètre id requis" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === "aimlapi");
        if (!provider) return json({ error: "Fournisseur AIMLAPI introuvable" }, 400);
        const apiKey = env[provider.api_key_secret];
        const v2Base = provider.base_url.replace(/\/v1$/, "/v2");

        const res = await fetch(`${v2Base}/generate/audio?generation_id=${encodeURIComponent(genId)}`, { headers: { "Authorization": `Bearer ${apiKey}` } });
        const data = await safeJson(res);
        return json({ status: data.status, audio_url: data.audio_file ? data.audio_file.url : null, error: data.error });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
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
        const data = await safeJson(res);
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
        const data = await safeJson(res);
        return json({ status: data.status, output_url: data.output_url, thumbnail_url: data.thumbnail_url, error: data.error });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- RapidAPI (Downloaders) : appel générique vers l'un des 12 outils ---
    if (request.method === "POST" && url.pathname === "/api/rapidapi") {
      try {
        const body = await request.json();
        const data = await callRapidApi(env, body.source, body.fields || {});
        return json(data);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- ApyHub : appel générique vers l'un des 17 outils configurés ---
    if (request.method === "POST" && url.pathname === "/api/apyhub") {
      try {
        const body = await request.json();
        const data = await callApyHub(env, body.source, body.fields || {}, body.files || {});
        return json(data);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Transcription (Whisper via AIMLAPI) : soumission ---
    if (request.method === "POST" && url.pathname === "/api/transcribe") {
      try {
        const body = await request.json();
        const tools = await getTools(env);
        const tool = tools.find(t => t.id === body.toolId);
        if (!tool) return json({ error: "Outil introuvable" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === tool.providerId);
        const apiKey = env[provider.api_key_secret];
        if (!apiKey) return json({ error: `Clé manquante (${provider.api_key_secret})` }, 500);

        // OpenAI répond directement, pas besoin d'attente/polling
        if (tool.providerId === "openai") {
          const dataUrlOpenAi = body.audio_base64;
          if (!dataUrlOpenAi) return json({ error: "Un fichier est requis pour ce modèle (pas de lien direct pour l'instant)." }, 400);
          const matchOpenAi = dataUrlOpenAi.match(/^data:(.+?);base64,(.+)$/);
          if (!matchOpenAi) return json({ error: "Format de fichier invalide" }, 400);
          const mimeTypeOpenAi = matchOpenAi[1];
          const rawOpenAi = atob(matchOpenAi[2]);
          const bytesOpenAi = new Uint8Array(rawOpenAi.length);
          for (let i = 0; i < rawOpenAi.length; i++) bytesOpenAi[i] = rawOpenAi.charCodeAt(i);
          const blobOpenAi = new Blob([bytesOpenAi], { type: mimeTypeOpenAi });

          const formOpenAi = new FormData();
          formOpenAi.append("model", tool.model);
          formOpenAi.append("file", blobOpenAi, "audio." + (mimeTypeOpenAi.split("/")[1] || "mp3"));

          const resOpenAi = await fetch(`${provider.base_url}/audio/transcriptions`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: formOpenAi
          });
          const dataOpenAi = await safeJson(resOpenAi);
          if (!resOpenAi.ok) return json({ error: dataOpenAi.error?.message || `Erreur: ${resOpenAi.status}` }, 500);
          return json({ done: true, text: dataOpenAi.text });
        }

        let res;
        if (body.audio_url) {
          res = await fetch("https://api.aimlapi.com/v1/stt/create", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: tool.model, url: body.audio_url })
          });
        } else {
          const dataUrl = body.audio_base64;
          const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
          if (!match) return json({ error: "Format de fichier invalide" }, 400);
          const mimeType = match[1];
          const raw = atob(match[2]);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          const blob = new Blob([bytes], { type: mimeType });

          const form = new FormData();
          form.append("model", tool.model);
          form.append("audio", blob, "audio." + (mimeType.split("/")[1] || "mp3"));

          res = await fetch("https://api.aimlapi.com/v1/stt/create", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}` },
            body: form
          });
        }
        const data = await safeJson(res);
        if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
        return json({ generation_id: data.generation_id });
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Transcription : statut ---
    if (request.method === "GET" && url.pathname === "/api/transcribe/status") {
      try {
        const genId = url.searchParams.get("id");
        if (!genId) return json({ error: "Paramètre id requis" }, 400);
        const providers = await getProviders(env);
        const provider = providers.find(p => p.id === "aimlapi");
        const apiKey = env[provider.api_key_secret];

        const res = await fetch(`https://api.aimlapi.com/v1/stt/${encodeURIComponent(genId)}`, { headers: { "Authorization": `Bearer ${apiKey}` } });
        const data = await safeJson(res);
        return json(data);
      } catch (err) {
        return json({ error: err.message || String(err) }, 500);
      }
    }

    // --- Ésotérisme : horoscope, lune, citations, soleil, tarot ---
    if (request.method === "GET" && url.pathname === "/api/esoteric/horoscope") {
      const sign = url.searchParams.get("sign") || "aries";
      const keyPart = env.VIEWBITS_KEY ? `&key=${env.VIEWBITS_KEY}` : "";
      const res = await fetch(`https://api.viewbits.com/v1/horoscope?sign=${sign}${keyPart}`);
      const data = await safeJson(res);
      if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
      return json(data);
    }

    if (request.method === "GET" && url.pathname === "/api/esoteric/moonphase") {
      const keyPart = env.VIEWBITS_KEY ? `?key=${env.VIEWBITS_KEY}` : "";
      const res = await fetch(`https://api.viewbits.com/v1/moonphase${keyPart}`);
      const data = await safeJson(res);
      if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
      return json(data);
    }

    if (request.method === "GET" && url.pathname === "/api/esoteric/zenquotes") {
      const keyPart = env.VIEWBITS_KEY ? `&key=${env.VIEWBITS_KEY}` : "";
      const res = await fetch(`https://api.viewbits.com/v1/zenquotes?mode=random${keyPart}`);
      const data = await safeJson(res);
      if (!res.ok) return json({ error: data.message || `Erreur: ${res.status}` }, 500);
      return json(data);
    }

    if (request.method === "GET" && url.pathname === "/api/esoteric/sunrise") {
      const lat = url.searchParams.get("lat") || "45.7";
      const lng = url.searchParams.get("lng") || "-74.0";
      const res = await fetch(`https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&formatted=0`);
      const data = await safeJson(res);
      return json(data);
    }

    // Tarot : endpoint non-confirmé par documentation officielle — à valider avec Diane
    if (request.method === "GET" && url.pathname === "/api/esoteric/tarot") {
      if (!env.Astro_KEY) return json({ error: "Clé Astro_KEY manquante" }, 500);
      try {
        const res = await fetch("https://astrology-api.io/api/v1/tarot/draw", {
          headers: { "Authorization": `Bearer ${env.Astro_KEY}` }
        });
        const data = await safeJson(res);
        if (!res.ok) return json({ error: data.message || `Erreur: ${res.status} — endpoint peut-être incorrect, à vérifier` }, 500);
        return json(data);
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
      const data = await safeJson(res);
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
        const data = await safeJson(res);
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
      const data = await safeJson(res);
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
