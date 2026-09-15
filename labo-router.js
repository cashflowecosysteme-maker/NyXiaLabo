/**
 * NyXiaLabo — routeur Atelier Équipe
 * ----------------------------------
 * Cette couche est volontairement séparée de _worker.js : elle ajoute les
 * fonctions de l'Atelier sans réécrire ni casser les outils déjà en ligne.
 * Toute route non gérée ici est déléguée au Worker LIVE existant.
 */
import baseWorker from './_worker.js'

const PROJECT_INDEX_KEY = 'atelier:projects:index'
const PROJECT_PREFIX = 'atelier:project:'
const MAX_INDEX_ITEMS = 300
const TTS_SAFE_BYTES = 4500

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  })
}

function nowIso() { return new Date().toISOString() }

function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

function projectMeta(project) {
  return {
    id: project.id,
    kind: project.kind,
    title: project.title || 'Projet sans titre',
    client: project.client || '',
    status: project.status || 'brouillon',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  }
}

async function loadIndex(env) {
  if (!env.HUB_CONFIG) return []
  return (await env.HUB_CONFIG.get(PROJECT_INDEX_KEY, 'json')) || []
}

async function saveIndex(env, index) {
  if (!env.HUB_CONFIG) throw new Error('HUB_CONFIG non configuré')
  const sorted = [...index]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_INDEX_ITEMS)
  await env.HUB_CONFIG.put(PROJECT_INDEX_KEY, JSON.stringify(sorted))
}

async function saveProject(env, project) {
  if (!env.HUB_CONFIG) throw new Error('HUB_CONFIG non configuré')
  await env.HUB_CONFIG.put(PROJECT_PREFIX + project.id, JSON.stringify(project))
  const index = await loadIndex(env)
  const next = index.filter(x => x.id !== project.id)
  next.push(projectMeta(project))
  await saveIndex(env, next)
}

async function getProject(env, id) {
  if (!env.HUB_CONFIG) return null
  return await env.HUB_CONFIG.get(PROJECT_PREFIX + id, 'json')
}

async function deleteProject(env, id) {
  if (!env.HUB_CONFIG) throw new Error('HUB_CONFIG non configuré')
  await env.HUB_CONFIG.delete(PROJECT_PREFIX + id)
  await saveIndex(env, (await loadIndex(env)).filter(x => x.id !== id))
}

/**
 * On réutilise volontairement l'authentification du Worker existant au lieu
 * de dupliquer SESSION_SECRET ici. Un GET /api/tools est déjà une route
 * protégée : si elle accepte le même Bearer token, l'accès Atelier est valide.
 */
async function isAuthorized(request, env, ctx) {
  const checkUrl = new URL('/api/tools', request.url)
  const checkReq = new Request(checkUrl.toString(), {
    method: 'GET',
    headers: request.headers
  })
  const res = await baseWorker.fetch(checkReq, env, ctx)
  return res.ok
}

let _googleTokenCache = { token: '', expiresAt: 0, issuer: '' }

function base64Url(bytes) {
  let binary = ''
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function utf8Base64Url(value) {
  return base64Url(new TextEncoder().encode(String(value)))
}

function pemToArrayBuffer(pem) {
  const clean = String(pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!clean) throw new Error('Clé privée Google manquante')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function googleServiceAccount(env) {
  const jsonSecret = env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON || env.GOOGLE_SERVICE_ACCOUNT_JSON || ''
  if (jsonSecret) {
    try {
      const parsed = JSON.parse(jsonSecret)
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
          project_id: parsed.project_id || env.GOOGLE_TTS_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT_ID || ''
        }
      }
    } catch (_) {
      // Le message détaillé est généré plus bas pour éviter d'exposer le secret.
    }
  }
  const client_email = env.GOOGLE_TTS_CLIENT_EMAIL || env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
  const private_key = env.GOOGLE_TTS_PRIVATE_KEY || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  const project_id = env.GOOGLE_TTS_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT_ID || ''
  if (client_email && private_key) return { client_email, private_key, project_id }
  return null
}

function googleTtsConfigured(env) {
  return !!(env.GOOGLE_TTS_ACCESS_TOKEN || googleServiceAccount(env))
}

async function googleAccessToken(env) {
  // Option de dépannage seulement : un access token temporaire peut être injecté.
  if (env.GOOGLE_TTS_ACCESS_TOKEN) return { token: env.GOOGLE_TTS_ACCESS_TOKEN, projectId: env.GOOGLE_TTS_PROJECT_ID || '' }

  const account = googleServiceAccount(env)
  if (!account) {
    throw new Error('Authentification Google TTS manquante. Ajoute GOOGLE_TTS_SERVICE_ACCOUNT_JSON (recommandé) ou GOOGLE_TTS_CLIENT_EMAIL + GOOGLE_TTS_PRIVATE_KEY dans le Worker nyxialabo.')
  }

  const now = Math.floor(Date.now() / 1000)
  if (_googleTokenCache.token && _googleTokenCache.issuer === account.client_email && _googleTokenCache.expiresAt > now + 90) {
    return { token: _googleTokenCache.token, projectId: account.project_id || '' }
  }

  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3500
  }
  const unsigned = utf8Base64Url(JSON.stringify(header)) + '.' + utf8Base64Url(JSON.stringify(claims))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const assertion = unsigned + '.' + base64Url(signature)

  const form = new URLSearchParams()
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer')
  form.set('assertion', assertion)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  const tokenData = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || `Google OAuth: HTTP ${tokenRes.status}`)
  }

  _googleTokenCache = {
    token: tokenData.access_token,
    expiresAt: now + Math.max(300, Number(tokenData.expires_in) || 3600),
    issuer: account.client_email
  }
  return { token: tokenData.access_token, projectId: account.project_id || '' }
}

async function googleRequest(env, url, init = {}) {
  const auth = await googleAccessToken(env)
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', 'Bearer ' + auth.token)
  if (auth.projectId) headers.set('x-goog-user-project', auth.projectId)
  return fetch(url, { ...init, headers })
}

async function googleVoices(env, languageCode) {
  if (!googleTtsConfigured(env)) {
    return json({ error: 'Google TTS n’est pas encore authentifié. Ajoute un compte de service dans les Secrets Cloudflare du Worker nyxialabo.' }, 503)
  }
  const url = new URL('https://texttospeech.googleapis.com/v1/voices')
  if (languageCode) url.searchParams.set('languageCode', languageCode)
  let res
  try { res = await googleRequest(env, url.toString()) }
  catch (err) { return json({ error: err.message || String(err) }, 503) }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return json({ error: data.error?.message || `Google TTS: HTTP ${res.status}` }, res.status)
  const voices = (data.voices || [])
    .filter(v => (v.languageCodes || []).some(code => code.toLowerCase().startsWith('fr')))
    .map(v => ({ name: v.name, languageCodes: v.languageCodes, ssmlGender: v.ssmlGender, naturalSampleRateHertz: v.naturalSampleRateHertz }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  return json({ voices })
}

async function synthesizeGoogle(env, body) {
  if (!googleTtsConfigured(env)) {
    return json({ error: 'Google TTS n’est pas encore authentifié. Ajoute un compte de service dans les Secrets Cloudflare du Worker nyxialabo.' }, 503)
  }

  const text = String(body.text || '')
  if (!text.trim()) return json({ error: 'Texte requis' }, 400)
  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > TTS_SAFE_BYTES) {
    return json({ error: `Segment trop long (${byteLength} octets). Le Studio découpe automatiquement les longs chapitres; limite serveur ${TTS_SAFE_BYTES}.` }, 413)
  }

  const languageCode = cleanText(body.languageCode || 'fr-FR', 20) || 'fr-FR'
  const voiceName = cleanText(body.voiceName || '', 120)
  const speakingRate = Math.max(0.25, Math.min(4, Number(body.speakingRate) || 1))
  const pitch = Math.max(-20, Math.min(20, Number(body.pitch) || 0))

  const payload = {
    input: { text },
    voice: voiceName ? { languageCode, name: voiceName } : { languageCode },
    audioConfig: { audioEncoding: 'MP3', speakingRate, pitch }
  }

  let res
  try {
    res = await googleRequest(env, 'https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload)
    })
  } catch (err) {
    return json({ error: err.message || String(err) }, 503)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return json({ error: data.error?.message || `Google TTS: HTTP ${res.status}` }, res.status)
  return json({ audioContent: data.audioContent, mimeType: 'audio/mpeg', voiceName: voiceName || null, languageCode, speakingRate, pitch })
}

async function handleAtelier(request, env, ctx) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)

  if (!(await isAuthorized(request, env, ctx))) return json({ error: 'Non autorisé' }, 401)

  // État/capacités — jamais la valeur des secrets.
  if (request.method === 'GET' && url.pathname === '/api/atelier/health') {
    return json({
      ok: true,
      kv: !!env.HUB_CONFIG,
      googleTts: googleTtsConfigured(env),
      version: 'atelier-equipe-1.0'
    })
  }

  // Projets Atelier — index léger + un objet KV par projet.
  if (parts[2] === 'projects') {
    const id = parts[3]
    const action = parts[4]

    if (request.method === 'GET' && !id) {
      return json({ projects: await loadIndex(env) })
    }

    if (request.method === 'POST' && !id) {
      const body = await request.json().catch(() => ({}))
      const stamp = nowIso()
      const project = {
        id: crypto.randomUUID(),
        kind: cleanText(body.kind || 'ghostwriting', 40),
        title: cleanText(body.title || 'Nouveau projet', 180),
        client: cleanText(body.client || '', 180),
        status: cleanText(body.status || 'brouillon', 40),
        createdAt: stamp,
        updatedAt: stamp,
        data: body.data && typeof body.data === 'object' ? body.data : {}
      }
      await saveProject(env, project)
      return json({ ok: true, project }, 201)
    }

    if (id && request.method === 'GET' && !action) {
      const project = await getProject(env, id)
      return project ? json({ project }) : json({ error: 'Projet introuvable' }, 404)
    }

    if (id && request.method === 'PUT' && !action) {
      const existing = await getProject(env, id)
      if (!existing) return json({ error: 'Projet introuvable' }, 404)
      const body = await request.json().catch(() => ({}))
      const project = {
        ...existing,
        ...body,
        id,
        kind: cleanText(body.kind ?? existing.kind, 40),
        title: cleanText(body.title ?? existing.title, 180),
        client: cleanText(body.client ?? existing.client, 180),
        status: cleanText(body.status ?? existing.status, 40),
        data: body.data && typeof body.data === 'object' ? body.data : existing.data,
        createdAt: existing.createdAt,
        updatedAt: nowIso()
      }
      await saveProject(env, project)
      return json({ ok: true, project })
    }

    if (id && request.method === 'DELETE' && !action) {
      if (!(await getProject(env, id))) return json({ error: 'Projet introuvable' }, 404)
      await deleteProject(env, id)
      return json({ ok: true })
    }

    if (id && request.method === 'POST' && action === 'duplicate') {
      const source = await getProject(env, id)
      if (!source) return json({ error: 'Projet introuvable' }, 404)
      const body = await request.json().catch(() => ({}))
      const stamp = nowIso()
      const copy = {
        ...source,
        id: crypto.randomUUID(),
        title: cleanText(body.title || `${source.title} — variante`, 180),
        status: 'brouillon',
        createdAt: stamp,
        updatedAt: stamp,
        data: structuredClone(source.data || {})
      }
      if (body.dataPatch && typeof body.dataPatch === 'object') copy.data = { ...copy.data, ...body.dataPatch }
      await saveProject(env, copy)
      return json({ ok: true, project: copy }, 201)
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/atelier/tts/voices') {
    return googleVoices(env, url.searchParams.get('languageCode') || 'fr-FR')
  }

  if (request.method === 'POST' && url.pathname === '/api/atelier/tts') {
    return synthesizeGoogle(env, await request.json().catch(() => ({})))
  }

  return json({ error: 'Route Atelier inconnue' }, 404)
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/atelier/')) {
      try {
        return await handleAtelier(request, env, ctx)
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500)
      }
    }
    return baseWorker.fetch(request, env, ctx)
  }
}
