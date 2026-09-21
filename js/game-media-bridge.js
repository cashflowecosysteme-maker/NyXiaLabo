/**
 * NyXia Game — livraison R2 isolée du routeur existant.
 * Ne change aucune route existante : TTS, Cartographie, jeux et authentification
 * continuent d'être servis par js/tts-bridge.js.
 *
 * R2 reste privé ; chaque média est autorisé par session Labo, bibliothèque,
 * animateur ou joueur, et limité au jeu correspondant. Pas de lien public.
 * Les droits doivent aussi être vérifiés auprès du fournisseur R2 : aucun domaine
 * r2.dev ou domaine R2 public ne doit contourner ce Worker.
 */
import existingWorker from './tts-bridge.js'

const LABO_KV_PREFIX = 'nyxialabo:'
const LEGACY_DELETED = '__NYXIALABO_CENTRAL_DELETED__'
const EXPIRING_LEGACY = /(?:^|:)(?:[^:]*session[^:]*|live|[^:]*nonce[^:]*)(?::|$)/i

// Toutes les écritures du Labo vont à la KV commune, dans son propre espace de clés.
// L'ancienne KV est lue uniquement pour ne perdre aucun projet ou réglage antérieur.
// Les clés à durée limitée ne sont pas recopiées sans leur échéance d'origine.
function laboStore(central, legacy) {
  function decode(raw, mode) {
    if (raw === null || raw === LEGACY_DELETED) return null
    const type = typeof mode === 'string' ? mode : mode?.type
    return type === 'json' ? JSON.parse(raw) : raw
  }
  return {
    async get(key, mode) {
      const scopedKey = LABO_KV_PREFIX + key
      const current = await central.get(scopedKey)
      if (current !== null) return decode(current, mode)
      const old = legacy ? await legacy.get(key) : null
      if (old === null) return null
      // Migration non destructive, uniquement lors de la lecture des clés persistantes.
      if (!EXPIRING_LEGACY.test(key)) await central.put(scopedKey, old)
      return decode(old, mode)
    },
    put(key, value, options) {
      return central.put(LABO_KV_PREFIX + key, value, options)
    },
    delete(key) {
      // Tombstone : l'ancienne KV ne peut pas ressusciter un projet supprimé.
      return central.put(LABO_KV_PREFIX + key, LEGACY_DELETED)
    }
  }
}

function sessionUnivers(request) {
  const cookie = request.headers.get('Cookie') || ''
  const match = cookie.match(/(?:^|;\s*)nyxia_univers=([^;]+)/)
  return match && match[1] && match[1].length <= 240 ? match[1] : ''
}

async function universAccess(request, central) {
  const token = sessionUnivers(request)
  if (!token || !central) return false
  const raw = await central.get('univers:session:' + token)
  if (!raw) return false
  try { return JSON.parse(raw).role === 'superadmin' }
  catch (_) { return false }
}

// Autorise l'intégration visuelle UNIQUEMENT dans Univers et empêche la mise
// en cache d'une page administrative. Respecte les autres directives CSP.
function allowUniversFrame(response) {
  const headers = new Headers(response.headers)
  const existing = headers.get('Content-Security-Policy') || ''
  const other = existing.split(';').map(x => x.trim())
    .filter(x => x && !/^frame-ancestors(?:\s|$)/i.test(x))
  other.push('frame-ancestors https://univers.nyxia.top')
  headers.set('Content-Security-Policy', other.join('; '))
  headers.delete('X-Frame-Options')
  headers.set('Cache-Control', 'private, no-store')
  headers.set('Vary', 'Cookie')
  return new Response(response.body, {status:response.status,statusText:response.statusText,headers})
}

const PREFIX = 'nyxia-game/media/'
const PUBLIC = '/game-media/'
const MAX_BYTES = 75 * 1024 * 1024
const FORMATS = Object.freeze({
  png: {mime:'image/png',kind:'image'},
  jpg: {mime:'image/jpeg',kind:'image'},
  jpeg:{mime:'image/jpeg',kind:'image'},
  webp:{mime:'image/webp',kind:'image'},
  gif: {mime:'image/gif',kind:'image'},
  mp3: {mime:'audio/mpeg',kind:'audio'},
  wav: {mime:'audio/wav',kind:'audio'},
  ogg: {mime:'audio/ogg',kind:'audio'},
  m4a: {mime:'audio/mp4',kind:'audio'},
  mp4: {mime:'video/mp4',kind:'video'},
  webm:{mime:'video/webm',kind:'video'}
})
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
const idValid = value => /^[a-zA-Z0-9_-]{1,120}$/.test(value)
const mediaHeaders = {'Cache-Control':'private, no-store','Cross-Origin-Resource-Policy':'same-origin','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Cookie, Authorization'}
const cookies = Object.freeze({team:'nyxgame_team',library:'nyxgame_library',host:'nyxgame_host',player:'nyxgame_player'})
function cookieValue(request,name){
  const raw=request.headers.get('Cookie')||''
  const item=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))
  if(!item)return ''
  try{return decodeURIComponent(item.slice(name.length+1))}catch(_){return ''}
}
function addCookie(response,name,value,age=7200){
  if(!response.ok||!value)return response
  const h=new Headers(response.headers)
  h.append('Set-Cookie',name+'='+encodeURIComponent(value)+'; Path=/game-media/; Max-Age='+age+'; HttpOnly; Secure; SameSite=Lax')
  h.set('Cache-Control','private, no-store')
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h})
}
async function sha256(value){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))
  return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')
}
function sessionProjectMatches(session,projectId){return session&&session.status!=='ended'&&session.sourceProjectId===projectId}
async function validLicense(env,hash,projectId){
  if(!hash||!env.LABO_STORE)return false
  const license=await env.LABO_STORE.get('game:license:'+hash,'json')
  if(!license||license.active===false||(license.expiresAt&&(!Number.isFinite(Date.parse(license.expiresAt))||Date.parse(license.expiresAt)<=Date.now())))return false
  for(const id of license.productIds||[]){
    const product=await env.LABO_STORE.get('game:product:'+id,'json')
    if(product&&product.active!==false&&product.sourceProjectId===projectId)return true
  }
  return false
}
async function mediaAllowed(request,env,ctx,projectId){
  // L'accès à une autre œuvre est refusé même avec un compte valide.
  if(!env.LABO_STORE)return false
  const bearer=request.headers.get('Authorization')||''
  const team=bearer.startsWith('Bearer ')?bearer.slice(7):cookieValue(request,cookies.team)
  if(team){
    const headers=new Headers();headers.set('Authorization','Bearer '+team);headers.set('Cookie',request.headers.get('Cookie')||'')
    if(await hasTeamAccess(new Request(request.url,{headers}),env,ctx))return true
  }
  const library=cookieValue(request,cookies.library)
  if(library){
    const auth=await env.LABO_STORE.get('game:library-session:'+await sha256(library),'json')
    if(auth&&await validLicense(env,auth.licenseHash,projectId))return true
  }
  for(const kind of ['host','player']){
    const raw=cookieValue(request,cookies[kind])
    const match=/^([A-Z0-9]{4,12}):([a-zA-Z0-9_-]{16,180})$/.exec(raw)
    if(!match)continue
    const session=await env.LABO_STORE.get('game:live:'+match[1],'json')
    if(!sessionProjectMatches(session,projectId))continue
    const matched=kind==='host'?session.hostToken===match[2]:(session.players||[]).some(x=>x.token===match[2])
    if(!matched)continue
    // Si cette soirée provient d'une vente, toute révocation/expiration de la licence
    // coupe aussi l'accès aux médias de l'animateur et des joueurs.
    if(session.ownerLicenseId){
      const licenseHash=await env.LABO_STORE.get('game:media:session-license:'+match[1])
      if(!licenseHash||!(await validLicense(env,licenseHash,projectId)))continue
    }
    return true
  }
  return false
}
async function authenticatedApiResponse(request,response,env){
  if(!response.ok)return response
  const url=new URL(request.url),path=url.pathname
  if(path==='/api/game/library/redeem'&&request.method==='POST'){
    const data=await response.clone().json().catch(()=>({}))
    if(data.ok&&data.libraryToken&&data.license)return addCookie(response,cookies.library,data.libraryToken,30*86400)
  }
  if(path==='/api/game/library/me'&&request.method==='GET'){
    const data=await response.clone().json().catch(()=>({}))
    const token=request.headers.get('X-NyXia-Library-Token')||''
    if(data.license&&token)return addCookie(response,cookies.library,token,30*86400)
  }
  if(path==='/api/game/library/sessions'&&request.method==='POST'&&env.LABO_STORE){
    const data=await response.clone().json().catch(()=>({}))
    const token=request.headers.get('X-NyXia-Library-Token')||''
    if(data.ok&&/^[A-Z0-9]{4,12}$/.test(data.code||'')&&token){
      const a=await env.LABO_STORE.get('game:library-session:'+await sha256(token),'json')
      if(a?.licenseHash)await env.LABO_STORE.put('game:media:session-license:'+data.code,a.licenseHash,{expirationTtl:72*3600})
    }
  }
  const host=/^\/api\/game\/host\/([A-Z0-9]{4,12})$/.exec(path)
  if(host&&request.method==='GET'){
    const data=await response.clone().json().catch(()=>({}))
    const token=request.headers.get('X-NyXia-Host-Token')||''
    if(data.session?.code===host[1]&&token)return addCookie(response,cookies.host,host[1]+':'+token,72*3600)
  }
  if(path==='/api/game/live/join'&&request.method==='POST'){
    const data=await response.clone().json().catch(()=>({}))
    if(data.ok&&data.state?.code&&data.playerToken)return addCookie(response,cookies.player,data.state.code+':'+data.playerToken,72*3600)
  }
  if(path==='/api/game/live/state'&&request.method==='GET'){
    const data=await response.clone().json().catch(()=>({}))
    const code=url.searchParams.get('code')||'',token=request.headers.get('X-NyXia-Player-Token')||''
    if(data.state?.code===code&&token)return addCookie(response,cookies.player,code+':'+token,72*3600)
  }
  return response
}

async function hasTeamAccess(request,env,ctx){
  const url=new URL('/api/atelier/health',request.url)
  const probe=new Request(url,{method:'GET',headers:request.headers})
  try {return (await existingWorker.fetch(probe,env,ctx)).ok}
  catch (_) {return false}
}

function sniffImage(ext,bytes){
  if(ext==='png') return bytes.length>=8 && bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10
  if(ext==='jpg'||ext==='jpeg')return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255
  if(ext==='gif')return bytes.length>=6 && String.fromCharCode(...bytes.slice(0,6)).startsWith('GIF8')
  if(ext==='webp')return bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'
  return true
}

async function upload(request,env,ctx){
  if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
  if(!env.MAPS)return json({error:'Stockage R2 MAPS absent. Aucun média transféré.'},503)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine non autorisée'},403)
  const stated=Number(request.headers.get('Content-Length')||0)
  if(stated>MAX_BYTES+1024*1024)return json({error:'Fichier trop volumineux (maximum 75 Mo).'},413)
  let form
  try {form=await request.formData()} catch(_) {return json({error:'Transfert multipart invalide'},400)}
  const file=form.get('file'),projectId=String(form.get('projectId')||''),assetId=String(form.get('assetId')||'')
  if(!idValid(projectId)||!idValid(assetId))return json({error:'Projet ou asset invalide'},400)
  if(!(file instanceof File)||!file.size)return json({error:'Fichier manquant ou vide'},400)
  if(file.size>MAX_BYTES)return json({error:'Fichier trop volumineux (maximum 75 Mo).'},413)
  const ext=String(file.name||'').split('.').pop().toLowerCase()
  const format=FORMATS[ext]
  if(!format)return json({error:'Format non compatible avec le navigateur : utilise PNG, JPG, WEBP, GIF, MP3, WAV, OGG, M4A, MP4 ou WEBM.'},415)
  const announced=String(file.type||'').toLowerCase()
  if(announced && announced!=='application/octet-stream' && announced!==format.mime && !(ext==='jpg'&&announced==='image/jpg') && !(ext==='m4a'&&announced==='audio/x-m4a') && !(ext==='wav'&&announced==='audio/x-wav')){
    return json({error:'Extension et type de fichier incompatibles'},415)
  }
  if(format.kind==='image' && !sniffImage(ext,new Uint8Array(await file.slice(0,16).arrayBuffer())))return json({error:'Image invalide'},415)
  // Vérifier l'existence du projet ET de l'asset dans le projet, sans faire confiance au navigateur.
  if(!env.LABO_STORE)return json({error:'Stockage des projets indisponible'},503)
  const project=await env.LABO_STORE.get('atelier:project:'+projectId,'json')
  if(!project||project.kind!=='nyxia-game')return json({error:'Projet NyXia Game introuvable'},404)
  let assets=[]
  try {assets=JSON.parse(project.data?.productionAssetsJson||'[]')}catch(_){}
  if(!Array.isArray(assets))assets=[]
  const asset=assets.find(a=>a&&a.id===assetId)
  if(!asset)return json({error:'Asset introuvable dans le registre du projet'},404)
  const expected=(asset.kind==='map'||asset.kind==='badge')?'image':asset.kind
  if(expected!==format.kind)return json({error:'Type de fichier incompatible avec cet asset'},415)
  const key=PREFIX+projectId+'/'+assetId+'/'+crypto.randomUUID()+'.'+ext
  try {
    await env.MAPS.put(key,file,{httpMetadata:{contentType:format.mime,cacheControl:'private, no-store',contentDisposition:'inline'},customMetadata:{projectId,assetId,originalName:String(file.name).slice(0,160)}})
    const stored=await env.MAPS.head(key)
    if(!stored||stored.size!==file.size)return json({error:'Le stockage n’a pas confirmé la bonne taille du fichier. Publication non validée.'},502)
  } catch(err) {return json({error:'Échec du stockage R2 : '+(err?.message||'erreur inconnue')},502)}
  return json({ok:true,url:PUBLIC+key.slice(PREFIX.length),mimeType:format.mime,bytes:file.size,kind:format.kind},201)
}

// Import d'une proposition gratuite validée par l'équipe ; jamais de requête vers
// une URL quelconque (prévention SSRF) et jamais de génération IA payante ici.
async function importFree(request,env,ctx){
  if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
  if(!env.MAPS||!env.LABO_STORE)return json({error:'R2 ou projets non raccordés'},503)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine interdite'},403)
  const body=await request.json().catch(()=>({}))
  const projectId=String(body.projectId||''),assetId=String(body.assetId||'')
  if(!idValid(projectId)||!idValid(assetId))return json({error:'Identifiant invalide'},400)
  const project=await env.LABO_STORE.get('atelier:project:'+projectId,'json')
  if(!project||project.kind!=='nyxia-game')return json({error:'Projet introuvable'},404)
  let list=[]
  try{list=JSON.parse(project.data?.productionAssetsJson||'[]')}catch(_){}
  const asset=Array.isArray(list)?list.find(a=>a?.id===assetId):null
  if(!asset)return json({error:'Média absent de ce projet'},404)
  const kind=['badge','map'].includes(asset.kind)?'image':asset.kind
  let remote
  try{remote=new URL(String(body.url||''))}catch(_){return json({error:'URL invalide'},400)}
  if(remote.protocol!=='https:'||remote.username||remote.password||remote.port||remote.searchParams.has('url'))return json({error:'Source refusée'},400)
  const hosts={image:['images.pexels.com','images.unsplash.com','cdn.pixabay.com','pixabay.com'],video:['videos.pexels.com','cdn.pixabay.com'],audio:['cdn.freesound.org']}
  if(!hosts[kind]?.includes(remote.hostname))return json({error:'Source gratuite non approuvée pour ce média'},403)
  const source=String(body.source||'')
  if((remote.hostname==='videos.pexels.com'||remote.hostname==='images.pexels.com')&&source!=='Pexels')return json({error:'Provenance Pexels requise'},400)
  if(kind==='image'&&remote.hostname==='images.unsplash.com'&&source!=='Unsplash')return json({error:'Provenance Unsplash requise'},400)
  if((remote.hostname==='cdn.pixabay.com'||remote.hostname==='pixabay.com')&&source!=='Pixabay')return json({error:'Provenance Pixabay requise'},400)
  if(remote.hostname==='pixabay.com'&&(kind!=='image'||!/^\/get\/[a-zA-Z0-9_\/-]+\.(?:jpg|jpeg|png|webp)$/.test(remote.pathname)))return json({error:'Chemin Pixabay refusé'},400)
  if(kind==='audio'){
    if(source!=='Freesound'||!/creativecommons\.org\/(?:publicdomain\/zero\/|licenses\/by\/)/i.test(String(body.license||''))||/licenses\/by-(?:nc|nd)/i.test(String(body.license||'')))return json({error:'Licence Freesound non compatible ou non vérifiée'},403)
  }
  const fetchInit={redirect:'manual',headers:{'Accept':kind+'/*'}}
  let upstream
  try{
    upstream=await fetch(remote.toString(),fetchInit)
    // Pixabay /get/ is the documented image URL and may redirect to their CDN.
    // Follow exactly one hop ONLY to cdn.pixabay.com; never follow arbitrary redirects.
    if(remote.hostname==='pixabay.com'&&[301,302,303,307,308].includes(upstream.status)){
      const location=upstream.headers.get('Location')||''
      const next=new URL(location,remote)
      if(next.protocol!=='https:'||next.hostname!=='cdn.pixabay.com'||next.port||next.username||next.password)return json({error:'Redirection Pixabay refusée'},403)
      upstream=await fetch(next.toString(),fetchInit)
    }
  }catch(_){return json({error:'Source gratuite temporairement inaccessible'},502)}
  if(!upstream.ok||upstream.status>=300)return json({error:'Téléchargement source refusé : '+upstream.status},502)
  const announced=Number(upstream.headers.get('content-length')||0)
  if(announced>MAX_BYTES)return json({error:'Fichier gratuit trop volumineux'},413)
  const mime=String(upstream.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()
  const types={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/mp4':'m4a','video/mp4':'mp4','video/webm':'webm'}
  const ext=types[mime]
  if(!ext||FORMATS[ext].kind!==kind)return json({error:'Format source incompatible avec '+kind},415)
  const reader=upstream.body?.getReader()
  if(!reader)return json({error:'Téléchargement sans corps'},502)
  const parts=[];let total=0
  try{
    while(true){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength
      if(total>MAX_BYTES){await reader.cancel();return json({error:'Fichier gratuit trop volumineux'},413)}
      parts.push(chunk.value)
    }
  }catch(_){return json({error:'Téléchargement interrompu'},502)}
  if(!total)return json({error:'Fichier gratuit vide'},502)
  const bytes=new Uint8Array(total);let offset=0
  for(const part of parts){bytes.set(part,offset);offset+=part.byteLength}
  if(kind==='image'&&!sniffImage(ext,bytes.slice(0,16)))return json({error:'Image source invalide'},415)
  const key=PREFIX+projectId+'/'+assetId+'/'+crypto.randomUUID()+'.'+ext
  await env.MAPS.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'private, no-store',contentDisposition:'inline'},customMetadata:{projectId,assetId,source:source.slice(0,30),license:String(body.license||'').slice(0,180)}})
  const stored=await env.MAPS.head(key)
  if(!stored||stored.size!==total)return json({error:'Stockage R2 non vérifié'},502)
  return json({ok:true,url:PUBLIC+key.slice(PREFIX.length),mimeType:mime,bytes:total,kind,source,license:String(body.license||''),credit:String(body.credit||'').slice(0,200)},201)
}

async function serveMedia(request,env,ctx){
  if(!env.MAPS)return new Response('Stockage indisponible',{status:503})
  const url=new URL(request.url)
  const relative=decodeURIComponent(url.pathname.slice(PUBLIC.length))
  if(!/^[a-zA-Z0-9_-]{1,120}\/[a-zA-Z0-9_-]{1,120}\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|mp3|wav|ogg|m4a|mp4|webm)$/.test(relative))return new Response('Introuvable',{status:404})
  const projectId=relative.split('/')[0]
  if(!(await mediaAllowed(request,env,ctx,projectId)))return new Response('Accès au jeu requis',{status:401,headers:mediaHeaders})
  const key=PREFIX+relative
  const meta=await env.MAPS.head(key)
  if(!meta)return new Response('Introuvable',{status:404})
  const ext=relative.split('.').pop(),format=FORMATS[ext]
  const size=meta.size
  const headers=new Headers({...mediaHeaders,'Content-Type':format.mime,'Accept-Ranges':'bytes','Content-Disposition':'inline','Content-Length':String(size)})
  if(request.method==='HEAD')return new Response(null,{status:200,headers})
  let range=null
  const raw=request.headers.get('Range')
  if(raw){
    const m=/^bytes=(\d*)-(\d*)$/.exec(raw)
    if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}})
    let start,end
    if(!m[1]){const suffix=Number(m[2]);start=Math.max(0,size-suffix);end=size-1}
    else {start=Number(m[1]);end=m[2]?Math.min(size-1,Number(m[2])):size-1}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start> end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}})
    range={offset:start,length:end-start+1}
    headers.set('Content-Length',String(range.length))
    headers.set('Content-Range',`bytes ${start}-${end}/${size}`)
  }
  const object=await env.MAPS.get(key,range?{range}:undefined)
  if(!object)return new Response('Introuvable',{status:404})
  return new Response(object.body,{status:range?206:200,headers})
}

// Prix officiels indicatifs septembre 2026, 1 MP pour les modèles au MP.
// Autorisation explicite par requête, jamais d'appel en lot, clés seulement côté Worker.
const ECONOMY_IMAGE_IDS = new Set(['flux/schnell','flux/dev','stable-diffusion-v3-medium','dall-e-3'])
async function economyImageGenerate(request,env,ctx){
  if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine interdite'},403)
  if(!env.LABO_STORE)return json({error:'Stockage projet indisponible'},503)
  if(!env.AIMLAPI_API_KEY)return json({error:'Secret AIMLAPI_API_KEY absent de ce Worker ; aucun coût engagé.'},503)
  const body=await request.json().catch(()=>({}))
  const {projectId,assetId}=body
  if(body.confirmed!==true)return json({error:'Confirmation explicite obligatoire avant un appel payant'},400)
  if(!idValid(projectId)||!idValid(assetId)||!ECONOMY_IMAGE_IDS.has(body.model))return json({error:'Projet, média ou modèle non autorisé'},400)
  const project=await env.LABO_STORE.get('atelier:project:'+projectId,'json')
  if(!project||project.kind!=='nyxia-game')return json({error:'Jeu introuvable'},404)
  let assets=[]
  try{assets=JSON.parse(project.data?.productionAssetsJson||'[]')}catch(_){}
  const asset=Array.isArray(assets)?assets.find(a=>a?.id===assetId):null
  if(!asset||!['image','badge','map'].includes(asset.kind))return json({error:'Image absente du cahier ou mauvais type'},404)
  if(asset.url||asset.localMediaId||asset.generatedPreviewUrl)return json({error:'Cette carte possède déjà un média ou un résultat à valider ; retire-le avant de créer une autre image'},409)
  const prompt=String(body.prompt||'').trim()
  if(prompt.length<40||prompt.length>4000||!prompt.includes(asset.code||asset.id))return json({error:'Prompt du média absent, trop long ou sans code de scène. Aucun appel lancé.'},400)
  if(!String(project.data?.imageBriefs||project.data?.worldBible||'').trim())return json({error:'Direction artistique absente : génération refusée'},400)
  const payload={model:body.model,prompt}
  if(body.model==='dall-e-3'){payload.n=1;payload.size='1024x1024';payload.quality='standard'}
  else {payload.num_images=1;payload.image_size={width:1024,height:768}}
  try{
    const res=await fetch('https://api.aimlapi.com/v1/images/generations',{method:'POST',headers:{Authorization:'Bearer '+env.AIMLAPI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)})
    const data=await res.json().catch(()=>({}))
    if(!res.ok)return json({error:typeof data.error?.message==='string'?data.error.message:'AIMLAPI : HTTP '+res.status},502)
    const images=(Array.isArray(data.data)?data.data:[]).map(x=>x?.url||(x?.b64_json?'data:image/png;base64,'+x.b64_json:null)).filter(Boolean).slice(0,1)
    if(!images.length)return json({error:'AIMLAPI n’a pas retourné une image exploitable ; ne relance pas sans consulter le compte fournisseur.'},502)
    return json({ok:true,images,model:body.model,count:1})
  }catch(_){return json({error:'AIMLAPI indisponible. Vérifie les factures avant toute nouvelle tentative.'},502)}
}

// Cloudflare Workers AI : un appel image par validation, réservé à l'équipe.
// Ne jamais renvoyer une URL publique du bucket ; la réponse est un aperçu JPEG base64.
async function cloudflareImageGenerate(request,env,ctx){
  if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine interdite'},403)
  if(!env.AI||typeof env.AI.run!=='function')return json({error:'Binding Workers AI absent : ajouter [ai] binding = "AI" dans wrangler.toml, puis redéployer.'},503)
  if(!env.LABO_STORE)return json({error:'Stockage projet indisponible'},503)
  const body=await request.json().catch(()=>({}))
  if(body.confirmed!==true)return json({error:'Confirmation explicite exigée : une requête consomme des neurones (facturable au-delà du quota).'},400)
  const {projectId,assetId}=body
  if(body.model!=='@cf/black-forest-labs/flux-1-schnell'||!idValid(projectId)||!idValid(assetId))return json({error:'Modèle ou média non autorisé'},400)
  const project=await env.LABO_STORE.get('atelier:project:'+projectId,'json')
  if(!project||project.kind!=='nyxia-game')return json({error:'Projet introuvable'},404)
  let assets=[]
  try{assets=JSON.parse(project.data?.productionAssetsJson||'[]')}catch(_){}
  const asset=Array.isArray(assets)?assets.find(a=>a?.id===assetId):null
  if(!asset||!['image','badge','map'].includes(asset.kind))return json({error:'Carte image absente du cahier'},404)
  if(asset.url||asset.localMediaId||asset.generatedPreviewUrl)return json({error:'Média existant : retire-le d’abord si tu veux créer une nouvelle image'},409)
  const style=String(project.data?.imageBriefs||project.data?.worldBible||'').trim()
  if(!style)return json({error:'Bible ou direction artistique absente : aucun appel IA'},400)
  const prompt=String(body.prompt||'').trim()
  if(prompt.length<30||prompt.length>2048||!prompt.includes(asset.code||asset.id))return json({error:'Prompt Cloudflare invalide, trop long ou sans identification du média'},400)
  if(!prompt.includes(String(project.title||'').trim()))return json({error:'Le prompt ne correspond pas au titre du projet ouvert'},400)
  try{
    const result=await env.AI.run('@cf/black-forest-labs/flux-1-schnell',{prompt,steps:4})
    if(typeof result?.image!=='string'||!/^[A-Za-z0-9+/=]+$/.test(result.image)||result.image.length<100)return json({error:'Workers AI n’a pas retourné une image JPEG exploitable. Vérifie la consommation avant de relancer.'},502)
    return json({ok:true,images:['data:image/jpeg;base64,'+result.image],model:body.model,count:1,mimeType:'image/jpeg'})
  }catch(err){return json({error:'Workers AI : '+String(err?.message||'échec')+'. Vérifie la consommation avant toute nouvelle tentative.'},502)}
}

// Pixabay déjà configuré dans le compte peut être interrogé par la même équipe,
// côté Worker seulement : ne jamais envoyer la clé au navigateur ni dans la KV projet.
async function pixabaySearch(request,env,ctx){
  if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
  const key=env.PIXABAY_KEY||env.PIXABAY_API_KEY||env.Pixabay_KEY
  if(!key)return json({error:'Secret Pixabay absent du Worker (PIXABAY_KEY ou PIXABAY_API_KEY). La recherche Pexels reste disponible.'},503)
  const url=new URL(request.url),kind=url.searchParams.get('kind')||'image',q=(url.searchParams.get('q')||'').trim()
  if(!['image','video'].includes(kind)||!q||q.length>100)return json({error:'Recherche Pixabay invalide (1 à 100 caractères).'},400)
  // Repeated human requests can reuse one cached answer for 24h, without cluttering project KV.
  const cache=typeof caches!=='undefined'&&caches.default?caches.default:null
  const cacheKey=new Request('https://nyxia-pixabay-cache.invalid/'+kind+'?q='+encodeURIComponent(q.toLowerCase()))
  if(cache){const stored=await cache.match(cacheKey);if(stored)return stored}
  const endpoint=new URL(kind==='video'?'https://pixabay.com/api/videos/':'https://pixabay.com/api/')
  endpoint.searchParams.set('key',key);endpoint.searchParams.set('q',q);endpoint.searchParams.set('per_page','6');endpoint.searchParams.set('safesearch','true')
  let response
  try{response=await fetch(endpoint.toString(),{headers:{Accept:'application/json'},redirect:'error'})}
  catch(_){return json({error:'Pixabay inaccessible temporairement.'},502)}
  if(!response.ok)return json({error:'Pixabay : erreur '+response.status},response.status===429?429:502)
  const payload=await response.json().catch(()=>null)
  if(!payload||!Array.isArray(payload.hits))return json({error:'Réponse Pixabay illisible'},502)
  // URLs are validated by the import endpoint itself; only CDN Pixabay may be stored.
  const valid=(url,isImage=false)=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.port&&(u.hostname==='cdn.pixabay.com'||(isImage&&u.hostname==='pixabay.com'&&/^\/get\//.test(u.pathname)))}catch(_){return false}}
  let result
  if(kind==='image'){
    result={photos:payload.hits.map(hit=>({full:hit.largeImageURL||hit.webformatURL,thumb:hit.webformatURL||hit.previewURL,url:hit.pageURL,photographer:hit.user,id:hit.id})).filter(hit=>valid(hit.full,true)&&valid(hit.thumb,true))}
  }else{
    result={videos:payload.hits.map(hit=>{const v=hit.videos?.medium||hit.videos?.small||hit.videos?.tiny||{};return {full:v.url,preview:v.url,thumbnail:v.thumbnail,url:hit.pageURL,photographer:hit.user,id:hit.id}}).filter(hit=>valid(hit.full))}
  }
  const output=json(result)
  if(cache){const headers=new Headers(output.headers);headers.set('Cache-Control','public, max-age=86400');await cache.put(cacheKey,new Response(output.clone().body,{headers})).catch(()=>{})}
  return output
}

export default {
  async fetch(request,env,ctx){
    // Fail closed if the ecosystem's common KV is not bound.
    if (!env.CASHFLOW_KV) return json({error:'KV commune Univers non configurée'},503)
    const central = env.CASHFLOW_KV
    env = {...env, LABO_STORE:laboStore(central, env.LABO_LEGACY_KV)}
    const path=new URL(request.url).pathname
    // Le Labo est ouvert depuis Univers ; ses pages administratives ne sont
    // pas accessibles avec un ancien mot de passe ou un ancien jeton seul.
    if (path === '/' || path === '/index.html' || path === '/login')
      return Response.redirect(new URL('/login.html',request.url),302)
    if (path === '/login.html')
      return allowUniversFrame(await existingWorker.fetch(request,env,ctx))
    if (['dashboard','atelier-equipe','audiobook-studio', 'wan-image','wan-video']
        .some(name => path === '/' + name || path === '/' + name + '.html' || path === '/' + name + '/')) {
      if (!(await universAccess(request,central)))
        return Response.redirect('https://univers.nyxia.top/',302)
      return allowUniversFrame(await existingWorker.fetch(request,env,ctx))
    }
    if(path.startsWith(PUBLIC)) {
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Méthode interdite',{status:405})
      try{return await serveMedia(request,env,ctx)}catch(_){return new Response('Média indisponible',{status:503})}
    }
    if(path==='/api/game/media/pixabay-search' && request.method==='GET')return pixabaySearch(request,env,ctx)
    if(path==='/api/game/media/health' && request.method==='GET'){
      if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
      const bearer=request.headers.get('Authorization')||''
      const result=json({ok:!!env.MAPS,storage:env.MAPS?'R2 privé / nyxia-game/media/':'absent',privateGateway:true})
      return bearer.startsWith('Bearer ')?addCookie(result,cookies.team,bearer.slice(7),7200):result
    }
    if(path==='/api/game/media/image/cloudflare' && request.method==='POST')return cloudflareImageGenerate(request,env,ctx)
    if(path==='/api/game/media/image/generate' && request.method==='POST')return economyImageGenerate(request,env,ctx)
    if(path==='/api/game/media/upload' && request.method==='POST')return upload(request,env,ctx)
    if(path==='/api/game/media/import-free' && request.method==='POST')return importFree(request,env,ctx)
    const response=await existingWorker.fetch(request,env,ctx)
    if(path.startsWith('/api/game/'))return authenticatedApiResponse(request,response,env)
    return response
  }
}
