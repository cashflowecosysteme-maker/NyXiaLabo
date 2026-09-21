/**
 * NyXiaLabo — routeur Atelier Équipe
 * ----------------------------------
 * Cette couche est volontairement séparée de _worker.js : elle ajoute les
 * fonctions de l'Atelier sans réécrire ni casser les outils déjà en ligne.
 * Toute route non gérée ici est déléguée au Worker LIVE existant.
 */
import baseWorker from './_worker.js'
import puppeteer from '@cloudflare/puppeteer'

const PROJECT_INDEX_KEY = 'atelier:projects:index'
const PROJECT_PREFIX = 'atelier:project:'
const MAX_INDEX_ITEMS = 300
const TTS_SAFE_BYTES = 4500

// Cartographie Azgaar intégrée au MÊME Worker nyxialabo.
const CARTO_ENGINE_NAME = 'Azgaar Fantasy Map Generator'
const CARTO_MIN_DIMENSION = 400
const CARTO_MAX_DIMENSION = 2400
const CARTO_DEFAULT_LAYERS = ['states', 'borders', 'lakes', 'rivers', 'routes', 'burgIcons', 'labels', 'scaleBar']
const CARTO_ALLOWED_OUTPUTS = new Set(['map', 'json', 'svg', 'png'])
const CARTO_DEFAULT_PATH = '/cartographie/azgaar/'
const CARTO_NONCE_PREFIX = 'atelier:carto:editor-nonce:'


// NyXia Game Live — répétitions et soirées Zoom dans le MÊME Worker.
const GAME_LIVE_PREFIX = 'game:live:'
const GAME_LIVE_TTL = 72 * 60 * 60
const GAME_LIVE_MAX_PLAYERS = 60
const GAME_LIVE_MAX_LOG = 220
const GAME_LIVE_DEFAULT_MODEL = 'anthropic/claude-sonnet-5'

// NyXia Game — catalogue, licences clients et bibliothèque.
const GAME_PRODUCT_INDEX_KEY = 'game:products:index'
const GAME_PRODUCT_PREFIX = 'game:product:'
const GAME_LICENSE_PREFIX = 'game:license:'
const GAME_LIBRARY_SESSION_PREFIX = 'game:library-session:'
const GAME_LIBRARY_SESSION_TTL = 30 * 24 * 60 * 60
const GAME_LIBRARY_MAX_RECENT_SESSIONS = 30

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
  if (!env.LABO_STORE) return []
  return (await env.LABO_STORE.get(PROJECT_INDEX_KEY, 'json')) || []
}

async function saveIndex(env, index) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  const sorted = [...index]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_INDEX_ITEMS)
  await env.LABO_STORE.put(PROJECT_INDEX_KEY, JSON.stringify(sorted))
}

async function saveProject(env, project) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  await env.LABO_STORE.put(PROJECT_PREFIX + project.id, JSON.stringify(project))
  const index = await loadIndex(env)
  const next = index.filter(x => x.id !== project.id)
  next.push(projectMeta(project))
  await saveIndex(env, next)
}

async function getProject(env, id) {
  if (!env.LABO_STORE) return null
  return await env.LABO_STORE.get(PROJECT_PREFIX + id, 'json')
}

async function deleteProject(env, id) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  await env.LABO_STORE.delete(PROJECT_PREFIX + id)
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



function cartoClampDimension(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(CARTO_MIN_DIMENSION, Math.min(CARTO_MAX_DIMENSION, Math.round(n)))
}

function cartoSanitizeSeed(value) {
  const seed = cleanText(value, 64).replace(/[^a-zA-Z0-9_-]/g, '')
  return seed || String(Math.floor(100000000 + Math.random() * 900000000))
}

function cartoSanitizeLayer(value) {
  return cleanText(value, 80).replace(/[^a-zA-Z0-9_-]/g, '')
}

function cartoSanitizePreset(value) {
  return cleanText(value, 80).replace(/[^a-zA-Z0-9 _-]/g, '')
}

function cartoRequestedOutputs(value) {
  const list = Array.isArray(value) ? value : ['map', 'json', 'svg', 'png']
  const valid = [...new Set(list.map(String).filter(x => CARTO_ALLOWED_OUTPUTS.has(x)))]
  return valid.length ? valid : ['map', 'json', 'svg', 'png']
}

function cartoBaseUrl(request, env) {
  const configured = cleanText(env.AZGAAR_BASE_URL || '', 500)
  return new URL(configured || CARTO_DEFAULT_PATH, request.url)
}

function cartoMapUrl(request, env, cfg) {
  const base = cartoBaseUrl(request, env)
  base.searchParams.set('seed', cfg.seed)
  base.searchParams.set('width', String(cfg.width))
  base.searchParams.set('height', String(cfg.height))
  base.searchParams.set('options', 'default')
  if (cfg.layers.length) base.searchParams.set('layers', cfg.layers.join(','))
  else if (cfg.preset) base.searchParams.set('preset', cfg.preset)
  return base.toString()
}

function cartoFilenameFor(title, ext) {
  const base = cleanText(title || 'carte-nyxia', 120)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'carte-nyxia'
  return `${base}.${ext}`
}

function cartoFileDescriptor(jobId, name, contentType, size) {
  return { name, contentType, size, path: `/files/${jobId}/${encodeURIComponent(name)}` }
}

async function cartoPutText(env, key, text, contentType, meta = {}) {
  await env.MAPS.put(key, text, { httpMetadata: { contentType }, customMetadata: meta })
  return new TextEncoder().encode(text).byteLength
}

async function cartoPutBytes(env, key, bytes, contentType, meta = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  await env.MAPS.put(key, data, { httpMetadata: { contentType }, customMetadata: meta })
  return data.byteLength
}

async function cartoExtractWorldJson(page) {
  return await page.evaluate(() => {
    const arr = value => Array.from(value || [])
    const clone = value => JSON.parse(JSON.stringify(value ?? null))
    const cells = globalThis.pack?.cells || {}
    const gcells = globalThis.grid?.cells || {}
    const info = {
      seed: globalThis.options?.map?.seed,
      mapName: globalThis.options?.map?.lore?.name || '',
      width: globalThis.options?.map?.graph?.width,
      height: globalThis.options?.map?.graph?.height,
      created: globalThis.mapHistory?.at?.(-1)?.created || Date.now()
    }
    const payload = {
      info,
      coordinates: clone(globalThis.options?.map?.geography?.coordinates),
      settings: {
        units: clone(globalThis.options?.map?.units),
        generation: clone(globalThis.options?.generation),
        template: globalThis.options?.generation?.template || null
      },
      pack: {
        features: clone(globalThis.pack?.features),
        biomes: clone(globalThis.pack?.biomes),
        cultures: clone(globalThis.pack?.cultures),
        burgs: clone(globalThis.pack?.burgs),
        states: clone(globalThis.pack?.states),
        provinces: clone(globalThis.pack?.provinces),
        religions: clone(globalThis.pack?.religions),
        rivers: clone(globalThis.pack?.rivers),
        routes: clone(globalThis.pack?.routes),
        zones: clone(globalThis.pack?.zones),
        markers: clone(globalThis.pack?.markers),
        journeys: clone(globalThis.pack?.journeys),
        cells: {
          p: clone(cells.p), h: arr(cells.h), area: arr(cells.area), biome: arr(cells.biome),
          pop: arr(cells.pop), culture: arr(cells.culture), burg: arr(cells.burg), state: arr(cells.state),
          religion: arr(cells.religion), province: arr(cells.province), r: arr(cells.r), routes: clone(cells.routes)
        }
      },
      grid: {
        spacing: globalThis.grid?.spacing,
        cellsX: globalThis.grid?.cellsX,
        cellsY: globalThis.grid?.cellsY,
        points: globalThis.grid?.points,
        boundary: clone(globalThis.grid?.boundary),
        cells: { h: arr(gcells.h), temp: arr(gcells.temp), prec: arr(gcells.prec), f: arr(gcells.f), t: arr(gcells.t) }
      }
    }
    return JSON.stringify(payload)
  })
}

async function cartoMakePng(browser, svgText, width, height) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;overflow:hidden}svg{display:block;width:100%;height:100%}</style></head><body>' + svgText + '</body></html>', { waitUntil: 'load' })
    const svg = await page.$('svg')
    if (!svg) throw new Error('SVG Azgaar introuvable pour le rendu PNG')
    return await svg.screenshot({ type: 'png' })
  } finally {
    await page.close().catch(() => {})
  }
}

async function cartoGenerateMap(request, env) {
  if (!env.BROWSER) return json({ error: 'Browser Rendering n’est pas activé sur le Worker nyxialabo.' }, 503)
  if (!env.MAPS) return json({ error: 'Le stockage R2 MAPS n’est pas lié au Worker nyxialabo.' }, 503)

  const body = await request.json().catch(() => ({}))
  const cfg = {
    seed: cartoSanitizeSeed(body.seed),
    width: cartoClampDimension(body.width, 1600),
    height: cartoClampDimension(body.height, 1000),
    preset: cartoSanitizePreset(body.preset || 'political'),
    layers: (Array.isArray(body.layers) ? body.layers : CARTO_DEFAULT_LAYERS).map(cartoSanitizeLayer).filter(Boolean).slice(0, 40),
    outputs: cartoRequestedOutputs(body.outputs),
    title: cleanText(body.title || 'Carte NyXia', 180),
    projectId: cleanText(body.projectId || '', 80),
    projectKind: cleanText(body.projectKind || '', 40)
  }

  const jobId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const prefix = `jobs/${jobId}`
  const targetUrl = cartoMapUrl(request, env, cfg)
  const browserTargetUrl = new URL(targetUrl)
  const bearer = cartoBearerValue(request)
  if (bearer && env.LABO_STORE) {
    const nonce = crypto.randomUUID()
    await env.LABO_STORE.put(CARTO_NONCE_PREFIX + nonce, bearer, { expirationTtl: 120 })
    browserTargetUrl.searchParams.set('nx_auth', nonce)
  }
  const browser = await puppeteer.launch(env.BROWSER)

  let mapData = ''
  let svgText = ''
  let worldJson = ''
  let engineVersion = ''

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: 1 })
    await page.goto(browserTargetUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForFunction(
      () => Array.isArray(globalThis.mapHistory) && globalThis.mapHistory.length > 0 && globalThis.Services?.Save && globalThis.Services?.ExportMap,
      { timeout: 120000 }
    )
    await new Promise(resolve => setTimeout(resolve, 1200))

    if (cfg.outputs.includes('map')) {
      mapData = await page.evaluate(async () => await globalThis.Services.Save.prepareMapData())
      engineVersion = String(mapData.split(/\r?\n/, 1)[0] || '').split('|')[0] || ''
    }

    if (cfg.outputs.includes('svg') || cfg.outputs.includes('png')) {
      svgText = await page.evaluate(async () => {
        const url = await globalThis.Services.ExportMap.getMapURL('svg', { fullMap: true })
        const text = await (await fetch(url)).text()
        URL.revokeObjectURL(url)
        return text
      })
    }

    if (cfg.outputs.includes('json')) worldJson = await cartoExtractWorldJson(page)
    await page.close().catch(() => {})

    const meta = { seed: cfg.seed, projectId: cfg.projectId, engine: 'azgaar', createdAt }
    const files = {}

    if (cfg.outputs.includes('map')) {
      const name = cartoFilenameFor(cfg.title, 'map')
      const size = await cartoPutText(env, `${prefix}/${name}`, mapData, 'text/plain; charset=utf-8', meta)
      files.map = cartoFileDescriptor(jobId, name, 'text/plain; charset=utf-8', size)
    }
    if (cfg.outputs.includes('json')) {
      const name = cartoFilenameFor(cfg.title, 'json')
      const size = await cartoPutText(env, `${prefix}/${name}`, worldJson, 'application/json; charset=utf-8', meta)
      files.json = cartoFileDescriptor(jobId, name, 'application/json; charset=utf-8', size)
    }
    if (cfg.outputs.includes('svg')) {
      const name = cartoFilenameFor(cfg.title, 'svg')
      const size = await cartoPutText(env, `${prefix}/${name}`, svgText, 'image/svg+xml; charset=utf-8', meta)
      files.svg = cartoFileDescriptor(jobId, name, 'image/svg+xml; charset=utf-8', size)
    }
    if (cfg.outputs.includes('png')) {
      const png = await cartoMakePng(browser, svgText, cfg.width, cfg.height)
      const name = cartoFilenameFor(cfg.title, 'png')
      const size = await cartoPutBytes(env, `${prefix}/${name}`, png, 'image/png', meta)
      files.png = cartoFileDescriptor(jobId, name, 'image/png', size)
    }

    const sourceUrl = cartoBaseUrl(request, env)
    const manifest = {
      id: jobId,
      status: 'completed', createdAt,
      engine: CARTO_ENGINE_NAME, engineVersion,
      source: sourceUrl.toString(),
      title: cfg.title,
      projectId: cfg.projectId || null,
      projectKind: cfg.projectKind || null,
      seed: cfg.seed, width: cfg.width, height: cfg.height,
      preset: cfg.layers.length ? null : cfg.preset,
      layers: cfg.layers,
      exactReproduction: { seed: cfg.seed, width: cfg.width, height: cfg.height, layers: cfg.layers, engineVersion },
      editorUrl: targetUrl,
      files
    }
    await env.MAPS.put(`${prefix}/manifest.json`, JSON.stringify(manifest), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: meta
    })
    return json({ ok: true, job: manifest }, 201)
  } catch (error) {
    const failure = { id: jobId, status: 'failed', createdAt, seed: cfg.seed, title: cfg.title, error: error?.message || String(error) }
    await env.MAPS.put(`${prefix}/manifest.json`, JSON.stringify(failure), { httpMetadata: { contentType: 'application/json; charset=utf-8' } }).catch(() => {})
    return json({ error: failure.error, job: failure }, 500)
  } finally {
    await browser.close().catch(() => {})
  }
}

async function cartoGetJob(env, jobId) {
  if (!env.MAPS) return json({ error: 'R2 MAPS non configuré' }, 503)
  const obj = await env.MAPS.get(`jobs/${jobId}/manifest.json`)
  if (!obj) return json({ error: 'Carte introuvable' }, 404)
  return new Response(obj.body, { headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

async function cartoGetFile(env, jobId, filename) {
  if (!env.MAPS) return json({ error: 'R2 MAPS non configuré' }, 503)
  const safe = cleanText(decodeURIComponent(filename || ''), 180).replace(/[\\/]/g, '')
  if (!safe) return json({ error: 'Fichier invalide' }, 400)
  const obj = await env.MAPS.get(`jobs/${jobId}/${safe}`)
  if (!obj) return json({ error: 'Fichier introuvable' }, 404)
  const headers = new Headers()
  obj.writeHttpMetadata(headers)
  headers.set('ETag', obj.httpEtag)
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safe)}`)
  return new Response(obj.body, { headers })
}

async function cartoDeleteJob(env, jobId) {
  if (!env.MAPS) return json({ error: 'R2 MAPS non configuré' }, 503)
  const listed = await env.MAPS.list({ prefix: `jobs/${jobId}/` })
  if (!listed.objects.length) return json({ error: 'Carte introuvable' }, 404)
  await env.MAPS.delete(listed.objects.map(o => o.key))
  return json({ ok: true })
}


function cartoCookieValue(request, name) {
  const cookie = request.headers.get('Cookie') || ''
  const prefix = name + '='
  for (const part of cookie.split(';')) {
    const item = part.trim()
    if (item.startsWith(prefix)) return decodeURIComponent(item.slice(prefix.length))
  }
  return ''
}

function cartoBearerValue(request) {
  const header = request.headers.get('Authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

function cartoEditorCookie(token) {
  return `nyxia_carto=${encodeURIComponent(token)}; Path=${CARTO_DEFAULT_PATH}; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`
}

async function cartoAssetAuthorized(request, env, ctx) {
  const token = cartoBearerValue(request) || cartoCookieValue(request, 'nyxia_carto')
  if (!token) return false
  const headers = new Headers()
  headers.set('Authorization', 'Bearer ' + token)
  const checkReq = new Request(new URL('/api/tools', request.url).toString(), { method: 'GET', headers })
  const res = await baseWorker.fetch(checkReq, env, ctx)
  return res.ok
}

async function cartoServeEditorAsset(request, env, ctx) {
  if (!env.ASSETS) return new Response('Assets non configurés', { status: 503 })
  const url = new URL(request.url)

  // Browser Rendering reçoit un nonce à usage unique, jamais le token de session dans l'URL.
  const nonce = url.searchParams.get('nx_auth')
  if (nonce && env.LABO_STORE) {
    const key = CARTO_NONCE_PREFIX + cleanText(nonce, 100)
    const token = await env.LABO_STORE.get(key)
    if (token) {
      await env.LABO_STORE.delete(key)
      const headers = new Headers()
      headers.set('Authorization', 'Bearer ' + token)
      const checkReq = new Request(new URL('/api/tools', request.url).toString(), { method: 'GET', headers })
      const check = await baseWorker.fetch(checkReq, env, ctx)
      if (check.ok) {
        url.searchParams.delete('nx_auth')
        return new Response(null, {
          status: 302,
          headers: {
            'Location': url.toString(),
            'Set-Cookie': cartoEditorCookie(token),
            'Cache-Control': 'no-store'
          }
        })
      }
    }
  }

  if (!(await cartoAssetAuthorized(request, env, ctx))) {
    if (url.pathname === CARTO_DEFAULT_PATH || url.pathname.endsWith('/index.html')) {
      return Response.redirect(new URL('/login.html', request.url).toString(), 302)
    }
    return new Response('Non autorisé', { status: 401 })
  }
  return env.ASSETS.fetch(request)
}

async function handleCartography(request, env, path) {
  const parts = path.split('/').filter(Boolean)
  if (request.method === 'GET' && (path === '/' || path === '/health')) {
    return json({
      ok: true,
      service: 'nyxialabo-cartographie',
      engine: CARTO_ENGINE_NAME,
      browser: !!env.BROWSER,
      r2: !!env.MAPS,
      azgaarBaseUrl: CARTO_DEFAULT_PATH
    })
  }
  if (request.method === 'POST' && path === '/editor-session') {
    const token = cartoBearerValue(request)
    if (!token) return json({ error: 'Session Labo introuvable' }, 401)
    return json(
      { ok: true, editorUrl: CARTO_DEFAULT_PATH },
      200,
      { 'Set-Cookie': cartoEditorCookie(token) }
    )
  }
  if (request.method === 'POST' && path === '/generate') return cartoGenerateMap(request, env)
  if (parts[0] === 'jobs' && parts[1] && request.method === 'GET') return cartoGetJob(env, parts[1])
  if (parts[0] === 'jobs' && parts[1] && request.method === 'DELETE') return cartoDeleteJob(env, parts[1])
  if (parts[0] === 'files' && parts[1] && parts[2] && request.method === 'GET') return cartoGetFile(env, parts[1], parts.slice(2).join('/'))
  return json({ error: 'Route Cartographie inconnue' }, 404)
}



function gameProductKey(id) { return GAME_PRODUCT_PREFIX + cleanText(id, 120).replace(/[^a-zA-Z0-9_-]/g, '') }
function gameLicenseKey(hash) { return GAME_LICENSE_PREFIX + hash }
function gameLibrarySessionKey(hash) { return GAME_LIBRARY_SESSION_PREFIX + hash }

async function gameSha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function gameNormalizeAccessKey(value) {
  return cleanText(value, 120).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function gameRandomAccessKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  let raw = ''
  for (const b of bytes) raw += alphabet[b % alphabet.length]
  return 'NYX-' + raw.slice(0,4) + '-' + raw.slice(4,8) + '-' + raw.slice(8,12) + '-' + raw.slice(12,16) + '-' + raw.slice(16,20)
}

function gameProductPublic(product) {
  if (!product) return null
  return {
    id: product.id,
    title: product.title,
    subtitle: product.subtitle || '',
    description: product.description || '',
    coverUrl: product.coverUrl || '',
    category: product.category || product.gameType || 'NyXia Game',
    gameType: product.gameType || '',
    audience: product.audience || '16+',
    playMode: product.playMode || 'Hybride',
    players: product.players || '',
    duration: product.duration || '',
    genre: product.genre || '',
    version: product.version || '1.0',
    publishedAt: product.publishedAt || '',
    updatedAt: product.updatedAt || '',
    active: product.active !== false
  }
}

async function gameLoadProductIndex(env) {
  if (!env.LABO_STORE) return []
  return (await env.LABO_STORE.get(GAME_PRODUCT_INDEX_KEY, 'json')) || []
}
async function gameSaveProductIndex(env, index) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  const clean = [...index].filter(Boolean).slice(0, 500)
  await env.LABO_STORE.put(GAME_PRODUCT_INDEX_KEY, JSON.stringify(clean))
}
async function gameGetProduct(env, id) {
  if (!env.LABO_STORE) return null
  const key = gameProductKey(id)
  if (!key || key === GAME_PRODUCT_PREFIX) return null
  return await env.LABO_STORE.get(key, 'json')
}
async function gameSaveProduct(env, product) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  await env.LABO_STORE.put(gameProductKey(product.id), JSON.stringify(product))
  const index = await gameLoadProductIndex(env)
  const next = index.filter(x => x.id !== product.id)
  next.unshift(gameProductPublic(product))
  await gameSaveProductIndex(env, next)
}


function gameLinesFromText(value, maxItems = 30, maxLen = 120) {
  return String(value || '')
    .split(/\r?\n/)
    .map(x => cleanText(x.replace(/^[•*–—-]\s*/, ''), maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
}

function gamePlayerBadgeCatalog(value) {
  return gameLinesFromText(value, 40, 500).map((line, index) => {
    const parts = line.split('|').map(x => cleanText(x, 260))
    let icon = '🏅', name = '', description = ''
    if (parts.length >= 3) {
      icon = parts[0] || '🏅'
      name = parts[1] || `Badge ${index + 1}`
      description = parts.slice(2).join(' | ')
    } else if (parts.length === 2) {
      name = parts[0] || `Badge ${index + 1}`
      description = parts[1] || ''
    } else {
      name = parts[0] || `Badge ${index + 1}`
    }
    const id = ('badge-' + (index + 1) + '-' + name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90)
    return { id: id || `badge-${index + 1}`, icon: cleanText(icon, 20) || '🏅', name: cleanText(name, 120), description: cleanText(description, 360) }
  }).filter(x => x.name)
}

// Rôles prédéfinis : le savoir, les secrets et les consignes IA restent côté serveur.
function gameSafePortraitUrl(value) {
  const url = cleanText(value || '', 1600)
  if (url.startsWith('/game-media/')) return url
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? parsed.toString() : '' }
  catch (_) { return '' }
}
function gamePlayableRosterFromData(d = {}) {
  const raw = d.playableCharacters || []
  const entries = Array.isArray(raw) ? raw : []
  const used = new Set()
  return entries.slice(0, 8).map((entry, index) => {
    const id = cleanText(entry?.id || `pj-${index + 1}`, 70).replace(/[^a-zA-Z0-9_-]/g, '')
    const name = cleanText(entry?.name || '', 120)
    if (!id || !name || used.has(id)) return null
    used.add(id)
    return { id, name, archetype: cleanText(entry.archetype, 120), faction: cleanText(entry.faction, 120),
      publicBio: cleanText(entry.publicBio, 1200), portraitUrl: gameSafePortraitUrl(entry.portraitUrl),
      strength: cleanText(entry.strength, 700), weakness: cleanText(entry.weakness, 700),
      motivation: cleanText(entry.motivation, 900), secret: cleanText(entry.secret, 1200),
      aiInstructions: cleanText(entry.aiInstructions, 6000), knowledgeIds: Array.isArray(entry.knowledgeIds) ? entry.knowledgeIds.map(v => cleanText(v,100)).filter(Boolean).slice(0, 40) : [] }
  }).filter(Boolean)
}
function gamePublicRoster(session) {
  const reserved = new Set((session.players || []).map(p => p.character?.id).filter(Boolean))
  return (session.playableCharacters || []).map(c => ({ id:c.id, name:c.name, archetype:c.archetype,
    faction:c.faction, publicBio:c.publicBio, portraitUrl:c.portraitUrl, available: !reserved.has(c.id) }))
}

function gamePlayerConfigFromData(d = {}) {
  return {
    prologue: cleanText(d.playerPrologue || d.idea || '', 7000),
    creationInstructions: cleanText(d.playerCreationInstructions || '', 3000),
    archetypes: gameLinesFromText(d.playerArchetypes || '', 30, 120),
    factions: gameLinesFromText(d.playerFactions || '', 30, 120),
    startingReputation: Math.max(-100, Math.min(100, Number(d.playerStartingReputation) || 0)),
    reputationRules: cleanText(d.playerReputationRules || '', 5000),
    badgeCatalog: gamePlayerBadgeCatalog(d.playerBadgeCatalog || ''),
    allowPortrait: true
  }
}

function gameRuntimeSnapshotFromData(d = {}) {
  return {
    lockedCanon: d.lockedCanon || '',
    worldBible: d.worldBible || '',
    storyStructure: d.storyStructure || '',
    scenesQuests: d.scenesQuests || '',
    characters: d.characters || '',
    playerPrologue: d.playerPrologue || '',
    playerCreationInstructions: d.playerCreationInstructions || '',
    playerArchetypes: d.playerArchetypes || '',
    playerFactions: d.playerFactions || '',
    playerStartingReputation: Number(d.playerStartingReputation) || 0,
    playerReputationRules: d.playerReputationRules || '',
    playerBadgeCatalog: d.playerBadgeCatalog || '',
    npcIntelligence: d.npcIntelligence || '',
    npcRuntimeJson: d.npcRuntimeJson || '',
    npcMemoryRules: d.npcMemoryRules || '',
    npcRelationshipRules: d.npcRelationshipRules || '',
    npcAutonomyRules: d.npcAutonomyRules || '',
    npcVoicePlan: d.npcVoicePlan || '',
    npcModel: d.npcModel || '',
    factionsCreatures: d.factionsCreatures || '',
    itemsRewards: d.itemsRewards || '',
    mechanics: d.mechanics || '',
    combatRules: d.combatRules || '',
    progression: d.progression || '',
    livePlan: d.livePlan || '',
    hostMaterials: d.hostMaterials || '',
    playerMaterials: d.playerMaterials || '',
    imageBriefs: d.imageBriefs || '',
    audioPlan: d.audioPlan || '',
    videoPlan: d.videoPlan || '',
    mapPlan: d.mapPlan || ''
  }
}

function gameGuidedScenesFromData(d = {}) {
  const raw = d.guidedScenesJson || d.guidedScenes || ''
  let parsed = raw
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    if (!cleaned) return []
    try { parsed = JSON.parse(cleaned) } catch (_) { return [] }
  }
  const source = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.scenes) ? parsed.scenes : [])
  return source.slice(0, 80).map((scene, index) => {
    const breakout = scene?.breakout && typeof scene.breakout === 'object' ? scene.breakout : {}
    const npc = scene?.npc && typeof scene.npc === 'object' ? scene.npc : {}
    const dice = scene?.dice && typeof scene.dice === 'object' ? scene.dice : {}
    const media = scene?.media && typeof scene.media === 'object' ? scene.media : {}
    const clues = Array.isArray(scene?.clues) ? scene.clues.slice(0, 30).map((clue, ci) => ({
      id: cleanText(clue?.id || `clue-${index + 1}-${ci + 1}`, 100),
      label: cleanText(clue?.label || `Indice ${ci + 1}`, 160),
      scope: clue?.scope === 'team' ? 'team' : 'all',
      team: cleanText(clue?.team || '', 80),
      text: cleanText(clue?.text || '', 1600)
    })).filter(clue => clue.text) : []
    return {
      id: cleanText(scene?.id || `scene-${String(index + 1).padStart(2, '0')}`, 100),
      phase: cleanText(scene?.phase || `Étape ${index + 1}`, 120),
      title: cleanText(scene?.title || `Scène ${index + 1}`, 220),
      durationMinutes: Math.max(0, Math.min(180, Number(scene?.durationMinutes) || 0)),
      hostInstruction: cleanText(scene?.hostInstruction || '', 5000),
      readAloud: cleanText(scene?.readAloud || '', 6000),
      playerObjective: cleanText(scene?.playerObjective || '', 1800),
      announcement: cleanText(scene?.announcement || '', 1800),
      completion: cleanText(scene?.completion || '', 2400),
      breakout: {
        enabled: breakout.enabled === true,
        instruction: cleanText(breakout.instruction || '', 2600),
        teams: Array.isArray(breakout.teams) ? breakout.teams.map(x => cleanText(x, 80)).filter(Boolean).slice(0, 12) : []
      },
      npc: {
        enabled: npc.enabled === true || !!cleanText(npc.name || '', 160),
        name: cleanText(npc.name || '', 160),
        instruction: cleanText(npc.instruction || '', 2200)
      },
      dice: {
        enabled: dice.enabled !== false,
        instruction: cleanText(dice.instruction || '', 2200)
      },
      media: {
        imageUrl: cleanText(media.imageUrl || '', 1600),
        audioUrl: cleanText(media.audioUrl || '', 1600),
        videoUrl: cleanText(media.videoUrl || '', 1600),
        instruction: cleanText(media.instruction || '', 2200)
      },
      clues
    }
  })
}

function gameRuntimeFromGuidedScene(scene, index = 0) {
  if (!scene) return gameLiveCleanRuntime({ phase: 'Accueil', guidedSceneIndex: 0, allowNpc: true, allowDice: true, sharedClues: [], teamClues: {} })
  return gameLiveCleanRuntime({
    guidedSceneIndex: index,
    guidedSceneId: scene.id || '',
    phase: scene.phase || '',
    sceneTitle: scene.title || '',
    objective: scene.playerObjective || '',
    announcement: scene.announcement || '',
    narrative: scene.readAloud || '',
    activeNpc: scene.npc?.name || '',
    allowNpc: scene.npc?.enabled !== false && !!scene.npc?.name,
    allowDice: scene.dice?.enabled !== false,
    imageUrl: scene.media?.imageUrl || '',
    audioUrl: scene.media?.audioUrl || '',
    videoUrl: scene.media?.videoUrl || '',
    sharedClues: [],
    teamClues: {}
  })
}

function gameHostPackageFromData(d = {}) {
  return {
    guidedScenes: gameGuidedScenesFromData(d),
    storyStructure: d.storyStructure || '',
    scenesQuests: d.scenesQuests || '',
    hostMaterials: d.hostMaterials || '',
    livePlan: d.livePlan || '',
    lockedCanon: d.lockedCanon || '',
    worldBible: d.worldBible || '',
    characters: d.characters || '',
    playerConfig: gamePlayerConfigFromData(d),
    playerMaterials: d.playerMaterials || '',
    mechanics: d.mechanics || '',
    combatRules: d.combatRules || '',
    progression: d.progression || ''
  }
}

async function gamePublishProject(env, project, body = {}) {
  if (!project || project.kind !== 'nyxia-game') throw new Error('Projet NyXia Game introuvable')
  const d = project.data || {}
  const requestedId = cleanText(body.productId || project.id, 120).replace(/[^a-zA-Z0-9_-]/g, '')
  const id = requestedId || project.id
  const prior = await gameGetProduct(env, id)
  const stamp = gameLiveNow()
  const guidedScenes = gameGuidedScenesFromData(d)
  const product = {
    id,
    sourceProjectId: project.id,
    title: cleanText(body.title || project.title || 'Jeu NyXia', 180),
    subtitle: cleanText(body.subtitle || d.packageSubtitle || '', 240),
    description: cleanText(body.description || d.packageNotes || d.idea || '', 4000),
    coverUrl: cleanText(body.coverUrl || d.coverUrl || '', 1600),
    category: cleanText(body.category || d.gameType || 'NyXia Game', 120),
    gameType: cleanText(d.gameType || 'Soirée immersive', 120),
    audience: cleanText(d.audience || '16+', 40),
    playMode: cleanText(d.playMode || 'Hybride', 80),
    players: String(d.playerCount || ''),
    duration: cleanText(d.duration || '', 80),
    genre: cleanText(d.genre || '', 120),
    version: cleanText(body.version || prior?.version || '1.0', 40),
    active: body.active !== false,
    defaultTeams: gameLiveTeams(body.teams || d.liveTeams),
    guidedScenes,
    playerConfig: gamePlayerConfigFromData(d),
    playableCharacters: gamePlayableRosterFromData(d),
    runtimeSnapshot: gameRuntimeSnapshotFromData(d),
    hostPackage: gameHostPackageFromData(d),
    starterRuntime: guidedScenes.length ? gameRuntimeFromGuidedScene(guidedScenes[0], 0) : gameLiveCleanRuntime({
      phase: 'Accueil',
      sceneTitle: cleanText(body.startScene || '', 220),
      objective: cleanText(body.startObjective || '', 1400),
      announcement: cleanText(body.startAnnouncement || '', 1800),
      allowNpc: true,
      allowDice: true,
      sharedClues: [],
      teamClues: {}
    }),
    createdAt: prior?.createdAt || stamp,
    publishedAt: prior?.publishedAt || stamp,
    updatedAt: stamp
  }
  await gameSaveProduct(env, product)
  return product
}

async function gameLoadLicenseByRawKey(env, rawKey) {
  const normalized = gameNormalizeAccessKey(rawKey)
  if (!normalized) return null
  const hash = await gameSha256Hex(normalized)
  const license = await env.LABO_STORE.get(gameLicenseKey(hash), 'json')
  return license ? { license, hash } : null
}

function gameLicenseExpired(license) {
  return !!(license?.expiresAt && Date.parse(license.expiresAt) < Date.now())
}

async function gameCreateLicense(env, body = {}) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  const productIds = [...new Set((Array.isArray(body.productIds) ? body.productIds : [body.productId]).map(x => cleanText(x, 120)).filter(Boolean))]
  if (!productIds.length) throw new Error('Au moins un produit est requis')
  for (const id of productIds) {
    const product = await gameGetProduct(env, id)
    if (!product || product.active === false) throw new Error(`Produit introuvable ou inactif : ${id}`)
  }
  const accessKey = gameRandomAccessKey()
  const normalized = gameNormalizeAccessKey(accessKey)
  const hash = await gameSha256Hex(normalized)
  const stamp = gameLiveNow()
  const license = {
    id: crypto.randomUUID(),
    label: cleanText(body.label || '', 180),
    email: cleanText(body.email || '', 240).toLowerCase(),
    productIds,
    active: true,
    maxSessionsPerProduct: Math.max(0, Math.min(9999, Number(body.maxSessionsPerProduct) || 0)),
    expiresAt: body.expiresAt ? cleanText(body.expiresAt, 80) : '',
    usage: {},
    sessions: [],
    createdAt: stamp,
    updatedAt: stamp
  }
  await env.LABO_STORE.put(gameLicenseKey(hash), JSON.stringify(license))
  return { accessKey, license }
}

async function gameSaveLicense(env, hash, license) {
  license.updatedAt = gameLiveNow()
  license.sessions = Array.isArray(license.sessions) ? license.sessions.slice(-GAME_LIBRARY_MAX_RECENT_SESSIONS) : []
  await env.LABO_STORE.put(gameLicenseKey(hash), JSON.stringify(license))
}

function gameLibraryToken(request, body = null) {
  return cleanText(request.headers.get('X-NyXia-Library-Token') || body?.libraryToken || '', 260)
}

async function gameLibraryAuth(env, token) {
  if (!token || !env.LABO_STORE) return null
  const tokenHash = await gameSha256Hex(token)
  const auth = await env.LABO_STORE.get(gameLibrarySessionKey(tokenHash), 'json')
  if (!auth?.licenseHash) return null
  const license = await env.LABO_STORE.get(gameLicenseKey(auth.licenseHash), 'json')
  if (!license || license.active === false || gameLicenseExpired(license)) return null
  return { auth, license, licenseHash: auth.licenseHash }
}

async function gameIssueLibraryToken(env, licenseHash, email = '') {
  const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
  const tokenHash = await gameSha256Hex(token)
  await env.LABO_STORE.put(gameLibrarySessionKey(tokenHash), JSON.stringify({
    licenseHash,
    email: cleanText(email || '', 240).toLowerCase(),
    createdAt: gameLiveNow()
  }), { expirationTtl: GAME_LIBRARY_SESSION_TTL })
  return token
}

async function gameLibraryState(env, authInfo, origin) {
  const { license } = authInfo
  const products = []
  for (const id of license.productIds || []) {
    const product = await gameGetProduct(env, id)
    if (product && product.active !== false) products.push(gameProductPublic(product))
  }
  const sessions = []
  for (const ref of (license.sessions || []).slice(-GAME_LIBRARY_MAX_RECENT_SESSIONS).reverse()) {
    const session = await gameLiveLoad(env, ref.code)
    if (!session) continue
    sessions.push({
      code: session.code,
      title: session.title,
      productId: session.productId || ref.productId || '',
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      playerCount: (session.players || []).length,
      joinUrl: `${origin}/game-live.html?code=${session.code}`,
      hostUrl: `${origin}/game-host.html?code=${session.code}&host=${encodeURIComponent(session.hostToken)}`
    })
  }
  return {
    license: {
      id: license.id,
      label: license.label || '',
      email: license.email || '',
      expiresAt: license.expiresAt || '',
      maxSessionsPerProduct: Number(license.maxSessionsPerProduct) || 0
    },
    products,
    sessions
  }
}

async function gameCreateSessionFromProduct(env, product, owner = {}, overrides = {}) {
  if (!product) throw new Error('Produit NyXia Game introuvable')
  const newCode = await gameLiveUniqueCode(env)
  const session = {
    code: newCode,
    id: crypto.randomUUID(),
    hostToken: crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
    productId: product.id,
    sourceProjectId: product.sourceProjectId || '',
    ownerLicenseId: owner.licenseId || '',
    title: product.title,
    gameType: product.gameType || 'Soirée immersive',
    audience: product.audience || '16+',
    status: 'lobby',
    createdAt: gameLiveNow(),
    updatedAt: gameLiveNow(),
    teams: gameLiveTeams(overrides.teams || product.defaultTeams || []),
    players: [],
    log: [],
    npcState: {},
    runtime: gameLiveCleanRuntime({ ...(product.starterRuntime || {}), sharedClues: [], teamClues: {} }),
    guidedScenes: structuredClone(product.guidedScenes || product.hostPackage?.guidedScenes || []),
    playerConfig: structuredClone(product.playerConfig || product.hostPackage?.playerConfig || {}),
    playableCharacters: structuredClone(product.playableCharacters || []),
    projectSnapshot: structuredClone(product.runtimeSnapshot || {}),
    hostPackage: structuredClone(product.hostPackage || {})
  }
  gameLiveLog(session, { type: 'session-created', text: 'Session créée depuis la bibliothèque NyXia Game' })
  await gameLiveSave(env, session)
  return session
}

async function handleGameLibrary(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/game/library', '') || '/'
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}

  if (request.method === 'POST' && path === '/redeem') {
    const found = await gameLoadLicenseByRawKey(env, body.accessKey)
    if (!found || found.license.active === false || gameLicenseExpired(found.license)) return json({ error: 'Clé d’accès invalide ou expirée' }, 401)
    const suppliedEmail = cleanText(body.email || '', 240).toLowerCase()
    if (found.license.email && suppliedEmail !== found.license.email) return json({ error: 'Cette clé est liée à une autre adresse courriel' }, 401)
    const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
    const tokenHash = await gameSha256Hex(token)
    await env.LABO_STORE.put(gameLibrarySessionKey(tokenHash), JSON.stringify({
      licenseHash: found.hash,
      email: suppliedEmail || found.license.email || '',
      createdAt: gameLiveNow()
    }), { expirationTtl: GAME_LIBRARY_SESSION_TTL })
    return json({ ok: true, libraryToken: token, ...(await gameLibraryState(env, { license: found.license, licenseHash: found.hash }, url.origin)) })
  }

  const token = gameLibraryToken(request, body)
  const authInfo = await gameLibraryAuth(env, token)
  if (!authInfo) return json({ error: 'Accès bibliothèque invalide ou expiré' }, 401)

  if (request.method === 'GET' && (path === '/' || path === '/me')) {
    return json(await gameLibraryState(env, authInfo, url.origin))
  }

  if (request.method === 'POST' && path === '/sessions') {
    const productId = cleanText(body.productId || '', 120)
    if (!authInfo.license.productIds?.includes(productId)) return json({ error: 'Ce jeu n’appartient pas à cette bibliothèque' }, 403)
    const product = await gameGetProduct(env, productId)
    if (!product || product.active === false) return json({ error: 'Jeu indisponible' }, 404)
    const currentUse = Number(authInfo.license.usage?.[productId]) || 0
    const limit = Number(authInfo.license.maxSessionsPerProduct) || 0
    if (limit > 0 && currentUse >= limit) return json({ error: `Limite de ${limit} soirées atteinte pour ce jeu` }, 409)
    const session = await gameCreateSessionFromProduct(env, product, { licenseId: authInfo.license.id }, { teams: body.teams })
    authInfo.license.usage = authInfo.license.usage || {}
    authInfo.license.usage[productId] = currentUse + 1
    authInfo.license.sessions = [...(authInfo.license.sessions || []), { code: session.code, productId, title: session.title, createdAt: session.createdAt }]
    await gameSaveLicense(env, authInfo.licenseHash, authInfo.license)
    return json({
      ok: true,
      code: session.code,
      joinUrl: `${url.origin}/game-live.html?code=${session.code}`,
      hostUrl: `${url.origin}/game-host.html?code=${session.code}&host=${encodeURIComponent(session.hostToken)}`,
      state: gameLiveHostState(session)
    }, 201)
  }

  return json({ error: 'Route bibliothèque NyXia Game inconnue' }, 404)
}

async function handleGameSalesGrant(request, env) {
  if (request.method !== 'POST') return json({ error: 'Méthode non permise' }, 405)
  if (!env.NYXIA_GAME_SALES_SECRET) return json({ error: 'Connexion Boutique non activée' }, 503)
  const secret = request.headers.get('X-NyXia-Sales-Secret') || ''
  if (!secret || secret !== env.NYXIA_GAME_SALES_SECRET) return json({ error: 'Non autorisé' }, 401)
  const body = await request.json().catch(() => ({}))
  const created = await gameCreateLicense(env, body)
  return json({ ok: true, accessKey: created.accessKey, license: created.license }, 201)
}

function gameLiveKey(code) { return GAME_LIVE_PREFIX + String(code || '').toUpperCase() }
function gameLiveCode(value) { return cleanText(value, 12).toUpperCase().replace(/[^A-Z0-9]/g, '') }
function gameLivePlayerToken(request, body = null) {
  return cleanText(request.headers.get('X-NyXia-Player-Token') || body?.playerToken || '', 180)
}
function gameLiveHostToken(request, body = null) {
  return cleanText(request.headers.get('X-NyXia-Host-Token') || body?.hostToken || '', 220)
}
function gameLiveNow() { return new Date().toISOString() }
function gameLiveTeams(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;]+/)
  const names = source.map(v => cleanText(v, 80)).filter(Boolean).slice(0, 12)
  return (names.length ? names : ['Équipe A', 'Équipe B']).map((name, i) => ({ id: `team-${i + 1}`, name }))
}
function gameLiveLog(session, event) {
  session.log = Array.isArray(session.log) ? session.log : []
  session.log.push({ id: crypto.randomUUID(), at: gameLiveNow(), ...event })
  session.log = session.log.slice(-GAME_LIVE_MAX_LOG)
}
async function gameLiveLoad(env, code) {
  if (!env.LABO_STORE) return null
  const normalized = gameLiveCode(code)
  if (!normalized) return null
  return await env.LABO_STORE.get(gameLiveKey(normalized), 'json')
}
async function gameLiveSave(env, session) {
  if (!env.LABO_STORE) throw new Error('CASHFLOW_KV non raccordée à l’Atelier')
  session.updatedAt = gameLiveNow()
  await env.LABO_STORE.put(gameLiveKey(session.code), JSON.stringify(session), { expirationTtl: GAME_LIVE_TTL })
}
async function gameLiveUniqueCode(env) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 12; attempt++) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    let code = ''
    for (const b of bytes) code += alphabet[b % alphabet.length]
    if (!(await gameLiveLoad(env, code))) return code
  }
  throw new Error('Impossible de créer un code de partie unique')
}
function gameLiveFindPlayer(session, token) {
  return (session.players || []).find(p => p.token === token) || null
}
function gameLivePublicPlayer(p, self = false) {
  const c = p?.character && typeof p.character === 'object' ? p.character : null
  const character = c ? {
    id: cleanText(c.id || '', 70),
    name: cleanText(c.name || '', 120),
    archetype: cleanText(c.archetype || '', 120),
    faction: cleanText(c.faction || '', 120),
    publicBio: cleanText(c.publicBio || '', 1200),
    portraitDataUrl: cleanText(c.portraitDataUrl || '', 240000),
    portraitUrl: cleanText(c.portraitUrl || '', 1600)
  } : null
  if (self && character) {
    character.strength = cleanText(c.strength || '', 700)
    character.weakness = cleanText(c.weakness || '', 700)
    character.motivation = cleanText(c.motivation || '', 900)
    character.secret = cleanText(c.secret || '', 1200)
  }
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    joinedAt: p.joinedAt,
    lastSeenAt: p.lastSeenAt,
    character,
    badges: Array.isArray(p.badges) ? p.badges.slice(-60) : [],
    reputation: p.reputation && typeof p.reputation === 'object' ? p.reputation : {}
  }
}
function gameLivePublicState(session, player) {
  const runtime = session.runtime || {}
  const teamClues = runtime.teamClues || {}
  return {
    code: session.code,
    title: session.title,
    gameType: session.gameType,
    audience: session.audience,
    status: session.status,
    updatedAt: session.updatedAt,
    player: gameLivePublicPlayer(player, true),
    players: (session.players || []).map(p => gameLivePublicPlayer(p, false)),
    teams: session.teams || [],
    playerConfig: session.playerConfig || {},
    playableRoster: gamePublicRoster(session),
    runtime: {
      guidedSceneIndex: Number.isInteger(runtime.guidedSceneIndex) ? runtime.guidedSceneIndex : 0,
      guidedSceneId: runtime.guidedSceneId || '',
      phase: runtime.phase || '',
      sceneTitle: runtime.sceneTitle || '',
      objective: runtime.objective || '',
      announcement: runtime.announcement || '',
      narrative: runtime.narrative || '',
      activeNpc: runtime.activeNpc || '',
      allowNpc: runtime.allowNpc !== false,
      allowDice: runtime.allowDice !== false,
      zoomUrl: runtime.zoomUrl || '',
      imageUrl: runtime.imageUrl || '',
      audioUrl: runtime.audioUrl || '',
      videoUrl: runtime.videoUrl || '',
      sharedClues: Array.isArray(runtime.sharedClues) ? runtime.sharedClues : [],
      teamClues: Array.isArray(teamClues[player.team]) ? teamClues[player.team] : []
    },
    relationship: (session.npcState || {})[`${player.id}::${runtime.activeNpc || ''}`]?.relation || null
  }
}
function gameLiveHostState(session) {
  const clone = structuredClone(session)
  clone.hostToken = undefined
  clone.playableCharacters = (clone.playableCharacters || []).map(({aiInstructions,knowledgeIds,...safe}) => safe)
  clone.players = (clone.players || []).map(p => ({ ...p, token: undefined }))
  if (clone.npcState) {
    Object.values(clone.npcState).forEach(v => { if (v && v.history) v.history = v.history.slice(-6) })
  }
  if (clone.projectSnapshot) {
    delete clone.projectSnapshot.npcRuntimeJson
    delete clone.projectSnapshot.npcMemoryRules
    delete clone.projectSnapshot.npcRelationshipRules
    delete clone.projectSnapshot.npcAutonomyRules
    delete clone.projectSnapshot.npcModel
  }
  return clone
}
function gameLiveCleanRuntime(runtime = {}) {
  return {
    guidedSceneIndex: Math.max(0, Math.min(999, Number(runtime.guidedSceneIndex) || 0)),
    guidedSceneId: cleanText(runtime.guidedSceneId || '', 100),
    phase: cleanText(runtime.phase || '', 120),
    sceneTitle: cleanText(runtime.sceneTitle || '', 220),
    objective: cleanText(runtime.objective || '', 1400),
    announcement: cleanText(runtime.announcement || '', 1800),
    narrative: cleanText(runtime.narrative || '', 6000),
    activeNpc: cleanText(runtime.activeNpc || '', 160),
    allowNpc: runtime.allowNpc !== false,
    allowDice: runtime.allowDice !== false,
    zoomUrl: cleanText(runtime.zoomUrl || '', 1000),
    imageUrl: cleanText(runtime.imageUrl || '', 1600),
    audioUrl: cleanText(runtime.audioUrl || '', 1600),
    videoUrl: cleanText(runtime.videoUrl || '', 1600),
    sharedClues: Array.isArray(runtime.sharedClues) ? runtime.sharedClues.map(x => cleanText(x, 1600)).filter(Boolean).slice(-60) : [],
    teamClues: runtime.teamClues && typeof runtime.teamClues === 'object' ? runtime.teamClues : {}
  }
}
async function gameLiveSecureDie(sides) {
  const max = Math.max(2, Math.min(1000, Number(sides) || 20))
  const limit = Math.floor(0x100000000 / max) * max
  const buf = new Uint32Array(1)
  let n
  do { crypto.getRandomValues(buf); n = buf[0] } while (n >= limit)
  return (n % max) + 1
}
function gameLiveNpcConfig(snapshot, npcName) {
  const raw = String(snapshot.npcRuntimeJson || '').trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.npcs) ? parsed.npcs : [])
    const target = String(npcName || '').toLowerCase()
    return list.find(n => String(n.name || n.nom || n.id || '').toLowerCase() === target) || null
  } catch (_) { return null }
}
function gameLiveClampRelation(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))) }
function gameLiveCleanPortrait(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  if (!/^data:image\/(?:png|jpe?g|webp);base64,/i.test(s)) return ''
  if (s.length > 240000) return ''
  return s
}
function gameLiveParseAiJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  try { return JSON.parse(cleaned) } catch (_) { return { reply: cleaned, memory: '', relationDelta: {} } }
}
async function gameLiveNpcReply(env, session, player, npcName, message) {
  if (!env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY manquante pour les PNJ IA Live')
  const snapshot = session.projectSnapshot || {}
  const config = gameLiveNpcConfig(snapshot, npcName)
  const key = `${player.id}::${npcName}`
  session.npcState = session.npcState || {}
  const state = session.npcState[key] || { relation: { trust: 50, affinity: 0, fear: 0 }, history: [], memories: [] }
  const recent = (state.history || []).slice(-10)
  const model = cleanText(snapshot.npcModel || env.NYXIA_GAME_NPC_MODEL || GAME_LIVE_DEFAULT_MODEL, 160)
  const runtime = session.runtime || {}
  const teamClues = (runtime.teamClues || {})[player.team] || []
  const system = `Tu interprètes UNIQUEMENT le PNJ « ${npcName} » dans NyXia Game.\n\nRÈGLE ABSOLUE DE VÉRITÉ : Canon verrouillé + Bible + état moteur sont la réalité. Le PNJ peut mentir EN PERSONNAGE ou avoir une croyance fausse si sa fiche le prévoit, mais il ne peut jamais inventer un nouveau fait canonique, lire une connaissance interdite ni modifier l’état du monde. S’il ignore une information, il doit l’ignorer naturellement.\n\nLe jeu est destiné à un public ${session.audience || '16+'}; conserve le ton adulte et immersif prévu par le projet.\n\nRéponds exclusivement en JSON valide : {"reply":"réponse en personnage","memory":"fait court à mémoriser ou chaîne vide","relationDelta":{"trust":0,"affinity":0,"fear":0}}. Les deltas sont des entiers entre -10 et 10. Ne mets aucun commentaire hors JSON.`
  const context = {
    npc: config || { fallbackText: snapshot.npcIntelligence || '', characters: snapshot.characters || '' },
    canon: snapshot.lockedCanon || '',
    bible: snapshot.worldBible || '',
    memoryRules: snapshot.npcMemoryRules || '',
    relationshipRules: snapshot.npcRelationshipRules || '',
    autonomyRules: snapshot.npcAutonomyRules || '',
    scene: { phase: runtime.phase, title: runtime.sceneTitle, objective: runtime.objective, narrative: runtime.narrative },
    player: {
      name: player.name,
      team: player.team,
      character: player.character ? {
        name: player.character.name || '',
        archetype: player.character.archetype || '',
        faction: player.character.faction || '',
        strength: player.character.strength || '',
        weakness: player.character.weakness || '',
        motivation: player.character.motivation || '',
        publicBio: player.character.publicBio || ''
      } : null,
      badges: Array.isArray(player.badges) ? player.badges.map(b => ({ name: b.name, icon: b.icon })) : [],
      reputation: player.reputation || {},
      discoveredClues: [...(runtime.sharedClues || []), ...teamClues],
      relation: state.relation,
      memories: state.memories || []
    }
  }
  const messages = [
    { role: 'user', content: `DOSSIER DE JEU ET ÉTAT ACTUEL:\n${JSON.stringify(context)}\n\nHISTORIQUE RÉCENT:\n${JSON.stringify(recent)}\n\nLe joueur dit : ${message}` }
  ]
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://labo.nyxia.top',
      'X-Title': 'NyXia Game Live NPC'
    },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], temperature: 0.8, max_tokens: 700 })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message || `OpenRouter: HTTP ${res.status}`)
  const parsed = gameLiveParseAiJson(data?.choices?.[0]?.message?.content || '')
  const delta = parsed.relationDelta || {}
  state.relation = state.relation || { trust: 50, affinity: 0, fear: 0 }
  state.relation.trust = gameLiveClampRelation(state.relation.trust + Math.max(-10, Math.min(10, Number(delta.trust) || 0)))
  state.relation.affinity = gameLiveClampRelation(state.relation.affinity + Math.max(-10, Math.min(10, Number(delta.affinity) || 0)))
  state.relation.fear = gameLiveClampRelation(state.relation.fear + Math.max(-10, Math.min(10, Number(delta.fear) || 0)))
  state.history = [...(state.history || []), { at: gameLiveNow(), player: message, npc: cleanText(parsed.reply || '', 5000) }].slice(-16)
  if (cleanText(parsed.memory || '', 700)) state.memories = [...(state.memories || []), cleanText(parsed.memory, 700)].slice(-24)
  state.lastAt = gameLiveNow()
  session.npcState[key] = state
  return { reply: cleanText(parsed.reply || '', 5000), relation: state.relation }
}

async function handleGamePublic(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/game/live', '') || '/'
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const code = gameLiveCode(body.code || url.searchParams.get('code') || '')
  if (!code) return json({ error: 'Code de partie requis' }, 400)
  const session = await gameLiveLoad(env, code)
  if (!session) return json({ error: 'Partie introuvable ou expirée' }, 404)

  if (request.method === 'POST' && path === '/join') {
    if (session.status === 'ended') return json({ error: 'Cette partie est terminée' }, 409)
    const name = cleanText(body.name, 80)
    if (!name) return json({ error: 'Ton nom est requis' }, 400)
    if ((session.players || []).length >= ((session.playableCharacters || []).length || GAME_LIVE_MAX_PLAYERS)) return json({ error: 'Partie complète' }, 409)
    const priorToken = cleanText(body.playerToken || '', 180)
    let player = priorToken ? gameLiveFindPlayer(session, priorToken) : null
    if (!player) {
      const teams = session.teams || []
      const team = cleanText(body.team || teams[(session.players || []).length % Math.max(1, teams.length)]?.name || '', 80)
      player = {
        id: crypto.randomUUID(),
        token: crypto.randomUUID().replaceAll('-', ''),
        name,
        team,
        character: null,
        badges: [],
        reputation: {},
        joinedAt: gameLiveNow(),
        lastSeenAt: gameLiveNow()
      }
      session.players = [...(session.players || []), player]
      gameLiveLog(session, { type: 'join', playerId: player.id, playerName: player.name, team: player.team })
    } else {
      player.name = name
      player.lastSeenAt = gameLiveNow()
    }
    await gameLiveSave(env, session)
    return json({ ok: true, playerToken: player.token, state: gameLivePublicState(session, player) })
  }

  const token = gameLivePlayerToken(request, body)
  const player = gameLiveFindPlayer(session, token)
  if (!player) return json({ error: 'Accès joueur invalide. Rejoins la partie de nouveau.' }, 401)
  player.lastSeenAt = gameLiveNow()

  if (request.method === 'POST' && path === '/character') {
    // Les nouveaux jeux à distribution imposée utilisent exclusivement les rôles approuvés.
    if (Array.isArray(session.playableCharacters) && session.playableCharacters.length) {
      if (player.character?.id) return json({ error: 'Ton personnage est déjà attribué. Seul le MJ peut organiser un transfert.' }, 409)
      const selected = session.playableCharacters.find(c => c.id === cleanText(body.characterId || '', 70))
      if (!selected) return json({ error: 'Choisis un personnage du jeu.' }, 400)
      if ((session.players || []).some(p => p.id !== player.id && p.character?.id === selected.id)) return json({ error: 'Ce personnage est déjà attribué.' }, 409)
      const { aiInstructions, knowledgeIds, ...character } = selected
      player.character = { ...character, createdAt:gameLiveNow(), updatedAt:gameLiveNow() }
      player.reputation = selected.faction ? { [selected.faction]:Number(session.playerConfig?.startingReputation)||0 } : {}
      gameLiveLog(session, { type:'character-selected', playerId:player.id, playerName:player.name,
        characterId:selected.id, characterName:selected.name })
      await gameLiveSave(env, session)
      return json({ ok:true, state:gameLivePublicState(session, player) })
    }
    const cfg = session.playerConfig || {}
    const allowedArchetypes = Array.isArray(cfg.archetypes) ? cfg.archetypes : []
    const allowedFactions = Array.isArray(cfg.factions) ? cfg.factions : []
    let archetype = cleanText(body.archetype || '', 120)
    let faction = cleanText(body.faction || '', 120)
    if (allowedArchetypes.length && archetype && !allowedArchetypes.includes(archetype)) return json({ error: 'Choisis un archétype proposé pour ce jeu.' }, 400)
    if (allowedFactions.length && faction && !allowedFactions.includes(faction)) return json({ error: 'Choisis une faction proposée pour ce jeu.' }, 400)
    const characterName = cleanText(body.characterName || '', 120)
    if (!characterName) return json({ error: 'Donne un nom à ton personnage.' }, 400)
    player.character = {
      name: characterName,
      archetype,
      faction,
      strength: cleanText(body.strength || '', 700),
      weakness: cleanText(body.weakness || '', 700),
      motivation: cleanText(body.motivation || '', 900),
      publicBio: cleanText(body.publicBio || '', 1200),
      secret: cleanText(body.secret || '', 1200),
      portraitDataUrl: gameLiveCleanPortrait(body.portraitDataUrl || ''),
      createdAt: player.character?.createdAt || gameLiveNow(),
      updatedAt: gameLiveNow()
    }
    player.badges = Array.isArray(player.badges) ? player.badges : []
    if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {}
    if (faction && !(faction in player.reputation)) {
      player.reputation[faction] = Math.max(-100, Math.min(100, Number(cfg.startingReputation) || 0))
    }
    gameLiveLog(session, { type: 'character-created', playerId: player.id, playerName: player.name, characterName, faction, archetype })
    await gameLiveSave(env, session)
    return json({ ok: true, state: gameLivePublicState(session, player) })
  }

  if (request.method === 'GET' && path === '/state') {
    await gameLiveSave(env, session)
    return json({ state: gameLivePublicState(session, player) })
  }

  if (request.method === 'POST' && path === '/action') {
    const type = cleanText(body.type || 'decision', 30)
    let entry = { id: crypto.randomUUID(), at: gameLiveNow(), type, playerId: player.id, playerName: player.name, team: player.team }
    if (type === 'roll') {
      if (session.runtime?.allowDice === false) return json({ error: 'Les dés sont désactivés pour cette scène' }, 409)
      const sides = Number(body.sides)
      if (![4, 6, 10, 20].includes(sides)) return json({ error:'Choisis un dé D4, D6, D10 ou D20.' }, 400)
      const mode = body.mode === 'physical' ? 'physical' : 'digital'
      const physicalResult = Number(body.result)
      if (mode === 'physical' && (!Number.isInteger(physicalResult) || physicalResult < 1 || physicalResult > sides))
        return json({ error:'Résultat physique invalide pour ce dé.' }, 400)
      const result = mode === 'physical' ? physicalResult : await gameLiveSecureDie(sides)
      entry = { ...entry, sides, mode, result, characterId:player.character?.id || '',
        characterName:player.character?.name || '', sceneId:session.runtime?.guidedSceneId || '',
        sceneTitle:session.runtime?.sceneTitle || '', context:cleanText(body.context || '', 140) }
    } else {
      entry.text = cleanText(body.text || '', 2400)
      if (!entry.text) return json({ error: 'Message vide' }, 400)
    }
    gameLiveLog(session, entry)
    await gameLiveSave(env, session)
    return json({ ok: true, action: entry })
  }

  if (request.method === 'POST' && path === '/npc-chat') {
    if (session.runtime?.allowNpc === false) return json({ error: 'Les PNJ IA sont désactivés pour cette scène' }, 409)
    const npcName = cleanText(session.runtime?.activeNpc || body.npc || '', 160)
    if (!npcName) return json({ error: 'Aucun PNJ n’est actuellement disponible' }, 409)
    const message = cleanText(body.message || '', 1200)
    if (!message) return json({ error: 'Écris une question au PNJ' }, 400)
    player.lastNpcAt = Number(player.lastNpcAt) || 0
    const now = Date.now()
    if (now - player.lastNpcAt < 1200) return json({ error: 'Un instant entre deux messages au PNJ.' }, 429)
    player.lastNpcAt = now
    const answer = await gameLiveNpcReply(env, session, player, npcName, message)
    gameLiveLog(session, { type: 'npc', playerId: player.id, playerName: player.name, team: player.team, npc: npcName, prompt: message, reply: answer.reply })
    await gameLiveSave(env, session)
    return json({ ok: true, npc: npcName, ...answer })
  }

  return json({ error: 'Route NyXia Game Live inconnue' }, 404)
}


async function gameLiveApplyHostUpdate(session, body = {}) {
  if (body.status) {
    const allowed = new Set(['lobby', 'live', 'paused', 'ended'])
    if (allowed.has(body.status)) session.status = body.status
  }
  if (body.runtime && typeof body.runtime === 'object') {
    const prior = session.runtime || {}
    const clean = gameLiveCleanRuntime({ ...prior, ...body.runtime })
    clean.sharedClues = prior.sharedClues || []
    clean.teamClues = prior.teamClues || {}
    session.runtime = clean
  }
  if (body.playerTeam && body.playerTeam.playerId) {
    const p = (session.players || []).find(x => x.id === body.playerTeam.playerId)
    if (p) p.team = cleanText(body.playerTeam.team || '', 80)
  }
  if (body.badgeAward && body.badgeAward.playerId) {
    const p = (session.players || []).find(x => x.id === body.badgeAward.playerId)
    if (p) {
      const catalog = Array.isArray(session.playerConfig?.badgeCatalog) ? session.playerConfig.badgeCatalog : []
      const requestedId = cleanText(body.badgeAward.badgeId || '', 100)
      const requestedName = cleanText(body.badgeAward.name || '', 120)
      const catalogBadge = catalog.find(b => b.id === requestedId || b.name === requestedName)
      const badge = {
        id: cleanText(catalogBadge?.id || requestedId || ('custom-' + crypto.randomUUID()), 100),
        icon: cleanText(catalogBadge?.icon || body.badgeAward.icon || '🏅', 20) || '🏅',
        name: cleanText(catalogBadge?.name || requestedName || 'Badge NyXia', 120),
        description: cleanText(catalogBadge?.description || body.badgeAward.description || '', 360),
        awardedAt: gameLiveNow()
      }
      p.badges = Array.isArray(p.badges) ? p.badges : []
      const exists = p.badges.some(b => b.id === badge.id && b.name === badge.name)
      if (!exists) {
        p.badges = [...p.badges, badge].slice(-60)
        gameLiveLog(session, { type: 'badge', playerId: p.id, playerName: p.name, badge: badge.name, icon: badge.icon })
      }
    }
  }
  if (body.reputationChange && body.reputationChange.playerId) {
    const p = (session.players || []).find(x => x.id === body.reputationChange.playerId)
    if (p) {
      const faction = cleanText(body.reputationChange.faction || p.character?.faction || 'Générale', 120) || 'Générale'
      const delta = Math.max(-100, Math.min(100, Number(body.reputationChange.delta) || 0))
      p.reputation = p.reputation && typeof p.reputation === 'object' ? p.reputation : {}
      const before = Number(p.reputation[faction]) || 0
      const after = Math.max(-100, Math.min(100, before + delta))
      p.reputation[faction] = after
      gameLiveLog(session, { type: 'reputation', playerId: p.id, playerName: p.name, faction, delta, value: after })
    }
  }
  if (body.clue && body.clue.text) {
    const text = cleanText(body.clue.text, 1600)
    session.runtime = session.runtime || gameLiveCleanRuntime({})
    if (body.clue.scope === 'team' && body.clue.team) {
      session.runtime.teamClues = session.runtime.teamClues || {}
      const team = cleanText(body.clue.team, 80)
      session.runtime.teamClues[team] = [...(session.runtime.teamClues[team] || []), text].slice(-60)
      gameLiveLog(session, { type: 'clue-team', team, text })
    } else {
      session.runtime.sharedClues = [...(session.runtime.sharedClues || []), text].slice(-60)
      gameLiveLog(session, { type: 'clue-all', text })
    }
  }
  if (body.clearClues) {
    session.runtime.sharedClues = []
    session.runtime.teamClues = {}
    gameLiveLog(session, { type: 'clues-cleared' })
  }
  if (body.clearLog) session.log = []
  gameLiveLog(session, { type: 'host-update', status: session.status, scene: session.runtime?.sceneTitle || '' })
}

async function handleGameCustomerHost(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/game/host', '') || '/'
  const parts = path.split('/').filter(Boolean)
  const code = gameLiveCode(parts[0] || url.searchParams.get('code') || '')
  if (!code) return json({ error: 'Code de partie requis' }, 400)
  const session = await gameLiveLoad(env, code)
  if (!session) return json({ error: 'Partie introuvable ou expirée' }, 404)
  const body = request.method === 'PUT' || request.method === 'POST' ? await request.json().catch(() => ({})) : {}
  const token = gameLiveHostToken(request, body)
  if (!token || token !== session.hostToken) return json({ error: 'Accès animateur invalide' }, 401)

  const joinUrl = `${url.origin}/game-live.html?code=${code}`
  if (request.method === 'GET') return json({ session: gameLiveHostState(session), joinUrl })
  if (request.method === 'POST' && body.type === 'roll') {
    if (session.runtime?.allowDice === false) return json({ error:'Dés désactivés dans cette scène.' },409)
    const sides = Number(body.sides)
    if (![4,6,10,20].includes(sides)) return json({ error:'Dé non pris en charge.' },400)
    const result = await gameLiveSecureDie(sides)
    const entry = { id:crypto.randomUUID(),at:gameLiveNow(),type:'roll',playerId:'host',playerName:'Maître de jeu',
      sides,mode:'digital',result,sceneId:session.runtime?.guidedSceneId || '',sceneTitle:session.runtime?.sceneTitle || '' }
    gameLiveLog(session,entry)
    await gameLiveSave(env,session)
    return json({ ok:true, action:entry, session:gameLiveHostState(session),joinUrl })
  }
  if (request.method === 'PUT') {
    await gameLiveApplyHostUpdate(session, body)
    await gameLiveSave(env, session)
    return json({ ok: true, session: gameLiveHostState(session), joinUrl })
  }
  if (request.method === 'DELETE') {
    session.status = 'ended'
    gameLiveLog(session, { type: 'session-ended' })
    await gameLiveSave(env, session)
    return json({ ok: true })
  }
  return json({ error: 'Route animateur NyXia Game inconnue' }, 404)
}

async function handleGameHost(request, env) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/atelier/game/live', '') || '/'
  const parts = path.split('/').filter(Boolean)
  const code = gameLiveCode(parts[0] || '')

  if (request.method === 'POST' && !code) {
    const body = await request.json().catch(() => ({}))
    const project = await getProject(env, cleanText(body.projectId, 120))
    if (!project || project.kind !== 'nyxia-game') return json({ error: 'Projet NyXia Game introuvable' }, 404)
    const d = project.data || {}
    const testProduct = {
      id: `atelier-${project.id}`,
      sourceProjectId: project.id,
      title: project.title,
      gameType: d.gameType || 'Soirée immersive',
      audience: d.audience || '16+',
      defaultTeams: gameLiveTeams(body.teams || d.liveTeams),
      guidedScenes: gameGuidedScenesFromData(d),
      playerConfig: gamePlayerConfigFromData(d),
      playableCharacters: gamePlayableRosterFromData(d),
      runtimeSnapshot: gameRuntimeSnapshotFromData(d),
      hostPackage: gameHostPackageFromData(d),
      starterRuntime: gameGuidedScenesFromData(d).length ? gameRuntimeFromGuidedScene(gameGuidedScenesFromData(d)[0], 0) : gameLiveCleanRuntime({ phase: 'Accueil', allowNpc: true, allowDice: true, sharedClues: [], teamClues: {} })
    }
    const session = await gameCreateSessionFromProduct(env, testProduct, { licenseId: 'ATELIER-TEST' }, { teams: body.teams || d.liveTeams })
    return json({ ok: true, session: gameLiveHostState(session), joinUrl: `${url.origin}/game-live.html?code=${session.code}`, hostUrl: `${url.origin}/game-host.html?code=${session.code}&host=${encodeURIComponent(session.hostToken)}` }, 201)
  }

  if (!code) return json({ error: 'Code de partie requis' }, 400)
  const session = await gameLiveLoad(env, code)
  if (!session) return json({ error: 'Session Live introuvable ou expirée' }, 404)

  if (request.method === 'GET') return json({ session: gameLiveHostState(session), joinUrl: `${url.origin}/game-live.html?code=${code}`, hostUrl: `${url.origin}/game-host.html?code=${code}&host=${encodeURIComponent(session.hostToken)}` })

  if (request.method === 'PUT') {
    const body = await request.json().catch(() => ({}))
    await gameLiveApplyHostUpdate(session, body)
    await gameLiveSave(env, session)
    return json({ ok: true, session: gameLiveHostState(session), joinUrl: `${url.origin}/game-live.html?code=${code}`, hostUrl: `${url.origin}/game-host.html?code=${code}&host=${encodeURIComponent(session.hostToken)}` })
  }

  if (request.method === 'DELETE') {
    session.status = 'ended'
    gameLiveLog(session, { type: 'session-ended' })
    await gameLiveSave(env, session)
    return json({ ok: true })
  }

  return json({ error: 'Route hôte NyXia Game Live inconnue' }, 404)
}

async function handleAtelier(request, env, ctx) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)

  if (!(await isAuthorized(request, env, ctx))) return json({ error: 'Non autorisé' }, 401)

  // Diagnostic lecture seule des ressources centrales. Aucune table D1 créée ou modifiée.
  if (request.method === 'GET' && url.pathname === '/api/atelier/health') {
    let d1 = false
    let d1Error = ''
    if (env.DB && typeof env.DB.prepare === 'function') {
      try {
        await env.DB.prepare('SELECT 1 AS ok').first()
        d1 = true
      } catch (error) {
        d1Error = 'D1 centrale liée, mais requête de lecture impossible.'
      }
    } else {
      d1Error = 'Binding DB absent.'
    }
    return json({
      ok: !!env.LABO_STORE && d1 && !!env.VECTORIZE_INDEX,
      kv: !!env.LABO_STORE,
      d1,
      d1Error,
      vectorize: !!env.VECTORIZE_INDEX,
      bindings: { kv: 'CASHFLOW_KV', d1: 'nyxia-cercles-db', vectorize: 'univers-livres' },
      googleTts: googleTtsConfigured(env),
      cartography: !!env.BROWSER && !!env.MAPS,
      version: 'atelier-equipe-4.1-central-kv-d1-vectorize'
    })
  }

  // NyXia Cartographie — intégrée au MÊME Worker nyxialabo.
  if (url.pathname.startsWith('/api/atelier/cartography')) {
    const targetPath = url.pathname.replace('/api/atelier/cartography', '') || '/health'
    return handleCartography(request, env, targetPath)
  }

  // NyXia Game Live — console animateur protégée par la session du Labo.
  if (url.pathname.startsWith('/api/atelier/game/live')) return handleGameHost(request, env)

  // NyXia Game — publication interne vers la bibliothèque client.
  if (request.method === 'POST' && url.pathname === '/api/atelier/game/publish') {
    const body = await request.json().catch(() => ({}))
    const project = await getProject(env, cleanText(body.projectId, 120))
    if (!project || project.kind !== 'nyxia-game') return json({ error: 'Projet NyXia Game introuvable' }, 404)
    const product = await gamePublishProject(env, project, body)
    return json({ ok: true, product: gameProductPublic(product) }, 201)
  }

  // NyXia Game — test interne en un clic. Crée une vraie bibliothèque client temporaire
  // sans demander à l'équipe de manipuler une clé d'accès.
  if (request.method === 'POST' && url.pathname === '/api/atelier/game/test-client') {
    const body = await request.json().catch(() => ({}))
    const project = await getProject(env, cleanText(body.projectId, 120))
    if (!project || project.kind !== 'nyxia-game') return json({ error: 'Projet NyXia Game introuvable' }, 404)
    const product = await gamePublishProject(env, project, {
      productId: body.productId || project.id,
      title: body.title || project.title,
      subtitle: body.subtitle || project.data?.packageSubtitle || '',
      description: body.description || project.data?.packageNotes || project.data?.idea || '',
      coverUrl: body.coverUrl || project.data?.coverUrl || '',
      version: body.version || project.data?.productVersion || '1.0',
      teams: body.teams || project.data?.liveTeams || ''
    })
    if (!Array.isArray(product.guidedScenes) || !product.guidedScenes.length) {
      return json({ error: 'Le jeu n’a pas encore de scènes guidées. Finalise d’abord le conducteur dans le Labo.' }, 409)
    }
    const created = await gameCreateLicense(env, {
      productId: product.id,
      label: `TEST INTERNE — ${product.title}`,
      maxSessionsPerProduct: 0
    })
    const licenseHash = await gameSha256Hex(gameNormalizeAccessKey(created.accessKey))
    const libraryToken = await gameIssueLibraryToken(env, licenseHash, '')
    return json({
      ok: true,
      product: gameProductPublic(product),
      libraryUrl: `${url.origin}/game-library.html?test_token=${encodeURIComponent(libraryToken)}`
    }, 201)
  }

  if (request.method === 'POST' && url.pathname === '/api/atelier/game/license') {
    const body = await request.json().catch(() => ({}))
    const created = await gameCreateLicense(env, body)
    return json({
      ok: true,
      accessKey: created.accessKey,
      license: created.license,
      libraryUrl: `${url.origin}/game-library.html`
    }, 201)
  }

  if (request.method === 'GET' && url.pathname === '/api/atelier/game/products') {
    return json({ products: await gameLoadProductIndex(env) })
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
    const host = url.hostname.toLowerCase()
    const isGamePortal = host === 'portailgame.nyxia.top'

    // Portail public NyXia Game : même moteur, mais aucune porte vers NyXiaLabo.
    if (isGamePortal) {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!env.ASSETS) return new Response('Assets non configurés', { status: 503 })
        return env.ASSETS.fetch(new Request(new URL('/game-library.html', request.url), request))
      }
      const gameAssets = new Set(['/game-library.html', '/game-host.html', '/game-live.html', '/FavIcon.png'])
      if (gameAssets.has(url.pathname)) {
        if (!env.ASSETS) return new Response('Assets non configurés', { status: 503 })
        return env.ASSETS.fetch(request)
      }
      if (!url.pathname.startsWith('/api/game/')) {
        return new Response('Introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } })
      }
    }

    if (url.pathname.startsWith(CARTO_DEFAULT_PATH)) {
      try {
        return await cartoServeEditorAsset(request, env, ctx)
      } catch (err) {
        return new Response(err?.message || String(err), { status: 500 })
      }
    }
    if (url.pathname.startsWith('/api/game/library')) {
      try {
        return await handleGameLibrary(request, env)
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500)
      }
    }
    if (url.pathname.startsWith('/api/game/sales/grant')) {
      try {
        return await handleGameSalesGrant(request, env)
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500)
      }
    }
    if (url.pathname.startsWith('/api/game/host')) {
      try {
        return await handleGameCustomerHost(request, env)
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500)
      }
    }
    if (url.pathname.startsWith('/api/game/live')) {
      try {
        return await handleGamePublic(request, env)
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500)
      }
    }
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
