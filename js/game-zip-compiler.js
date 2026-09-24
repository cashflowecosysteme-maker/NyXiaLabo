/* NyXia Game — compilation depuis UN SEUL game-shell-template.zip officiel. Aucun dossier d'override. */
(function(){
'use strict';
const escAttr=v=>esc(String(v==null?'':v)).replace(/"/g,'&quot;');
const allowedMedia=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&!x.port}catch(_){return false}};
function timeline(){const d=currentProject?.data||{};try{const t=JSON.parse(d.mediaTimelineJson||'{}');return t.projectId===currentProject.id&&Array.isArray(t.scenes)?t:null}catch(_){return null}}
function publishId(){const raw=String(currentProject?.data?.publishedProductId||currentProject?.id||'');return /^[a-zA-Z0-9_-]{1,120}$/.test(raw)?raw:'';}
function cleanGameTools(d){
 const list=Array.isArray(d?.gameTools)?d.gameTools:[];
 return list.slice(0,24).map((x,i)=>{
  const path=String(x?.path||'').trim();
  if(!/^\/(?!\/)/.test(path)||path.includes('..')||/^[a-z]+:/i.test(path))return null;
  return {id:String(x?.id||('outil-'+i)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||('outil-'+i),name:String(x?.name||'Outil').trim().slice(0,100)||'Outil',icon:String(x?.icon||'🧰').slice(0,8),path:path.slice(0,700)};
 }).filter(Boolean);
}
function check(){
 const t=timeline();if(!t?.scenes?.length)throw Error('Prépare le Cahier Média et clique « Synchroniser les diapositives » avant la compilation.');
 const bad=t.scenes.flatMap(s=>(s.slots||[]).filter(m=>m.required&&!allowedMedia(m.url)).map(m=>(s.title||s.id)+' : '+(m.label||m.kind)));
 if(bad.length)throw Error('Médias demandés sans URL HTTPS : '+bad.slice(0,12).join(' | ')+(bad.length>12?'…':''));
 const id=publishId();if(!id)throw Error('Identifiant de jeu non valide.');
 if(!String(currentProject?.data?.guidedScenesJson||'').trim())throw Error('Conducteur des diapositives manquant : synchronise le Cahier Média.');
 return {t,id};
}
window.gamePackage=function(d){
 const t=timeline(),id=publishId(),scenes=t?.scenes||[],needed=scenes.flatMap(s=>s.slots||[]).filter(m=>m.required&&!allowedMedia(m.url)),urls=scenes.reduce((n,s)=>n+(s.slots||[]).filter(m=>allowedMedia(m.url)).length,0),gameTools=cleanGameTools(d);
 return '<h4>📦 Compilation ZIP — NyXia Game configuré</h4>'+
 '<div class="game-note">La coque complète de NyXia Game est incluse. Même CASHFLOW_KV, même D1, même Vectorize. Les règles MJ et les cerveaux des PNJ sont publiés séparément dans la KV centrale, jamais en fichiers publics sur GitHub.</div>'+
 '<div class="game-status-grid"><div class="game-status '+(scenes.length?'ready':'')+'"><strong>'+scenes.length+' scène(s)</strong> issues du Cahier Média</div><div class="game-status '+(!needed.length&&urls?'ready':'')+'"><strong>'+urls+' URL médias</strong>'+needed.length+' URL(s) requise(s) manquante(s)</div><div class="game-status '+(gameTools.length?'ready':'')+'"><strong>'+gameTools.length+' outil(s)</strong> propre(s) à ce jeu</div><div class="game-status"><strong>Identifiant unique</strong>'+escAttr(id||'non disponible')+'</div></div>'+
 '<div class="row" style="margin-top:14px"><div class="field"><label>Sous-domaine du jeu (sans https://)</label><input id="game-zip-domain" value="'+escAttr(d.gameZipDomain||'')+'" placeholder="ex. reboot.nyxia.top" onchange="setData(\'gameZipDomain\',this.value.trim().toLowerCase())"></div><div class="field"><label>Couverture : URL HTTPS externe</label><input type="url" value="'+escAttr(d.coverUrl||'')+'" placeholder="https://.../couverture.jpg" onchange="setData(\'coverUrl\',this.value)"></div></div>'+
 '<div class="tools-line" style="margin:12px 0"><button class="btn primary" onclick="nyxCompileGame()"'+(!scenes.length||needed.length?' disabled':'')+'>📦 Télécharger le jeu ZIP</button></div>'+
 '<p class="tiny">Images, MP3 Google Drive, vidéos YouTube et présentations Canva restent à leurs URL. La coque affiche ces médias sans les copier dans KV ou D1.</p>'+
 '<div id="zip-build-progress" role="status" class="game-note">Aucune compilation lancée.</div><div class="divider"></div>'+
 '<h4>🔄 Mettre à jour le jeu après la compilation</h4><p class="muted">Après avoir ajouté ou modifié un personnage, ce bouton met à jour les données du même jeu sans toucher à sa coque.</p>'+
 '<button class="btn gold" onclick="nyxPublishGame()"'+(!scenes.length||needed.length?' disabled':'')+'>🔄 Mettre à jour les données du jeu</button>'+
 '<div class="tools-line" style="margin-top:14px"><button class="btn" onclick="setGameTab(\'media\')">← Revenir aux médias</button><button class="btn" onclick="setGameTab(\'live\')">🎥 Live (existant)</button><button class="btn" onclick="setGameTab(\'control\')">🧠 Contrôle (existant)</button><button class="btn" onclick="exportGamePDF()">⬇ Dossier PDF MJ</button></div>';
};
function status(msg){const el=document.getElementById('zip-build-progress');if(el)el.textContent=msg}
function name(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,70)||'jeu'}
async function makePdf(project){
 const pdf=window.jspdf?.jsPDF;if(!pdf)throw Error('Bibliothèque PDF absente : impossible de livrer le Cahier du joueur.');const doc=new pdf({format:'a4',unit:'mm'}),sections=playerBookSections(project.data||{});let y=20;
 function line(text,size,bold){doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);String(text||'').split(/\r?\n/).forEach(p=>{for(const row of doc.splitTextToSize(p||' ',174)){if(y>277){doc.addPage();y=20}doc.text(row,18,y);y+=size>12?8:5}y+=2})}
 line(project.title,19,true);line('Cahier du joueur',15,true);line([project.data?.gameType,project.data?.duration,project.data?.playerCount+' joueurs'].filter(Boolean).join(' · '),10,false);y+=5;
 for(const section of sections){
  line(section.title,13,true);
  if(section.portraitUrl){
   try{
    const picture=await gamePortraitPdfImage(section.portraitUrl);
    if(picture){let w=Math.min(55,75*picture.ratio),h=w/picture.ratio;if(h>75){h=75;w=h*picture.ratio};if(y+h>277){doc.addPage();y=20};doc.addImage(picture.data,'PNG',18,y,w,h);y+=h+5}
   }catch(e){line('Portrait indisponible : '+e.message,9,false)}
  }
  line(section.text,10,false);y+=3;
 }
 return doc.output('blob');
}
async function publishForCompilation(id){
 const d=currentProject.data||{};
 const r=await api('/api/atelier/game/publish',{method:'POST',body:JSON.stringify({projectId:currentProject.id,productId:id,title:currentProject.title,subtitle:d.packageSubtitle||'',description:d.packageNotes||d.idea||'',coverUrl:d.coverUrl||'',version:d.productVersion||'1.0',teams:d.liveTeams||''})});
 if(!r.ok||r.product?.id!==id)throw Error('La configuration du jeu n’a pas été enregistrée dans CASHFLOW_KV.');
 currentProject.data.publishedProductId=r.product.id;markDirty();if(!await saveCurrent())throw Error('La publication a réussi, mais le projet local n’a pas pu confirmer cette mise à jour.');
 return r.product;
}
function htmlText(v){return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
async function personalizeShell(zip,title){
 const safe=htmlText(title);
 for(const path of ['index.html','login.html','dashbord.html','jeu.html']){
  const f=zip.file(path);if(!f)continue;let html=await f.async('string');
  html=html.replace(/>🎲 NyXia Game \| Nom du jeu à venir</g,'>🎲 NyXia Game | '+safe+'<').replace(/>NyXia Game \| Nom du jeu à venir</g,'>NyXia Game | '+safe+'<').replace(/>Nom du jeu à venir</g,'>'+safe+'<').replace(/<title>NyXia Game \| Nom du jeu à venir<\/title>/g,'<title>NyXia Game | '+safe+'</title>');
  zip.file(path,html);
 }
}
window.nyxCompileGame=async function(){
 if(!window.JSZip)return alert('JSZip indisponible.');
 let validated;try{validated=check()}catch(err){return alert(err.message)}
 const {t,id}=validated,d=currentProject.data||{},host=String(d.gameZipDomain||'').toLowerCase().trim();
 if(!/^[a-z0-9](?:[a-z0-9.-]{1,250}[a-z0-9])$/.test(host)||!host.endsWith('.nyxia.top')||host.includes('..'))return alert('Entre le vrai sous-domaine du jeu, sans https:// (par exemple reboot.nyxia.top).');
 const projectId=currentProject.id;
 if(!confirm('Créer le jeu NyXia Game — '+currentProject.title+' pour '+host+' ? La configuration de CE jeu sera enregistrée puis le ZIP sera préparé.'))return;
 try{
  clearTimeout(saveTimer);if(!await saveCurrent())throw Error('Impossible de sauvegarder le projet avant de compiler.');
  status('Lecture et vérification de la coque NyXia Game…');
  const template=await fetch('/game-shell-template.zip',{cache:'no-store'});if(!template.ok)throw Error('Coque modèle absente du Labo : /game-shell-template.zip');
  const zip=await JSZip.loadAsync(await template.blob());if(!zip.file('_worker.js')||!zip.file('jeu.html')||!zip.file('wrangler.toml'))throw Error('Coque modèle incomplète : compilation annulée.');
  const shellWorker=await zip.file('_worker.js').async('string');
  const shellNpcChat=zip.file('chat-pnj.html')?await zip.file('chat-pnj.html').async('string'):'';
  const shellDash=zip.file('dashbord.html')?await zip.file('dashbord.html').async('string'):'';
  const shellGame=await zip.file('jeu.html').async('string');
  const shellPortal=zip.file('js/nyxia-game.js')?await zip.file('js/nyxia-game.js').async('string'):'';
  if(!shellWorker.includes('NYXIA_MJ_SCOPED_BRAIN_V1')||
     !shellWorker.includes('NYXIA_GAME_NPC_SCOPED_BRAIN_V1')||
     !shellNpcChat.includes('loadNpcIdentity')||
     !shellDash.includes('npcMeta')||
     !shellGame.includes('NYXIA_GAME_EMBEDS_V2')||
     !shellPortal.includes('NYXIA_GAME_CUSTOM_TOOLS_V1')){
    throw Error('game-shell-template.zip est incomplet ou ancien. Remplace uniquement le fichier game-shell-template.zip officiel par la version fournie avec ce correctif.');
  }
  status('Enregistrement de la configuration de CE jeu dans CASHFLOW_KV…');await publishForCompilation(id);
  await personalizeShell(zip,currentProject.title);

  const all=t.scenes.flatMap(s=>(s.slots||[]).filter(m=>allowedMedia(m.url)).map(m=>({sceneId:s.id,kind:m.kind,id:m.id,label:m.label,url:m.url,trigger:m.trigger,playback:m.playback,source:m.source,sourceUrl:m.sourceUrl,credit:m.credit,license:m.license})));
  const gameTools=cleanGameTools(d);
  zip.file('game-tools.json',JSON.stringify({schemaVersion:1,gameId:id,tools:gameTools},null,2));
  zip.file('game-manifest.json',JSON.stringify({schemaVersion:2,gameId:id,title:currentProject.title,description:d.packageSubtitle||'',mediaMode:'external-url',mediaFiles:[],mediaCount:all.length,compiledAt:new Date().toISOString()},null,2));
  zip.file('data/game.json',JSON.stringify({gameId:id,title:currentProject.title,description:d.packageSubtitle||'',version:d.productVersion||'1.0',mediaMode:'external-url'},null,2));
  zip.file('data/media-urls.json',JSON.stringify({gameId:id,scenes:t.scenes.map(s=>({id:s.id,act:s.act,title:s.title,media:(s.slots||[]).filter(m=>allowedMedia(m.url)).map(m=>({id:m.id,kind:m.kind,url:m.url,label:m.label,trigger:m.trigger,playback:m.playback}))}))},null,2));
  zip.file('.assetsignore',String(await zip.file('.assetsignore').async('string'))+'\ndata/**\n');
  const original=await zip.file('wrangler.toml').async('string'),worker=name(host.split('.')[0]).slice(0,63);
  let cfg=original.replace(/^name\s*=\s*"[^"]*"/m,'name = "'+worker+'"')
   .replace(/^pattern\s*=\s*"[^"]*"/m,'pattern = "'+host+'"')
   .replace(/^SITE_URL\s*=\s*"[^"]*"/m,'SITE_URL = "https://'+host+'/"')
   .replace(/^GAME_ID\s*=\s*"[^"]*"/m,'GAME_ID = "'+id+'"')
   .replace(/^PORTAIL\s*=\s*"[^"]*"/m,'PORTAIL = "'+worker+'"');
  if(!cfg.includes('GAME_ID = "'+id+'"')||!cfg.includes('pattern = "'+host+'"'))throw Error('La configuration Cloudflare n’a pas pu être adaptée intégralement.');
  zip.file('wrangler.toml',cfg);
  const pdf=await makePdf(currentProject);zip.file('documents/cahier-du-joueur.pdf',pdf);
  zip.file('INSTALLATION.txt','NyXia Game — '+currentProject.title+'\n\nSous-domaine : '+host+'\nIdentifiant jeu : '+id+'\n\nLa compilation a déjà enregistré la configuration privée du jeu et intégré les correctifs universels YouTube, Canva, Google Drive et Outils du jeu.\n\nLes médias restent à leurs URL externes. Aucun média lourd n’est enregistré dans KV ou D1.\n');
  if(currentProject.id!==projectId)throw Error('Le projet a changé. La compilation est annulée.');
  status('Compression et préparation du téléchargement…');const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='NyXiaGame-'+name(currentProject.title)+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status('ZIP prêt : '+all.length+' URL médias, '+gameTools.length+' outil(s) du jeu et coque universelle mise à jour.');
 }catch(err){status('COMPILATION NON TERMINÉE : '+err.message);alert('Compilation interrompue : '+err.message+'\nAucun ZIP incomplet n’est présenté comme terminé.');}
};
window.nyxPublishGame=async function(){
 let checkResult;try{checkResult=check()}catch(err){return alert(err.message)}
 const d=currentProject.data||{};
 if(!confirm('Mettre à jour les données de '+currentProject.title+' ?'))return;
 try{clearTimeout(saveTimer);if(!await saveCurrent())throw Error('Sauvegarde du projet impossible.');
 const r=await api('/api/atelier/game/publish',{method:'POST',body:JSON.stringify({projectId:currentProject.id,productId:checkResult.id,title:currentProject.title,subtitle:d.packageSubtitle||'',description:d.packageNotes||d.idea||'',coverUrl:d.coverUrl||'',version:d.productVersion||'1.0',teams:d.liveTeams||''})});
 if(!r.ok||r.product?.id!==checkResult.id)throw Error('Confirmation du serveur incorrecte.');
 currentProject.data.publishedProductId=r.product.id;markDirty();await saveCurrent();renderGame();alert('Les données de '+currentProject.title+' sont à jour.');
 }catch(err){alert('Publication non confirmée : '+err.message)}
};
})();
