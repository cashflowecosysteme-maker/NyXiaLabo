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
  if(!hash||!env.HUB_CONFIG)return false
  const license=await env.HUB_CONFIG.get('game:license:'+hash,'json')
  if(!license||license.active===false||(license.expiresAt&&(!Number.isFinite(Date.parse(license.expiresAt))||Date.parse(license.expiresAt)<=Date.now())))return false
  for(const id of license.productIds||[]){
    const product=await env.HUB_CONFIG.get('game:product:'+id,'json')
    if(product&&product.active!==false&&product.sourceProjectId===projectId)return true
  }
  return false
}
async function mediaAllowed(request,env,ctx,projectId){
  // L'accès à une autre œuvre est refusé même avec un compte valide.
  if(!env.HUB_CONFIG)return false
  const bearer=request.headers.get('Authorization')||''
  const team=bearer.startsWith('Bearer ')?bearer.slice(7):cookieValue(request,cookies.team)
  if(team){
    const headers=new Headers();headers.set('Authorization','Bearer '+team)
    if(await hasTeamAccess(new Request(request.url,{headers}),env,ctx))return true
  }
  const library=cookieValue(request,cookies.library)
  if(library){
    const auth=await env.HUB_CONFIG.get('game:library-session:'+await sha256(library),'json')
    if(auth&&await validLicense(env,auth.licenseHash,projectId))return true
  }
  for(const kind of ['host','player']){
    const raw=cookieValue(request,cookies[kind])
    const match=/^([A-Z0-9]{4,12}):([a-zA-Z0-9_-]{16,180})$/.exec(raw)
    if(!match)continue
    const session=await env.HUB_CONFIG.get('game:live:'+match[1],'json')
    if(!sessionProjectMatches(session,projectId))continue
    const matched=kind==='host'?session.hostToken===match[2]:(session.players||[]).some(x=>x.token===match[2])
    if(!matched)continue
    // Si cette soirée provient d'une vente, toute révocation/expiration de la licence
    // coupe aussi l'accès aux médias de l'animateur et des joueurs.
    if(session.ownerLicenseId){
      const licenseHash=await env.HUB_CONFIG.get('game:media:session-license:'+match[1])
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
  if(path==='/api/game/library/sessions'&&request.method==='POST'&&env.HUB_CONFIG){
    const data=await response.clone().json().catch(()=>({}))
    const token=request.headers.get('X-NyXia-Library-Token')||''
    if(data.ok&&/^[A-Z0-9]{4,12}$/.test(data.code||'')&&token){
      const a=await env.HUB_CONFIG.get('game:library-session:'+await sha256(token),'json')
      if(a?.licenseHash)await env.HUB_CONFIG.put('game:media:session-license:'+data.code,a.licenseHash,{expirationTtl:72*3600})
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
  if(!env.HUB_CONFIG)return json({error:'Stockage des projets indisponible'},503)
  const project=await env.HUB_CONFIG.get('atelier:project:'+projectId,'json')
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
  if(!env.MAPS||!env.HUB_CONFIG)return json({error:'R2 ou projets non raccordés'},503)
  const origin=request.headers.get('Origin')
  if(origin&&origin!==new URL(request.url).origin)return json({error:'Origine interdite'},403)
  const body=await request.json().catch(()=>({}))
  const projectId=String(body.projectId||''),assetId=String(body.assetId||'')
  if(!idValid(projectId)||!idValid(assetId))return json({error:'Identifiant invalide'},400)
  const project=await env.HUB_CONFIG.get('atelier:project:'+projectId,'json')
  if(!project||project.kind!=='nyxia-game')return json({error:'Projet introuvable'},404)
  let list=[]
  try{list=JSON.parse(project.data?.productionAssetsJson||'[]')}catch(_){}
  const asset=Array.isArray(list)?list.find(a=>a?.id===assetId):null
  if(!asset)return json({error:'Média absent de ce projet'},404)
  const kind=['badge','map'].includes(asset.kind)?'image':asset.kind
  let remote
  try{remote=new URL(String(body.url||''))}catch(_){return json({error:'URL invalide'},400)}
  if(remote.protocol!=='https:'||remote.username||remote.password||remote.port||remote.searchParams.has('url'))return json({error:'Source refusée'},400)
  const hosts={image:['images.pexels.com','images.unsplash.com'],video:['videos.pexels.com'],audio:['cdn.freesound.org']}
  if(!hosts[kind]?.includes(remote.hostname))return json({error:'Source gratuite non approuvée pour ce média'},403)
  const source=String(body.source||'')
  if((kind==='video'||(kind==='image'&&remote.hostname==='images.pexels.com'))&&source!=='Pexels')return json({error:'Provenance Pexels requise'},400)
  if(kind==='image'&&remote.hostname==='images.unsplash.com'&&source!=='Unsplash')return json({error:'Provenance Unsplash requise'},400)
  if(kind==='audio'){
    if(source!=='Freesound'||!/creativecommons\.org\/(?:publicdomain\/zero\/|licenses\/by\/)/i.test(String(body.license||''))||/licenses\/by-(?:nc|nd)/i.test(String(body.license||'')))return json({error:'Licence Freesound non compatible ou non vérifiée'},403)
  }
  const fetchInit={redirect:'manual',headers:{'Accept':kind+'/*'}}
  let upstream
  try{upstream=await fetch(remote.toString(),fetchInit)}catch(_){return json({error:'Source gratuite temporairement inaccessible'},502)}
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

export default {
  async fetch(request,env,ctx){
    const path=new URL(request.url).pathname
    if(path.startsWith(PUBLIC)) {
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Méthode interdite',{status:405})
      try{return await serveMedia(request,env,ctx)}catch(_){return new Response('Média indisponible',{status:503})}
    }
    if(path==='/api/game/media/health' && request.method==='GET'){
      if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
      const bearer=request.headers.get('Authorization')||''
      const result=json({ok:!!env.MAPS,storage:env.MAPS?'R2 privé / nyxia-game/media/':'absent',privateGateway:true})
      return bearer.startsWith('Bearer ')?addCookie(result,cookies.team,bearer.slice(7),7200):result
    }
    if(path==='/api/game/media/upload' && request.method==='POST')return upload(request,env,ctx)
    if(path==='/api/game/media/import-free' && request.method==='POST')return importFree(request,env,ctx)
    const response=await existingWorker.fetch(request,env,ctx)
    if(path.startsWith('/api/game/'))return authenticatedApiResponse(request,response,env)
    return response
  }
}
