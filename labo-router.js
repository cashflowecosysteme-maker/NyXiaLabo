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
const CARTO_DEFAULT_BASE_URL = 'https://azgaar.github.io/Fantasy-Map-Generator/'

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

function cartoMapUrl(env, cfg) {
  const base = new URL(env.AZGAAR_BASE_URL || CARTO_DEFAULT_BASE_URL)
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
  const targetUrl = cartoMapUrl(env, cfg)
  const browser = await puppeteer.launch(env.BROWSER)

  let mapData = ''
  let svgText = ''
  let worldJson = ''
  let engineVersion = ''

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: cfg.width, height: cfg.height, deviceScaleFactor: 1 })
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })
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

    const sourceUrl = env.AZGAAR_BASE_URL || CARTO_DEFAULT_BASE_URL
    const manifest = {
      id: jobId,
      status: 'completed', createdAt,
      engine: CARTO_ENGINE_NAME, engineVersion,
      source: new URL(sourceUrl).origin,
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

async function handleCartography(request, env, path) {
  const parts = path.split('/').filter(Boolean)
  if (request.method === 'GET' && (path === '/' || path === '/health')) {
    return json({
      ok: true,
      service: 'nyxialabo-cartographie',
      engine: CARTO_ENGINE_NAME,
      browser: !!env.BROWSER,
      r2: !!env.MAPS,
      azgaarBaseUrl: env.AZGAAR_BASE_URL || CARTO_DEFAULT_BASE_URL
    })
  }
  if (request.method === 'POST' && path === '/generate') return cartoGenerateMap(request, env)
  if (parts[0] === 'jobs' && parts[1] && request.method === 'GET') return cartoGetJob(env, parts[1])
  if (parts[0] === 'jobs' && parts[1] && request.method === 'DELETE') return cartoDeleteJob(env, parts[1])
  if (parts[0] === 'files' && parts[1] && parts[2] && request.method === 'GET') return cartoGetFile(env, parts[1], parts.slice(2).join('/'))
  return json({ error: 'Route Cartographie inconnue' }, 404)
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
      cartography: !!env.BROWSER && !!env.MAPS,
      version: 'atelier-equipe-2.1-integrated'
    })
  }

  // NyXia Cartographie — intégrée au MÊME Worker nyxialabo.
  if (url.pathname.startsWith('/api/atelier/cartography')) {
    const targetPath = url.pathname.replace('/api/atelier/cartography', '') || '/health'
    return handleCartography(request, env, targetPath)
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
