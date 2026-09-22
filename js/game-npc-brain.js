/**
 * NyXia Game: cerveaux par jeu / personnage, sur CASHFLOW_KV et Vectorize existants.
 * Ce module est importé par le routeur Atelier authentifié. Aucun stockage parallèle.
 * Les namespaces sont dérivés UNIQUEMENT des identifiants du projet vérifiés serveur.
 */
const VALID_ID = /^[a-zA-Z0-9_-]{1,120}$/
const MAX_TEXT = 30000
const MAX_DOCS = 40
const encoder = new TextEncoder()
const reply = (body, status=200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})
function safe(value, max=180) { return String(value == null ? '' : value).trim().slice(0,max) }
async function digest(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('')
}
export async function npcNamespace(gameId, npcId) {
  if (!VALID_ID.test(gameId)||!VALID_ID.test(npcId)) throw Error('Identifiants du jeu et du personnage invalides')
  return 'nyxia-game-'+(await digest(gameId+'\u0000'+npcId)).slice(0,53) // 64 caractères maximum
}
function knowledgeKey(gameId,npcId,docId) { return `game:npc-brain:${gameId}:${npcId}:${docId}` }
function npcRecord(project,id) {
  if (id === 'nyxia-mj') return project.data?.gmBrain || {id:'nyxia-mj',knowledgeDocs:[]}
  return (Array.isArray(project.data?.npcCharacters)?project.data.npcCharacters:[]).find(x=>x?.id===id)
}
function npcSaveRecord(project,id,record) {
  project.data=project.data||{}
  if(id==='nyxia-mj')project.data.gmBrain=record
  else project.data.npcCharacters=project.data.npcCharacters.map(x=>x.id===id?record:x)
}
function chunksOf(text) {
  // Ne jamais couper en silence: refuser un document excédant la limite explicite.
  if(text.length>MAX_TEXT)throw Error('Document trop long : maximum 30 000 caractères par injection. Découpe-le en plusieurs documents.')
  const paragraphs=text.replace(/\r\n?/g,'\n').split(/\n\s*\n/),out=[],max=1100
  for(const p of paragraphs){
    const words=p.split(/\s+/).filter(Boolean); let section=''
    for(const word of words){
      if(word.length>max)throw Error('Mot/fragment trop long : découpe le document.')
      if((section+' '+word).length>max){out.push(section);section=word}
      else section=(section?section+' ':'')+word
    }
    if(section)out.push(section)
  }
  if(out.length>40)throw Error('Document trop fragmenté : utilise plusieurs injections.')
  return out
}
async function embed(env,texts) {
  if(!env.VECTORIZE_INDEX||typeof env.VECTORIZE_INDEX.describe!=='function')throw Error('Vectorize commun indisponible.')
  const details=await env.VECTORIZE_INDEX.describe()
  const dims=Number(details.dimensions||details.config?.dimensions)
  let vectors,model
  if((dims===1024||dims===768)&&env.AI&&typeof env.AI.run==='function'){
    model=dims===1024?'@cf/baai/bge-m3':'@cf/baai/bge-base-en-v1.5'
    const result=await env.AI.run(model,{text:texts})
    vectors=result?.data
  } else if(dims>=256 && dims<=1536 && env.OPENAI_API_KEY) {
    model='text-embedding-3-small'
    const response=await fetch('https://api.openai.com/v1/embeddings',{
      method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model,input:texts,dimensions:dims})
    })
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw Error('Service de vectorisation : '+safe(data.error?.message||'HTTP '+response.status,250))
    vectors=(data.data||[]).sort((a,b)=>a.index-b.index).map(v=>v.embedding)
  }else throw Error('Index de '+dims+' dimensions non compatible avec les modèles déjà configurés. Aucun index ni secret ajouté. Configurer le modèle correspondant avant injection.')
  if(!Array.isArray(vectors)||vectors.length!==texts.length||vectors.some(v=>!Array.isArray(v)||v.length!==dims))throw Error('Dimensions des vecteurs incompatibles. Aucune injection effectuée.')
  return {vectors,model}
}
export async function npcKnowledgeContext(env,gameId,npc,question,trust=0) {
  if(!env.CASHFLOW_KV||!env.VECTORIZE_INDEX||!npc?.id||!gameId)return ''
  const authorizedDocs=(Array.isArray(npc.knowledgeDocs)?npc.knowledgeDocs:[]).filter(d=>Number(trust)>=Number(d.minimumTrust??0))
  if(!authorizedDocs.length)return ''
  const {vectors}=await embed(env,[safe(question,2500)])
  const namespace=await npcNamespace(gameId,npc.id)
  const found=await env.VECTORIZE_INDEX.query(vectors[0],{namespace,topK:6,returnMetadata:'all'})
  const permitted=new Set(authorizedDocs.map(x=>x.id)),out=[]
  for(const hit of found.matches||[]){
    const m=hit.metadata||{},docId=String(m.docId||'')
    if(!permitted.has(docId)||m.gameId!==gameId||m.characterId!==npc.id||!Number.isInteger(m.part))continue
    const source=await env.CASHFLOW_KV.get(knowledgeKey(gameId,npc.id,docId),'json')
    if(!source||source.gameId!==gameId||source.characterId!==npc.id)continue
    if(source.chunks?.[m.part])out.push('SOURCE '+safe(source.title,120)+' : '+source.chunks[m.part])
  }
  return [...new Set(out)].slice(0,6).join('\n\n').slice(0,6800)
}
export async function handleNpcAtelier(request,env,getProject,saveProject) {
  const path=new URL(request.url).pathname
  if(path==='/api/atelier/game/npc/models'&&request.method==='GET'){
    try{
      const r=await fetch('https://openrouter.ai/api/v1/models',{headers:{Accept:'application/json'}})
      if(!r.ok)throw Error('OpenRouter HTTP '+r.status)
      const data=await r.json()
      const models=(data.data||[]).filter(x=>typeof x.id==='string'&&x.id.length<160).map(x=>({id:x.id,name:safe(x.name||x.id,180),prompt:x.pricing?.prompt??null,completion:x.pricing?.completion??null})).sort((a,b)=>(a.prompt===null?Infinity:Number(a.prompt))-(b.prompt===null?Infinity:Number(b.prompt)))
      return reply({ok:true,models})
    }catch(e){return reply({error:'Catalogue OpenRouter indisponible : '+e.message},502)}
  }
  if(path==='/api/atelier/game/npc/knowledge'&&request.method==='POST'){
    const body=await request.json().catch(()=>({})),gameId=safe(body.projectId,120),id=safe(body.characterId,120)
    if(!VALID_ID.test(gameId)||!VALID_ID.test(id))return reply({error:'Identifiants invalides'},400)
    const project=await getProject(env,gameId)
    if(!project||project.kind!=='nyxia-game')return reply({error:'Jeu introuvable'},404)
    const character=npcRecord(project,id)
    if(!character)return reply({error:'Personnage absent de ce jeu'},404)
    const title=safe(body.title||'Connaissances',160),text=String(body.text||'').trim()
    if(!text||text.length>MAX_TEXT)return reply({error:'Texte vide ou supérieur à 30 000 caractères'},400)
    const docs=Array.isArray(character.knowledgeDocs)?character.knowledgeDocs:[]
    const minimumTrust=Number(body.minimumTrust??0)
    if(!Number.isInteger(minimumTrust)||minimumTrust<0||minimumTrust>100)return reply({error:'Confiance minimale invalide (0–100)'},400)
    if(docs.length>=MAX_DOCS)return reply({error:'Maximum de 40 documents par personnage'},409)
    try{
      const chunks=chunksOf(text),{vectors,model}=await embed(env,chunks),namespace=await npcNamespace(gameId,id)
      const docId=crypto.randomUUID(),vectorIds=[]
      const records=await Promise.all(chunks.map(async(chunk,part)=>{
        const vid='ng-'+(await digest(gameId+'\u0000'+id+'\u0000'+docId+'\u0000'+part)).slice(0,60)
        vectorIds.push(vid)
        return {id:vid,namespace,values:vectors[part],metadata:{gameId,characterId:id,docId,part}}
      }))
      await env.VECTORIZE_INDEX.upsert(records)
      // Écriture seulement APRÈS confirmation de l'upsert. Jamais de copie dans une autre KV.
      const document={gameId,characterId:id,id:docId,title,chunks,vectorIds,model,createdAt:new Date().toISOString()}
      await env.CASHFLOW_KV.put(knowledgeKey(gameId,id,docId),JSON.stringify(document))
      const descriptor={id:docId,title,parts:chunks.length,minimumTrust,createdAt:document.createdAt}
      npcSaveRecord(project,id,{...character,knowledgeDocs:[...docs,descriptor]})
      await saveProject(env,project)
      return reply({ok:true,document:descriptor,namespace,model,notice:'Indexation asynchrone : la recherche peut demander quelques secondes.'},201)
    }catch(e){return reply({error:'Injection non confirmée : '+e.message},502)}
  }
  if(path==='/api/atelier/game/npc/knowledge'&&request.method==='DELETE'){
    const body=await request.json().catch(()=>({})),gameId=safe(body.projectId,120),id=safe(body.characterId,120),docId=safe(body.documentId,80)
    if(!VALID_ID.test(gameId)||!VALID_ID.test(id)||!VALID_ID.test(docId))return reply({error:'Identifiants invalides'},400)
    const project=await getProject(env,gameId),character=project&&npcRecord(project,id)
    if(!character)return reply({error:'Personnage introuvable'},404)
    if(!(character.knowledgeDocs||[]).some(d=>d.id===docId))return reply({error:'Document absent de cette fiche'},404)
    try{
      const record=await env.CASHFLOW_KV.get(knowledgeKey(gameId,id,docId),'json')
      if(record?.vectorIds?.length)await env.VECTORIZE_INDEX.deleteByIds(record.vectorIds)
      await env.CASHFLOW_KV.delete(knowledgeKey(gameId,id,docId))
      npcSaveRecord(project,id,{...character,knowledgeDocs:character.knowledgeDocs.filter(d=>d.id!==docId)})
      await saveProject(env,project)
      return reply({ok:true})
    }catch(e){return reply({error:'Retrait non confirmé : '+e.message},502)}
  }
  return reply({error:'Route personnages IA inconnue'},404)
}
