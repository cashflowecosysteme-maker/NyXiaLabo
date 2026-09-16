/*
 * NyXiaLabo — raccordement TTS coté serveur, sans exposer les secrets.
 * Ne remplace pas labo-router.js et protège toutes les routes diagnostiques.
 */
import router from '../labo-router.js'

const NAMES = [
  'GOOGLE_TTS_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_TTS_CLIENT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_TTS_PRIVATE_KEY', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  'GOOGLE_TTS_ACCESS_TOKEN',
  'GOOGLE_TTS_API_KEY', 'GOOGLE_CLOUD_TTS_API_KEY', 'GOOGLE_TEXT_TO_SPEECH_API_KEY', 'GOOGLE_API_KEY',
  'GoogleText-to-Speech_', 'GoogleText-to-Speech', 'GOOGLE_TEXT_TO_SPEECH'
]
const KEY_RE = /^AIza[A-Za-z0-9_-]{20,}$/
const relevant = k => /google.*(?:tts|text.?to.?speech)|tts.*google/i.test(k)
const present = v => typeof v === 'string' ? !!v.trim() : v != null
const safeName = k => String(k).slice(0, 100)
const response = (body, status=200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})
const asText = v => typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
const isAccount = v => !!(v && typeof v === 'object' && typeof v.client_email === 'string' && typeof v.private_key === 'string' && v.client_email && v.private_key.includes('PRIVATE KEY'))

function classify(env) {
  // Clés API explicites, y compris le nom déjà utilisé par l'environnement Cloudflare.
  // Une variable de compte de service mal remplie ne doit pas masquer une clé API valide.
  // En cas de plusieurs valeurs distinctes, ne choisir aucun secret silencieusement.
  const apiNames=['GOOGLE_TTS_API_KEY','GOOGLE_CLOUD_TTS_API_KEY','GOOGLE_TEXT_TO_SPEECH_API_KEY','GOOGLE_API_KEY']
  const validApiNames=apiNames.filter(name=>KEY_RE.test(asText(env[name])))
  if(validApiNames.length) {
    const distinct=new Set(validApiNames.map(name=>asText(env[name])))
    if(distinct.size>1) return {env,ready:false,kind:'none',code:'api-keys-ambiguous',name:'',message:`Plusieurs clés API Google différentes sont disponibles (${validApiNames.join(', ')}). Sélection explicite nécessaire ; aucun secret n'a été modifié.`}
    const name=validApiNames[0]
    return {env,ready:true,kind:'api-key',code:'api-key-detected',name,key:asText(env[name]),message:`Clé API Google détectée dans ${name}. Le test vérifiera l'accès réel à la liste des voix.`}
  }

  // En l'absence de clé API valide, essayer les identifiants du compte de service.
  for (const name of ['GOOGLE_TTS_SERVICE_ACCOUNT_JSON','GOOGLE_SERVICE_ACCOUNT_JSON']) {
    const value=env[name]
    if (!present(value)) continue
    try {
      const parsed=typeof value==='string'?JSON.parse(value):value
      if (isAccount(parsed)) return {env,ready:true,kind:'oauth',code:'service-account',name,message:`Compte de service détecté dans ${name} ; test Google requis.`}
    } catch(_) {}
    return {env,ready:false,kind:'none',code:'account-json-invalid',name,message:`${name} est présent mais n'est pas un JSON de compte de service utilisable (client_email et private_key).`}
  }
  const email=asText(env.GOOGLE_TTS_CLIENT_EMAIL||env.GOOGLE_SERVICE_ACCOUNT_EMAIL)
  const privateKey=asText(env.GOOGLE_TTS_PRIVATE_KEY||env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)
  if (email && privateKey) return {env,ready:true,kind:'oauth',code:'service-fields',name:'GOOGLE_TTS_CLIENT_EMAIL + GOOGLE_TTS_PRIVATE_KEY',message:'Compte de service détecté en champs séparés ; test Google requis.'}
  if (email || privateKey) return {env,ready:false,kind:'none',code:'service-fields-incomplete',name:'champs de compte de service',message:'Compte de service incomplet : il faut le courriel ET la clé privée dans les secrets du Worker nyxialabo.'}
  if (present(env.GOOGLE_TTS_ACCESS_TOKEN)) return {env,ready:true,kind:'oauth',code:'access-token',name:'GOOGLE_TTS_ACCESS_TOKEN',message:'Jeton Google présent (temporaire) ; test requis.'}

  // Chercher les noms explicitement pris en charge, puis une seule variante non ambiguë.
  const keys=['GOOGLE_TTS_API_KEY','GOOGLE_CLOUD_TTS_API_KEY','GOOGLE_TEXT_TO_SPEECH_API_KEY','GoogleText-to-Speech_','GoogleText-to-Speech','GOOGLE_TEXT_TO_SPEECH']
  const discovered=Object.keys(env).filter(relevant).filter(k=>present(env[k]))
  for (const k of discovered) if (!keys.includes(k) && !NAMES.includes(k)) keys.push(k)
  const matches=keys.filter(k=>present(env[k]))
  if (!matches.length) return {env,ready:false,kind:'none',code:'secret-absent',name:'',message:'Aucun secret TTS reconnu dans le Worker nyxialabo. Le compte Google peut exister sans que ce Worker ait accès à sa clé.'}
  if (matches.length>1) {
    const valid=matches.filter(k=>KEY_RE.test(asText(env[k])) || /^ya29\./.test(asText(env[k])))
    if (valid.length!==1) return {env,ready:false,kind:'none',code:'secrets-ambigus',name:'',message:`Plusieurs noms TTS sont présents (${matches.map(safeName).join(', ')}). Le code n'en choisit aucun au hasard.`}
    matches.splice(0,matches.length,valid[0])
  }
  const name=matches[0], value=asText(env[name])
  if (KEY_RE.test(value)) return {env,ready:true,kind:'api-key',code:'api-key-detected',name,key:value,message:`Clé API Google détectée dans ${safeName(name)}. Le test appellera uniquement la liste des voix.`}
  if (/^ya29\./.test(value)) return {env:{...env,GOOGLE_TTS_ACCESS_TOKEN:value},ready:true,kind:'oauth',code:'legacy-access-token',name,message:`Jeton temporaire reconnu dans ${safeName(name)} ; test requis.`}
  let obj
  try {obj=JSON.parse(value)} catch (_) {obj=null}
  if (isAccount(obj)) return {env:{...env,GOOGLE_TTS_SERVICE_ACCOUNT_JSON:value},ready:true,kind:'oauth',code:'legacy-service-account',name,message:`Compte de service détecté dans ${safeName(name)} ; test requis.`}
  if (value.includes('.apps.googleusercontent.com') || obj?.client_id || obj?.web?.client_id || obj?.installed?.client_id) return {env,ready:false,kind:'none',code:'oauth-client-id',name,message:`${safeName(name)} contient un ID client OAuth, insuffisant seul pour une requête serveur. La création du compte Google ne fournit pas automatiquement le jeton nécessaire.`}
  return {env,ready:false,kind:'none',code:'secret-format-inconnu',name,message:`Un secret nommé ${safeName(name)} est présent, mais son format ne correspond ni à une clé API Google, ni à un compte de service, ni à un jeton d'accès.`}
}

function authenticatedGet(request,path) {
  return new Request(new URL(path,request.url),{method:'GET',headers:request.headers})
}
async function authorize(request,env,ctx) {
  const res=await router.fetch(authenticatedGet(request,'/api/atelier/health'),env,ctx)
  return res.ok
}
function googleIssue(status) {
  if(status===400) return 'Google refuse la requête (400). Vérifier les paramètres de la voix.'
  if(status===401) return 'Google refuse les identifiants (401).'
  if(status===403) return 'Google refuse l’accès (403) : restriction de clé, API non activée, droits ou facturation à examiner dans le projet Google.'
  if(status===429) return 'Google indique une limite de requêtes (429).'
  return `Réponse de Google : HTTP ${status}.`
}
async function voicesWithKey(key, languageCode='fr-FR') {
  const url=new URL('https://texttospeech.googleapis.com/v1/voices')
  url.searchParams.set('languageCode',languageCode.slice(0,20))
  let google
  try {google=await fetch(url,{headers:{'x-goog-api-key':key}})}
  catch (_) {return response({error:'Impossible de joindre Google TTS ; vérifier le réseau du Worker.'},503)}
  if (!google.ok) return response({error:googleIssue(google.status)},google.status)
  const body=await google.json().catch(()=>({}))
  const voices=(Array.isArray(body.voices)?body.voices:[])
    .filter(v=>Array.isArray(v.languageCodes)&&v.languageCodes.some(c=>c.toLowerCase().startsWith('fr')))
    .map(v=>({name:v.name,languageCodes:v.languageCodes,ssmlGender:v.ssmlGender,naturalSampleRateHertz:v.naturalSampleRateHertz}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'fr'))
  return response({voices})
}
async function synthesizeWithKey(key,body) {
  const text=String(body?.text||'')
  if(!text.trim()) return response({error:'Texte requis'},400)
  const bytes=new TextEncoder().encode(text).byteLength
  if(bytes>4500) return response({error:`Texte trop long (${bytes} octets ; limite 4500).`},413)
  const languageCode=asText(body.languageCode||'fr-FR').slice(0,20)||'fr-FR'
  const name=asText(body.voiceName).slice(0,120)
  const speed=Math.max(.25,Math.min(4,Number(body.speakingRate)||1))
  const pitch=Math.max(-20,Math.min(20,Number(body.pitch)||0))
  let google
  try {
    google=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{
      method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json; charset=utf-8'},
      body:JSON.stringify({input:{text},voice:name?{languageCode,name}:{languageCode},audioConfig:{audioEncoding:'MP3',speakingRate:speed,pitch}})
    })
  } catch(_) {return response({error:'Impossible de joindre Google TTS ; vérifier le réseau du Worker.'},503)}
  if(!google.ok) return response({error:googleIssue(google.status)},google.status)
  const result=await google.json().catch(()=>({}))
  if (!result.audioContent) return response({error:'Réponse Google sans audio.'},502)
  return response({audioContent:result.audioContent,mimeType:'audio/mpeg',voiceName:name||null,languageCode,speakingRate:speed,pitch})
}

export default {
  async fetch(request,env,ctx) {
    const path=new URL(request.url).pathname
    if(!path.startsWith('/api/atelier/')) return router.fetch(request,env,ctx)
    const cfg=classify(env)
    if(request.method==='GET' && path==='/api/atelier/health') {
      const original=await router.fetch(request,cfg.env,ctx)
      if(!original.ok) return original
      const data=await original.json().catch(()=>({}))
      return response({...data,googleTts:cfg.ready,ttsCredentialType:cfg.code,ttsCredentialName:cfg.name,ttsMessage:cfg.message,ttsVerified:false})
    }
    if(request.method==='GET' && path==='/api/atelier/tts/diagnostic') {
      if(!(await authorize(request,cfg.env,ctx))) return response({error:'Non autorisé'},401)
      if(!cfg.ready) return response({connected:false,code:cfg.code,message:cfg.message})
      const test=cfg.kind==='api-key'?await voicesWithKey(cfg.key):await router.fetch(authenticatedGet(request,'/api/atelier/tts/voices?languageCode=fr-FR'),cfg.env,ctx)
      if(!test.ok) return response({connected:false,code:`google-http-${test.status}`,message:googleIssue(test.status)+' '+cfg.message})
      const data=await test.json().catch(()=>({}))
      if(!Array.isArray(data.voices)||!data.voices.length) return response({connected:false,code:'no-french-voices',message:'Google a répondu, mais aucune voix française n’a été trouvée.'})
      return response({connected:true,code:'verified',voiceCount:data.voices.length,message:`Connexion Google TTS confirmée : ${data.voices.length} voix françaises disponibles. Source : ${safeName(cfg.name)}.`})
    }
    if(cfg.kind==='api-key' && ((request.method==='GET' && path==='/api/atelier/tts/voices') || (request.method==='POST' && path==='/api/atelier/tts'))) {
      if(!(await authorize(request,cfg.env,ctx))) return response({error:'Non autorisé'},401)
      if(request.method==='GET') return voicesWithKey(cfg.key,new URL(request.url).searchParams.get('languageCode')||'fr-FR')
      return synthesizeWithKey(cfg.key,await request.json().catch(()=>({})))
    }
    return router.fetch(request,cfg.env,ctx)
  }
}
