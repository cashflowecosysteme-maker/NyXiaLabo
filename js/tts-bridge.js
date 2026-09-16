/*
 * NyXiaLabo — adaptateur de compatibilité Google TTS.
 * Ne remplace PAS labo-router.js : toutes les routes sont déléguées.
 * N'expose jamais le contenu des secrets.
 */
import router from './labo-router.js'

const legacyName = 'GoogleText-to-Speech_'
const JSON_NAMES = ['GOOGLE_TTS_SERVICE_ACCOUNT_JSON','GOOGLE_SERVICE_ACCOUNT_JSON']
const HAS_SPLIT = env => Boolean((env.GOOGLE_TTS_CLIENT_EMAIL || env.GOOGLE_SERVICE_ACCOUNT_EMAIL) &&
  (env.GOOGLE_TTS_PRIVATE_KEY || env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY))
const hasAccessToken = env => Boolean(env.GOOGLE_TTS_ACCESS_TOKEN)

function classify(env) {
  // Respecter d'abord les identifiants modernes existants.
  for (const key of JSON_NAMES) {
    const raw = env[key]
    if (!raw) continue
    try {
      const json = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (json?.client_email && json?.private_key) {
        return {env, ready:true, code:'account', message:'Compte de service Google reconnu ; vérification de connexion requise.'}
      }
    } catch(_) {}
  }
  if (HAS_SPLIT(env)) return {env, ready:true, code:'account', message:'Champs du compte de service reconnus ; vérification requise.'}
  if (hasAccessToken(env)) return {env, ready:true, code:'temporary', message:'Jeton temporaire repéré ; il peut expirer. Test requis.'}

  const raw = env[legacyName]
  if (raw == null || String(raw).trim() === '') {
    return {env, ready:false, code:'missing', message:'Aucun compte de service Google reconnu dans les secrets de ce Worker.'}
  }
  const value=String(raw).trim()
  if (value.includes('.apps.googleusercontent.com') && !value.startsWith('{')) {
    return {env, ready:false, code:'oauth-client-id', message:'GoogleText-to-Speech_ contient un ID client OAuth : ce n’est pas un compte de service et il ne suffit pas pour le TTS.'}
  }
  if (/^AIza[A-Za-z0-9_-]+$/.test(value)) {
    return {env, ready:false, code:'api-key', message:'GoogleText-to-Speech_ contient une clé API. Le routeur actuel attend un compte de service OAuth, pas cette clé.'}
  }
  if (/^ya29\./.test(value)) {
    return {env:{...env,GOOGLE_TTS_ACCESS_TOKEN:value}, ready:true, code:'temporary', message:'Jeton temporaire reconnu dans GoogleText-to-Speech_ ; test requis et expiration possible.'}
  }
  try {
    const parsed=JSON.parse(value)
    if (parsed?.client_email && parsed?.private_key) {
      return {env:{...env,GOOGLE_TTS_SERVICE_ACCOUNT_JSON:value}, ready:true, code:'legacy-account',message:'Compte de service dans GoogleText-to-Speech_ reconnu ; test de connexion requis.'}
    }
    if (parsed?.web?.client_id || parsed?.installed?.client_id || parsed?.client_id) {
      return {env,ready:false,code:'oauth-client-json',message:'GoogleText-to-Speech_ contient des identifiants de client OAuth, pas un compte de service. Il faut un JSON avec client_email et private_key.'}
    }
    return {env,ready:false,code:'invalid-json',message:'Le JSON GoogleText-to-Speech_ ne contient pas client_email et private_key.'}
  } catch(_) {
    return {env,ready:false,code:'invalid-value',message:'Le secret GoogleText-to-Speech_ n’est pas un JSON de compte de service valide.'}
  }
}

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}

function protectedRequest(request,path){
  const url=new URL(path,request.url)
  return new Request(url.toString(),{method:'GET',headers:request.headers})
}

function googleFailure(http){
  if(http===401) return 'Google refuse l’authentification : identifiants invalides ou expirés.'
  if(http===403) return 'Google refuse l’accès : vérifier que Text-to-Speech est activé et que le compte est autorisé.'
  if(http===429) return 'Google signale une limite/quota de requêtes.'
  if(http===503) return 'Connexion Google TTS indisponible ou identifiants mal formés : vérifier le compte de service.'
  return 'Test Google TTS échoué (HTTP '+http+'). Vérifier les identifiants et la configuration du projet.'
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url)
    const cfg=classify(env)
    if(request.method==='GET' && url.pathname==='/api/atelier/health'){
      const original=await router.fetch(request,cfg.env,ctx)
      if(!original.ok) return original
      const body=await original.json().catch(()=>({ok:true}))
      return json({...body,googleTts:cfg.ready,ttsCredentialType:cfg.code,ttsMessage:cfg.message,ttsVerified:false})
    }
    if(request.method==='GET' && url.pathname==='/api/atelier/tts/diagnostic'){
      // Authentification identique au routeur principal : aucun diagnostic public.
      const auth=await router.fetch(protectedRequest(request,'/api/atelier/health'),cfg.env,ctx)
      if(!auth.ok) return json({error:'Non autorisé'},auth.status)
      if(!cfg.ready) return json({connected:false,code:cfg.code,message:cfg.message})
      const voices=await router.fetch(protectedRequest(request,'/api/atelier/tts/voices?languageCode=fr-FR'),cfg.env,ctx)
      if(!voices.ok) return json({connected:false,code:'google-http-'+voices.status,message:googleFailure(voices.status)})
      const data=await voices.json().catch(()=>({}))
      if(!Array.isArray(data.voices)||!data.voices.length) return json({connected:false,code:'no-french-voices',message:'Google a répondu, mais aucune voix française n’a été trouvée.'})
      return json({connected:true,code:'verified',voiceCount:data.voices.length,message:'Connexion Google TTS confirmée : '+data.voices.length+' voix françaises disponibles.'})
    }
    return router.fetch(request,cfg.env,ctx)
  }
}
