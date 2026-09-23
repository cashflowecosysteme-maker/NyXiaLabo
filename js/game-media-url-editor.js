/* NyXia Game — Montage URL par acte et scène. Aucun média binaire n'est enregistré dans le projet. */
(function(){
'use strict';
const KINDS={image:'🖼️ Image',audio:'🎵 Son / MP3',video:'🎥 Vidéo'};
const PROVIDERS={
 image:[
  {id:'pollinations',label:'Pollinations · compte requis, coût à vérifier',provider:'external',url:'https://enter.pollinations.ai/',rank:0},
  {id:'cf-flux-schnell',label:'Cloudflare FLUX Schnell · quota / facturation du compte',provider:'cloudflare',rank:1},
  {id:'flux/schnell',label:'FLUX Schnell · AIMLAPI',provider:'aiml',rank:2},
  {id:'flux/dev',label:'FLUX Dev · AIMLAPI',provider:'aiml',rank:3},
  {id:'stable-diffusion-v3-medium',label:'Stable Diffusion 3 Medium · AIMLAPI',provider:'aiml',rank:4},
  {id:'dall-e-3',label:'DALL·E 3 · AIMLAPI',provider:'aiml',rank:5},
  {id:'gpt-image-2',label:'GPT Image 2 · outil OpenAI configuré',provider:'configured-image',rank:6}
 ],
 video:[
  {id:'wan',label:'WAN · page existante',provider:'external',url:'/wan-video.html'},
  {id:'kling',label:'Kling · connexion du Labo requise',provider:'configured-video'},
  {id:'veo',label:'Veo · connexion du Labo requise',provider:'configured-video'}
 ]
};
let selection={project:'',scene:0,slot:0,results:[],searchMessage:'',preview:null,previewUrl:''};
const e=s=>esc(s==null?'':String(s)).replace(/"/g,'&quot;');
const safeUrl=s=>{try{let u=new URL(String(s||''));return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password&&u.port===''&&s.length<2000}catch(_){return false}};
const kindOf=s=>KINDS[s]||s;
const titleOf=(s,i)=>String(s?.title||'Scène '+(i+1)).slice(0,180);
const blankSlot=(kind,n,extra={})=>Object.assign({id:'m-'+Math.random().toString(36).slice(2,10),kind,label:kindOf(kind),url:'',trigger:'début',playback:'complet',order:n,required:false,source:'personnel',credit:'',license:'',sourceUrl:'',notes:''},extra);
function read(d){try{let obj=JSON.parse(d.mediaTimelineJson||'{}');return obj&&obj.projectId===currentProject.id&&Array.isArray(obj.scenes)?obj:null}catch(_){return null}}
function normalizeScene(scene,i){
 const id=String(scene?.id||'scene-'+String(i+1).padStart(3,'0')).replace(/[^\w-]/g,'').slice(0,90)||'scene-'+(i+1);
 const act=String(scene?.act||scene?.phase||'Acte 1').slice(0,100);
 let slots=Array.isArray(scene?.slots)?scene.slots.filter(x=>x&&KINDS[x.kind]).slice(0,48).map((s,n)=>blankSlot(s.kind,n,{...s,id:String(s.id||'m-'+i+'-'+n).replace(/[^\w-]/g,''),url:safeUrl(s.url)?s.url:'',order:n})):[];
 for(const k of ['audio','image','video'])if(!slots.some(x=>x.kind===k))slots.push(blankSlot(k,slots.length));
 const media=scene?.media&&typeof scene.media==='object'?scene.media:{};
 const showText=scene?.showText===true||media.showText===true;
 const displayText=String(scene?.displayText??media.displayText??'').slice(0,6000);
 return {id,act,title:titleOf(scene,i),announcement:String(scene?.announcement||'').slice(0,3500),showText,displayText,notes:String(scene?.notes||'').slice(0,5000),slots};
}
function fromNotebook(book){return (book.scenes||[]).map((s,i)=>{
 const act=String(s.act||s.actTitle||s.phase||'Acte 1'),slots=[];
 for(const [kind,needed,brief] of [['audio',s.audioNeeded,s.audioBrief||s.freeSoundQuery],['image',s.imageNeeded,s.imagePrompt||s.imageBrief],['video',s.videoNeeded,s.videoBrief||s.videoMovement]])slots.push(blankSlot(kind,slots.length,{required:!!needed,notes:String(brief||'').slice(0,3200)}));
 return normalizeScene({id:s.id||'scene-'+String(i+1).padStart(3,'0'),act,title:s.title,announcement:s.announcement||'',notes:[s.place,s.action].filter(Boolean).join(' — '),slots},i)
});}
function fromGuide(guide){return (Array.isArray(guide)?guide:guide.scenes||[]).map((s,i)=>{
 const slots=[];
 if(Array.isArray(s.media?.items)&&s.media.items.length){
  s.media.items.forEach(it=>{if(KINDS[it.kind]&&safeUrl(it.url))slots.push(blankSlot(it.kind,slots.length,it))});
 }else for(const [kind,key] of [['audio','audioUrl'],['image','imageUrl'],['video','videoUrl']]){
  if(s.media?.[key])slots.push(blankSlot(kind,slots.length,{url:s.media[key]}));
 }
 return normalizeScene({id:s.id,act:s.phase,title:s.title,announcement:s.announcement,showText:s.media?.showText===true,displayText:s.media?.displayText||'',slots},i)
});}
function state(){
 if(!currentProject)return null;
 if(selection.project!==currentProject.id)selection={project:currentProject.id,scene:0,slot:0,results:[],searchMessage:'',preview:null,previewUrl:''};
 const d=currentProject.data||{},saved=read(d);if(saved)return saved;
 const notebook=mediaNotebookRead(d);
 if(notebook?.scenes?.length)return {version:2,projectId:currentProject.id,scenes:fromNotebook(notebook)};
 try{const g=JSON.parse(d.guidedScenesJson||'{}');if((g.scenes||g)?.length)return {version:2,projectId:currentProject.id,scenes:fromGuide(g)}}catch(_){}
 return {version:2,projectId:currentProject.id,scenes:[]};
}
function syncSlides(t){
 const d=currentProject.data,prior=(()=>{try{const p=JSON.parse(d.guidedScenesJson||'{}');return Array.isArray(p)?p:p.scenes||[]}catch(_){return []}})();
 const scenes=t.scenes.map((s,i)=>{
  const old=prior.find(o=>o.id===s.id)||prior.find(o=>o.phase===s.act&&o.title===s.title)||{};
  const items=s.slots.filter(m=>safeUrl(m.url)).map((m,n)=>({id:m.id,kind:m.kind,url:m.url,label:m.label||kindOf(m.kind),trigger:m.trigger||'début',playback:m.playback||'complet',order:n,source:m.source||'personnel',sourceUrl:m.sourceUrl||'',credit:m.credit||'',license:m.license||''}));
  const media={items,slides:[{slideId:s.id,index:i,items:items.map(x=>({...x}))}],imageUrl:items.find(x=>x.kind==='image')?.url||'',audioUrl:items.find(x=>x.kind==='audio')?.url||'',videoUrl:items.find(x=>x.kind==='video')?.url||'',showText:!!s.showText,displayText:String(s.displayText||'').slice(0,6000),instruction:old.media?.instruction||''};
  return {...old,id:s.id,phase:s.act,title:s.title,announcement:s.announcement,media};
 });
 d.guidedScenesJson=JSON.stringify({scenes},null,2);
}
function commit(t,repaint=true){t.version=2;t.projectId=currentProject.id;t.scenes=t.scenes.map(normalizeScene);currentProject.data.mediaTimelineJson=JSON.stringify(t);syncSlides(t);markDirty();if(repaint)renderGame();}
function pickSlot(){const t=state(),s=t?.scenes?.[selection.scene];return s?.slots?.[selection.slot]||null;}
function ensureSlot(){const t=state(),s=t.scenes[selection.scene];return s&&s.slots[selection.slot]||null;}
window.nyxMediaSelect=function(scene,slot){selection.scene=scene;selection.slot=slot;selection.results=[];selection.preview=null;selection.searchMessage='';renderGame()};
window.nyxMediaSet=function(scene,slot,field,value){
 const t=state(),s=t.scenes[scene],m=s?.slots[slot];if(!m)return;
 if(field==='url'){
  value=String(value||'').trim();if(value&&!safeUrl(value)){alert('Entre une URL HTTPS directe, sans identifiant ni mot de passe dans le lien.');renderGame();return}
 }
 if(!['url','label','trigger','playback','notes'].includes(field))return;
 m[field]=String(value||'').slice(0,field==='url'?2000:field==='notes'?3200:300);
 commit(t,field==='url'||field==='trigger'||field==='playback');
};
window.nyxSceneSet=function(i,field,value){const t=state(),s=t.scenes[i];if(!s||!['act','title','announcement','showText','displayText'].includes(field))return;if(field==='showText'){s.showText=value===true||value==='true'||value==='1';commit(t,true);return}s[field]=String(value||'').slice(0,field==='displayText'?6000:3500);commit(t,false)};
window.nyxSlotAdd=function(si,kind){const t=state(),s=t.scenes[si];if(!s||!KINDS[kind]||s.slots.length>=48)return;s.slots.push(blankSlot(kind,s.slots.length));selection.scene=si;selection.slot=s.slots.length-1;commit(t)};
window.nyxSlotRemove=function(si,mi){const t=state(),s=t.scenes[si];if(!s?.slots[mi]||!confirm('Retirer uniquement cet emplacement et son URL ? Le média externe ne sera pas supprimé.'))return;s.slots.splice(mi,1);selection.scene=si;selection.slot=Math.max(0,mi-1);commit(t)};
window.nyxSlotMove=function(si,mi,delta){const t=state(),s=t.scenes[si],target=mi+delta;if(!s||target<0||target>=s.slots.length)return;[s.slots[mi],s.slots[target]]=[s.slots[target],s.slots[mi]];selection.scene=si;selection.slot=target;commit(t)};
window.nyxSlotScene=function(si,mi,dest){const t=state(),from=t.scenes[si],to=t.scenes[dest];if(!from||!to||si===dest||!from.slots[mi])return;if(to.slots.length>=48)return alert('La scène de destination possède déjà 48 emplacements : déplacement annulé sans perte.');to.slots.push(from.slots.splice(mi,1)[0]);selection.scene=dest;selection.slot=to.slots.length-1;commit(t)};
window.nyxSceneAdd=function(){const t=state();if(t.scenes.length>=250)return alert('Maximum 250 scènes.');const a=t.scenes.at(-1)?.act||'Acte 1';t.scenes.push(normalizeScene({id:'scene-'+Date.now().toString(36),act:a,title:'Nouvelle scène'},t.scenes.length));selection.scene=t.scenes.length-1;selection.slot=0;commit(t)};
window.nyxSceneMove=function(si,delta){const t=state(),j=si+delta;if(j<0||j>=t.scenes.length)return;[t.scenes[si],t.scenes[j]]=[t.scenes[j],t.scenes[si]];selection.scene=j;commit(t)};
const splitHeading=l=>{const m=String(l).replace(/^\s*[-*]+\s*/,'').replace(/\*\*/g,'').match(/^\s*#{0,6}\s*(acte|sc[eè]ne)\s*(\d+|[IVXLCDM]+)\b\s*[-.:—–]?\s*(.*?)\s*$/i);return m?{type:/acte/i.test(m[1])?'act':'scene',number:m[2],name:m[3]}:null};
function parseText(text){
 let act='Acte 1',current=null;const scenes=[];for(const line of String(text).split(/\r?\n/)){
  const heading=splitHeading(line);
  if(heading?.type==='act'){act='Acte '+heading.number+(heading.name?' — '+heading.name:'');continue}
  if(heading?.type==='scene'){
   if(scenes.length>=250)throw Error('Le Cahier dépasse 250 scènes.');
   current={id:'scene-'+String(scenes.length+1).padStart(3,'0'),title:'Scène '+heading.number+(heading.name?' — '+heading.name:''),act,announcement:'',notes:'',slots:[]};scenes.push(current);continue;
  }
  if(!current||!line.trim())continue;
  const m=line.replace(/^\s*[-*]+\s*/,'').match(/^\s*(son|audio|mp3|musique|image|images|photo|vid[eé]o|video|annonce|d[eé]clenchement|lecture)\s*:\s*(.*?)\s*$/i);
  if(!m){current.notes+=(current.notes?'\n':'')+line.trim();continue}
  const type=m[1].normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),v=m[2].trim();
  if(type==='annonce'){current.announcement+=(current.announcement?'\n':'')+v;continue}
  if(type==='declenchement'||type==='lecture'){if(current.slots.length)current.slots.at(-1)[type==='lecture'?'playback':'trigger']=v;else current.notes+='\n'+line.trim();continue}
  const kind=/son|audio|mp3|musique/.test(type)?'audio':/image|photo/.test(type)?'image':'video';
  current.slots.push(blankSlot(kind,current.slots.length,{required:true,label:safeUrl(v)?kindOf(kind):v||kindOf(kind),url:safeUrl(v)?v:'',notes:safeUrl(v)?'':v}));
 }
 if(!scenes.length)throw Error('Aucune scène détectée. Mets « Acte 1 », puis « Scène 1 » comme titres distincts dans ton Cahier Média.');
 return scenes.map(normalizeScene);
}
async function readFile(file){const name=file.name.toLowerCase();if(/\.pdf$/.test(name))return await conceptPdfMarkdown(file);return await gameReadImportFile(file);}
window.nyxMediaImport=async function(files){
 const file=files?.[0];if(!file||!currentProject)return;
 if(file.size>4*1024*1024)return alert('Cahier trop volumineux (maximum 4 Mo de texte).');
 const projectId=currentProject.id;
 try{
  let parsed=null,scenes=[];
  if(/\.json$/i.test(file.name)){
   parsed=JSON.parse(await file.text());if(parsed.projectId&&parsed.projectId!==projectId)throw Error('Ce cahier appartient à un autre jeu.');
   const arr=Array.isArray(parsed)?parsed:parsed.scenes;if(!Array.isArray(arr)||!arr.length)throw Error('Le JSON ne contient pas de scènes.');
   if(arr.length>250)throw Error('Maximum 250 scènes.');
   scenes=arr.map((s,i)=>s.slots?normalizeScene(s,i):fromNotebook({scenes:[{...s,id:s.id||'scene-'+String(i+1).padStart(3,'0'),number:i+1}]} )[0]);
  }else scenes=parseText(await readFile(file));
  if(currentProject.id!==projectId)throw Error('Projet changé pendant la lecture.');
  const old=read(currentProject.data),existing=old?.scenes||[];
  const used=new Set();scenes.forEach((s,i)=>{
   const prev=existing.find(p=>p.id===s.id)||existing.find(p=>p.act===s.act&&p.title===s.title);
   if(prev){used.add(prev.id);for(const m of prev.slots){if(m.url){const target=s.slots.find(x=>x.kind===m.kind&&!x.url);if(target)Object.assign(target,m);else s.slots.push({...m})}}}
  });
  const orphan=existing.filter(s=>!used.has(s.id)&&s.slots.some(m=>m.url));
  if(orphan.length)throw Error(orphan.length+' scène(s) contenant déjà des URL ne correspondent pas au nouveau Cahier. Aucun remplacement : ajuste les titres ou exporte les scènes avant de réimporter.');
  if(!confirm('Importer '+scenes.length+' scènes de « '+file.name+' » ? Les URL existantes correspondantes seront conservées. Aucun média ne sera téléversé chez Cloudflare.'))return;
  commit({version:2,projectId,sourceFile:file.name,scenes});if(!await saveCurrent())throw Error('Échec de sauvegarde du projet.');toast(scenes.length+' scènes classées par acte ✓');
 }catch(err){alert('Cahier Média non importé : '+err.message)}
};
window.nyxMediaCommit=function(){const t=state();if(!t.scenes.length)return alert('Importe le Cahier Média ou crée une scène.');commit(t);toast('Présentation synchronisée avec Le jeu ✓')};
window.nyxMediaExport=function(){const t=state();if(!t.scenes.length)return;const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(t,null,2)],{type:'application/json'}));a.href=url;a.download='cahier-media-'+safeName(currentProject.title)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
window.nyxMediaSearch=async function(){
 const slot=pickSlot();if(!slot)return alert('Sélectionne un média dans une scène.');
 const kind=slot.kind,source=document.getElementById('nyx-free-source')?.value,q=document.getElementById('nyx-free-query')?.value.trim();
 if(!q||q.length<3||q.length>100)return alert('Saisis entre 3 et 100 caractères.');
 const allowed=kind==='audio'?['freesound']:['pexels','pixabay'];if(!allowed.includes(source))return alert('Choisis une banque compatible avec ce média.');
 selection.results=[];selection.searchMessage='Recherche '+source+'…';renderGame();
 try{
  let r,items=[];
  if(source==='freesound'){r=await api('/api/freesound-search?q='+encodeURIComponent(q));items=(r.results||[]).filter(x=>x.preview&&mediaFreeAllowedLicense(x.license)).map(x=>({url:x.preview,preview:x.preview,source:'Freesound',sourceUrl:'https://freesound.org/s/'+x.id+'/',license:x.license||'',credit:x.username||'',label:x.name||q}));}
  if(source==='pexels'&&kind==='image'){r=await api('/api/pexels-search?q='+encodeURIComponent(q));items=(r.photos||[]).map(x=>({url:x.full,preview:x.thumb||x.full,source:'Pexels',sourceUrl:x.url,license:'Pexels License',credit:x.photographer,label:q}));}
  if(source==='pexels'&&kind==='video'){r=await api('/api/pexels-video-search?q='+encodeURIComponent(q));items=(r.videos||[]).filter(x=>x.full||x.preview).map(x=>({url:x.full||x.preview,preview:x.preview||x.full,source:'Pexels',sourceUrl:x.url,license:'Pexels License',credit:x.photographer,label:q}));}
  if(source==='pixabay'){r=await api('/api/game/media/pixabay-search?kind='+kind+'&q='+encodeURIComponent(q));items=((kind==='video'?r.videos:r.photos)||[]).map(x=>({url:x.full,preview:x.thumb||x.preview||x.full,source:'Pixabay',sourceUrl:x.url,license:'Pixabay Content License',credit:x.photographer,label:q}));}
  selection.results=items.filter(x=>safeUrl(x.url)).slice(0,8);selection.searchMessage=selection.results.length?'Vérifie les licences et l’autorisation de lecture directe avant de choisir un résultat.':'Aucun résultat compatible.';
 }catch(err){selection.searchMessage=err.message}renderGame();
};
window.nyxMediaUseResult=function(i){
 const r=selection.results[i],t=state(),slot=t.scenes[selection.scene]?.slots[selection.slot];if(!r||!slot||!safeUrl(r.url))return;
 if(!confirm('Utiliser ce lien externe dans CETTE scène ? Vérifie la licence et la politique de liens directs du fournisseur. Pour une diffusion durable, héberge ta copie autorisée puis remplace simplement cette URL.'))return;
 Object.assign(slot,{url:r.url,source:r.source,sourceUrl:r.sourceUrl,credit:r.credit,license:r.license,label:r.label});selection.results=[];commit(t);
};
function connectedTool(provider){const list=tools||[];if(provider.id==='gpt-image-2')return list.find(t=>t.kind==='image'&&/gpt-image-2/i.test(t.model||''));if(provider.id==='kling'||provider.id==='veo')return list.find(t=>t.kind==='video'&&new RegExp(provider.id,'i').test((t.name||'')+' '+(t.model||'')));return null;}
window.nyxMediaMake=async function(type){
 const s=pickSlot(),choice=document.getElementById('nyx-'+type+'-model')?.value;
 if(!s||s.kind!==type)return alert('Sélectionne une case '+kindOf(type)+' dans une scène.');
 const model=PROVIDERS[type].find(p=>p.id===choice);if(!model)return alert('Choisis un fournisseur.');
 const prompt=document.getElementById('nyx-'+type+'-prompt')?.value.trim()||s.notes.trim()||'';
 if(model.provider==='external'){
  if(!confirm('Ouvrir '+model.label+' dans un nouvel onglet ? Après la création, télécharge et héberge ton média ailleurs, puis colle son URL dans la scène.'))return;
  window.open(model.url,'_blank','noopener,noreferrer');return;
 }
 if(!prompt||prompt.length<12)return alert('Ajoute une description de création pour cette scène.');
 const t=connectedTool(model);
 if(model.provider==='configured-video'&&!t)return alert('Ce moteur n’est pas configuré dans les outils du Labo. Aucun appel lancé.');
 if(model.provider==='configured-image'&&!t)return alert('GPT Image 2 n’est pas configuré dans les outils du Labo. Aucun appel lancé.');
 const price=t?verifiedMediaPrice(t):null;
 if(t&&!Number.isFinite(price))return alert('Le tarif de cet outil n’est pas vérifié dans le Labo. Aucun appel lancé.');
 if(!confirm('Générer UN '+kindOf(type)+' avec '+model.label+' ? '+(t?'Tarif renseigné : '+price+' $ CAD par appel.':'Vérifie les neurones et le tarif de ton compte fournisseur.')+' Tu téléchargeras le résultat avant de placer son URL définitive.'))return;
 const slotId=s.id,projectId=currentProject.id;
 try{
  selection.searchMessage='Génération en cours · ne relance pas avant de vérifier le résultat.';renderGame();
  let output;
  if(type==='image'&&model.provider==='cloudflare'){
   output=await api('/api/game/media/image/cloudflare',{method:'POST',body:JSON.stringify({projectId,assetId:slotId,model:'@cf/black-forest-labs/flux-1-schnell',prompt:(currentProject.title+' · '+slotId+' · '+prompt).slice(0,2048),confirmed:true})});
   output=output.images?.[0];
  }else if(type==='image'&&model.provider==='aiml'){
   output=await api('/api/game/media/image/generate',{method:'POST',body:JSON.stringify({projectId,assetId:slotId,model:model.id,prompt:currentProject.title+' · '+slotId+' · '+prompt,confirmed:true})});output=output.images?.[0];
  }else if(type==='image'){
   output=await api('/api/generate-image',{method:'POST',body:JSON.stringify({toolId:t.id,prompt,aspect_ratio:'16:9'})});output=output.images?.[0];
  }else{
   const image=document.getElementById('nyx-video-start')?.value.trim()||'',duration=document.getElementById('nyx-video-duration')?.value||'',format=document.getElementById('nyx-video-format')?.value||'';
   if(image&&!safeUrl(image))throw Error('Image de départ : une URL HTTPS est requise.');
   const response=await api('/api/generate-video',{method:'POST',body:JSON.stringify({toolId:t.id,prompt:prompt+'\nDurée : '+duration+' ; Format : '+format,image_url:image})});
   output=response.video_url||(response.id?await pollGameMedia('/api/generate-video/status?id='+encodeURIComponent(response.id),'video',45,5000):'');
  }
  if(!output)throw Error('Le fournisseur n’a retourné aucun média. Vérifie la consommation avant un nouvel essai.');
  if(currentProject?.id!==projectId)throw Error('Le projet a changé. Aucun lien n’a été enregistré.');
  selection.preview={kind:type,url:output};selection.searchMessage='Résultat temporaire disponible : télécharge, héberge à l’extérieur puis colle son URL permanente. Aucun média généré n’est stocké dans la KV.';renderGame();
 }catch(err){selection.searchMessage='Génération interrompue : '+err.message+'. Vérifie la facture avant toute relance.';renderGame();}
};
function tag(slot){const temporaryImage=slot.previewTemporary&&slot.kind==='image'&&/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(String(slot.url||''))&&slot.url.length<10000000;if(!safeUrl(slot.url)&&!temporaryImage)return '<small style="color:#d5a2ad">URL manquante</small>';let src=e(slot.url),label=e(slot.label||kindOf(slot.kind));return slot.kind==='image'?'<img loading="lazy" alt="'+label+'" src="'+src+'" style="max-width:100%;max-height:160px;object-fit:contain">':slot.kind==='audio'?'<audio controls preload="none" src="'+src+'" style="max-width:100%;width:100%"></audio>':'<video controls preload="metadata" src="'+src+'" style="max-width:100%;max-height:180px"></video>'}
function slotHtml(s,si,m,mi,t){const chosen=selection.scene===si&&selection.slot===mi,options=t.scenes.map((dest,i)=>'<option value="'+i+'"'+(i===si?' selected':'')+'>'+e(dest.act+' / '+dest.title)+'</option>').join('');return '<div style="padding:12px;border:1px solid '+(chosen?'#f4c56a':'rgba(167,139,250,.28)')+';border-radius:12px;margin:9px 0;background:#080d20">'+
 '<div class="tools-line" style="align-items:center"><b>'+e(kindOf(m.kind))+'</b><button type="button" class="btn gold" onclick="nyxMediaSelect('+si+','+mi+')">'+(chosen?'✓ Sélectionné':'Choisir pour rechercher / créer')+'</button><button class="btn" onclick="nyxSlotMove('+si+','+mi+',-1)"'+(mi===0?' disabled':'')+'>↑</button><button class="btn" onclick="nyxSlotMove('+si+','+mi+',1)"'+(mi===s.slots.length-1?' disabled':'')+'>↓</button><button class="btn danger" onclick="nyxSlotRemove('+si+','+mi+')">✕</button></div>'+ 
 '<div class="field"><label>Nom de ce média</label><input value="'+e(m.label)+'" onchange="nyxMediaSet('+si+','+mi+',\'label\',this.value)"></div>'+ 
 '<div class="field"><label>URL HTTPS directe (aucun fichier vers Cloudflare)</label><input type="url" placeholder="https://mon-hebergeur.example/media/fichier.mp3" value="'+e(m.url)+'" onchange="nyxMediaSet('+si+','+mi+',\'url\',this.value)"></div>'+ 
 '<div class="row"><div class="field"><label>Déclenchement</label><select onchange="nyxMediaSet('+si+','+mi+',\'trigger\',this.value)">'+['début','bouton suivant','manuel'].map(v=>'<option'+(m.trigger===v?' selected':'')+'>'+v+'</option>').join('')+'</select></div><div class="field"><label>Lecture</label><select onchange="nyxMediaSet('+si+','+mi+',\'playback\',this.value)">'+['complet','boucle','manuel'].map(v=>'<option'+(m.playback===v?' selected':'')+'>'+v+'</option>').join('')+'</select></div></div>'+ 
 '<div class="field"><label>Déplacer dans une autre scène</label><select onchange="nyxSlotScene('+si+','+mi+',Number(this.value))">'+options+'</select></div>'+ 
 '<div class="tiny">'+(m.required?'Demandé dans le Cahier Média · ':'')+e(m.source==='personnel'?'URL personnelle':m.source)+(m.credit?' · Crédit : '+e(m.credit):'')+'</div>'+tag(m)+'</div>'}
function providerSelect(type){return '<select id="nyx-'+type+'-model" aria-label="Moteur '+type+'">'+PROVIDERS[type].map(p=>{const found=connectedTool(p),disabled=(p.provider==='configured-image'||p.provider==='configured-video')&&!found;return '<option value="'+e(p.id)+'"'+(disabled?' disabled':'')+'>'+e(p.label+(disabled?' · non connecté':''))+'</option>'}).join('')+'</select>'}
window.gameMedia=function(d){const t=state(),ready=t.scenes.length,slot=pickSlot(),n=t.scenes.reduce((n,s)=>n+s.slots.filter(x=>x.required&&!safeUrl(x.url)).length,0),kind=slot?.kind||'image';
 const banks=kind==='audio'?['freesound']:['pexels','pixabay'];
 const results=selection.results.map((x,i)=>'<div style="padding:10px;border:1px solid rgba(167,139,250,.24);border-radius:10px">'+tag({...x,kind,label:x.label})+'<div class="tiny">'+e(x.source)+' · '+e(x.credit||'')+' · '+e(x.license||'')+'</div><button class="btn gold" onclick="nyxMediaUseResult('+i+')">Ajouter cette URL à la scène choisie</button>'+(safeUrl(x.sourceUrl)?'<a class="btn" target="_blank" rel="noopener noreferrer" href="'+e(x.sourceUrl)+'">Source / licence ↗</a>':'')+'</div>').join('');
 const preview=selection.preview?'<div class="panel" style="margin-top:10px"><b>Résultat de création non enregistré</b>'+tag({...selection.preview,previewTemporary:true,label:'Aperçu de création'})+'<div class="tools-line"><a class="btn gold" href="'+e(selection.preview.url)+'" target="_blank" rel="noopener noreferrer" '+(selection.preview.url.startsWith('data:')?'download="nyxia-image.png"':'')+'>⬇ Ouvrir / télécharger</a></div><p class="tiny">Héberge ensuite ce fichier ailleurs, puis colle l’URL finale dans la case sélectionnée. Aucun lien provisoire ne sera enregistré automatiquement.</p></div>':'';
 return '<h4>🎬 Médias — trois outils et montage des scènes</h4><p class="game-note">Un seul Cahier Média, une URL HTTPS par média. Pas de téléversement d’images, MP3 ou vidéos dans Cloudflare, KV ou D1. Chaque URL et chaque déclenchement restent liés à leur scène.</p>'+ 
 ((d.productionAssetsJson&&!read(d))?'<p class="game-note">Anciens médias : le registre historique est conservé, mais ses fichiers ne sont pas transférés automatiquement dans le nouveau montage URL. Vérifie les liens avant de remplacer le Cahier.</p>':'')+
 '<div class="panel" style="margin:12px 0"><h4>🎬 Cahier Média → actes et scènes</h4><label class="btn primary" style="cursor:pointer">📂 Importer mon Cahier Média <input type="file" accept=".md,.markdown,.txt,.json,.docx,.rtf,.pdf" style="display:none" onchange="nyxMediaImport(this.files);this.value=\'\'"></label> <button class="btn" onclick="nyxSceneAdd()">+ Scène manuelle</button> <button class="btn" onclick="nyxMediaExport()">⬇ Export JSON</button><p class="tiny">'+ready+' scène(s) · '+n+' URL(s) requise(s) manquante(s). Titres reconnus : Acte 1, Scène 1.</p></div>'+ 
 '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">'+
 '<div class="panel"><h4>1 · 🔍 Recherche gratuite</h4><label class="tiny">Source</label><select id="nyx-free-source">'+banks.map(p=>'<option>'+p+'</option>').join('')+'</select><label class="tiny">Recherche</label><input id="nyx-free-query" placeholder="bruit de porte, corridor..." value="'+e(slot?.notes?.slice(0,95)||'')+'"><button class="btn primary" onclick="nyxMediaSearch()"'+(!slot?' disabled':'')+'>Chercher</button><div class="tiny">Freesound (sons), Pexels et Pixabay (images / vidéos). Liens soumis aux droits et à la disponibilité de la banque.</div></div>'+ 
 '<div class="panel"><h4>2 · 🖼️ Créer une image</h4>'+providerSelect('image')+'<textarea id="nyx-image-prompt" rows="4" placeholder="Décris ton image...">'+e(slot?.kind==='image'?slot.notes:'')+'</textarea><button class="btn gold" onclick="nyxMediaMake(\'image\')"'+(slot?.kind!=='image'?' disabled':'')+'>Créer / ouvrir le fournisseur</button><p class="tiny">Ordre indicatif gratuit/quota → payant, sans tarif garanti. Génération une à une, avec confirmation.</p></div>'+ 
 '<div class="panel"><h4>3 · 🎥 Créer une vidéo</h4>'+providerSelect('video')+'<textarea id="nyx-video-prompt" rows="3" placeholder="Décris la vidéo...">'+e(slot?.kind==='video'?slot.notes:'')+'</textarea><label class="tiny">Image initiale (URL facultative)</label><input id="nyx-video-start" type="url" placeholder="https://..."><div class="row"><div class="field"><label>Durée souhaitée</label><select id="nyx-video-duration"><option>5 s</option><option>10 s</option><option>15 s</option></select></div><div class="field"><label>Format</label><select id="nyx-video-format"><option>16:9</option><option>9:16</option><option>1:1</option></select></div></div><button class="btn gold" onclick="nyxMediaMake(\'video\')"'+(slot?.kind!=='video'?' disabled':'')+'>Créer / ouvrir le fournisseur</button><p class="tiny">WAN ouvre la page existante. Kling et Veo demandent un outil réellement connecté.</p></div></div>'+ 
 '<div id="game-media-search-status" class="game-note" role="status">'+e(selection.searchMessage||'Sélectionne une case dans une scène pour la rechercher ou créer.')+'</div>'+ (results?'<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">'+results+'</div>':'')+preview+
 '<div class="divider"></div><h3>🎞️ Montage par acte et scène</h3>'+(ready?t.scenes.map((s,i)=>'<details '+(i===selection.scene?'open':'')+' class="panel" style="margin:12px 0"><summary style="cursor:pointer;font-size:16px;font-weight:700">'+e(s.act+' — '+s.title)+' · '+s.slots.filter(m=>safeUrl(m.url)).length+'/'+s.slots.length+' URL</summary><div class="row" style="margin-top:12px"><div class="field"><label>Acte</label><input value="'+e(s.act)+'" onchange="nyxSceneSet('+i+',\'act\',this.value)"></div><div class="field"><label>Scène</label><input value="'+e(s.title)+'" onchange="nyxSceneSet('+i+',\'title\',this.value)"></div></div><div class="row"><div class="field"><label>Afficher du texte dans cette scène ?</label><select onchange="nyxSceneSet('+i+',\'showText\',this.value===\'oui\')"><option value="non"'+(!s.showText?' selected':'')+'>Non</option><option value="oui"'+(s.showText?' selected':'')+'>Oui</option></select></div></div><div class="field"><label>Texte visible aux joueurs — exactement ce texte</label><textarea rows="3" placeholder="Ex. : La porte s’ouvre lentement devant vous…" '+(!s.showText?'disabled ':'')+'onchange="nyxSceneSet('+i+',\'displayText\',this.value)">'+e(s.displayText)+'</textarea></div><div class="tools-line"><button class="btn" onclick="nyxSceneMove('+i+',-1)"'+(i===0?' disabled':'')+'>↑ Scène</button><button class="btn" onclick="nyxSceneMove('+i+',1)"'+(i===t.scenes.length-1?' disabled':'')+'>↓ Scène</button>'+Object.keys(KINDS).map(k=>'<button class="btn" onclick="nyxSlotAdd('+i+',\''+k+'\')">+ '+e(kindOf(k))+'</button>').join('')+'</div>'+s.slots.map((m,j)=>slotHtml(s,i,m,j,t)).join('')+'</details>').join(''):'<div class="game-note">Importe le Cahier Média : les actes et scènes apparaîtront ici, sans bibliothèque de médias à parcourir.</div>')+
 '<div class="panel"><h4>▶ Présentation « Le jeu »</h4><p class="tiny">'+t.scenes.length+' scène(s) = '+t.scenes.length+' slide(s). Tous les médias d’une même scène restent ensemble : image, son et vidéo peuvent jouer sur la même slide. Le texte joueur est facultatif et affiche uniquement ce que tu écris. Boutons Suivant, Précédent et Reprendre dans le portail.</p><button class="btn primary" onclick="nyxMediaCommit()"'+(!ready?' disabled':'')+'>✓ Synchroniser les diapositives</button><button class="btn gold" onclick="setGameTab(\'package\')">📦 Compilation ZIP →</button></div>';
};
// Exposed for deterministic regression checks; no API or persistent data outside existing project.
window.NyXiaMediaUrl={parseText,normalizeScene,fromNotebook,fromGuide,safeUrl,providers:PROVIDERS};
})();
