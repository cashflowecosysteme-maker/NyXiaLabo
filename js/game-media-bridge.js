/**
 * NyXia Game — livraison R2 isolée du routeur existant.
 * Ne change aucune route existante : TTS, Cartographie, jeux et authentification
 * continuent d'être servis par js/tts-bridge.js.
 *
 * Médias publiés sous une URL opaque, mais NON protégés par DRM : toute personne
 * connaissant l'URL peut télécharger le fichier. Ne pas y placer de secrets.
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
    await env.MAPS.put(key,file,{httpMetadata:{contentType:format.mime,cacheControl:'public, max-age=3600',contentDisposition:'inline'},customMetadata:{projectId,assetId,originalName:String(file.name).slice(0,160)}})
    const stored=await env.MAPS.head(key)
    if(!stored||stored.size!==file.size)return json({error:'Le stockage n’a pas confirmé la bonne taille du fichier. Publication non validée.'},502)
  } catch(err) {return json({error:'Échec du stockage R2 : '+(err?.message||'erreur inconnue')},502)}
  return json({ok:true,url:PUBLIC+key.slice(PREFIX.length),mimeType:format.mime,bytes:file.size,kind:format.kind},201)
}

async function serveMedia(request,env){
  if(!env.MAPS)return new Response('Stockage indisponible',{status:503})
  const url=new URL(request.url)
  const relative=decodeURIComponent(url.pathname.slice(PUBLIC.length))
  if(!/^[a-zA-Z0-9_-]{1,120}\/[a-zA-Z0-9_-]{1,120}\/[0-9a-f-]{36}\.(png|jpe?g|webp|gif|mp3|wav|ogg|m4a|mp4|webm)$/.test(relative))return new Response('Introuvable',{status:404})
  const key=PREFIX+relative
  const meta=await env.MAPS.head(key)
  if(!meta)return new Response('Introuvable',{status:404})
  const ext=relative.split('.').pop(),format=FORMATS[ext]
  const size=meta.size
  const headers=new Headers({'Content-Type':format.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=3600','Accept-Ranges':'bytes','Content-Disposition':'inline','Content-Length':String(size)})
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
      try{return await serveMedia(request,env)}catch(_){return new Response('Média indisponible',{status:503})}
    }
    if(path==='/api/game/media/health' && request.method==='GET'){
      if(!(await hasTeamAccess(request,env,ctx)))return json({error:'Accès équipe requis'},401)
      return json({ok:!!env.MAPS,storage:env.MAPS?'R2 MAPS / nyxia-game/media/':'absent'})
    }
    if(path==='/api/game/media/upload' && request.method==='POST')return upload(request,env,ctx)
    return existingWorker.fetch(request,env,ctx)
  }
}
