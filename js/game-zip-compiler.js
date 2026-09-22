/* NyXia Game — compilation de la coque réutilisable ; aucun secret dans les ressources statiques. */
(function(){
'use strict';
const escAttr=v=>esc(String(v==null?'':v)).replace(/"/g,'&quot;');
const allowedMedia=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&!x.port}catch(_){return false}};
function timeline(){const d=currentProject?.data||{};try{const t=JSON.parse(d.mediaTimelineJson||'{}');return t.projectId===currentProject.id&&Array.isArray(t.scenes)?t:null}catch(_){return null}}
function publishId(){const raw=String(currentProject?.data?.publishedProductId||currentProject?.id||'');return /^[a-zA-Z0-9_-]{1,120}$/.test(raw)?raw:'';}
function check(){
 const t=timeline();if(!t?.scenes?.length)throw Error('Prépare le Cahier Média et clique « Synchroniser les diapositives » avant la compilation.');
 const bad=t.scenes.flatMap(s=>(s.slots||[]).filter(m=>m.required&&!allowedMedia(m.url)).map(m=>(s.title||s.id)+' : '+(m.label||m.kind)));
 if(bad.length)throw Error('Médias demandés sans URL HTTPS : '+bad.slice(0,12).join(' | ')+(bad.length>12?'…':''));
 const id=publishId();if(!id)throw Error('Identifiant de jeu non valide.');
 if(!String(currentProject?.data?.guidedScenesJson||'').trim())throw Error('Conducteur des diapositives manquant : synchronise le Cahier Média.');
 return {t,id};
}
window.gamePackage=function(d){
 const t=timeline(),id=publishId(),scenes=t?.scenes||[],needed=scenes.flatMap(s=>s.slots||[]).filter(m=>m.required&&!allowedMedia(m.url)),urls=scenes.reduce((n,s)=>n+(s.slots||[]).filter(m=>allowedMedia(m.url)).length,0);
 return '<h4>📦 Compilation ZIP — NyXia Game configuré</h4>'+ 
 '<div class="game-note">La coque complète de NyXia Game est incluse. Même CASHFLOW_KV, même D1, même Vectorize. Les règles MJ et les cerveaux des PNJ sont publiés séparément dans la KV centrale, jamais en fichiers publics sur GitHub.</div>'+ 
 '<div class="game-status-grid"><div class="game-status '+(scenes.length?'ready':'')+'"><strong>'+scenes.length+' scène(s)</strong> issues du Cahier Média</div><div class="game-status '+(!needed.length&&urls?'ready':'')+'"><strong>'+urls+' URL médias</strong>'+needed.length+' URL(s) requise(s) manquante(s)</div><div class="game-status"><strong>Identifiant unique</strong>'+escAttr(id||'non disponible')+'</div></div>'+ 
 '<div class="row" style="margin-top:14px"><div class="field"><label>Sous-domaine du jeu (sans https://)</label><input id="game-zip-domain" value="'+escAttr(d.gameZipDomain||'')+'" placeholder="ex. reboot.nyxia.top" onchange="setData(\'gameZipDomain\',this.value.trim().toLowerCase())"></div><div class="field"><label>Couverture : URL HTTPS externe</label><input type="url" value="'+escAttr(d.coverUrl||'')+'" placeholder="https://.../couverture.jpg" onchange="setData(\'coverUrl\',this.value)"></div></div>'+ 
 '<div class="tools-line" style="margin:12px 0"><button class="btn primary" onclick="nyxCompileGame(\'embedded\')"'+(!scenes.length||needed.length?' disabled':'')+'>📦 ZIP complet · intégrer les médias</button><button class="btn" onclick="nyxCompileGame(\'external-url\')"'+(!scenes.length||needed.length?' disabled':'')+'>🔗 ZIP léger · URL seulement</button></div>'+ 
 '<p class="tiny">ZIP complet : le navigateur récupère chaque fichier HTTPS externe une seule fois. Si l’hébergeur interdit CORS, si un fichier manque ou si la taille est excessive, la compilation s’arrête sans faux succès. ZIP léger : inclut les liens, PAS les fichiers médias. Aucune copie des médias vers Cloudflare pendant la création.</p>'+ 
 '<div id="zip-build-progress" role="status" class="game-note">Aucune compilation lancée.</div><div class="divider"></div>'+ 
 '<h4>📡 Publier la configuration privée du jeu</h4><p class="muted">Le ZIP contient le Worker et les fichiers du portail; son fonctionnement exige également le produit enregistré dans CASHFLOW_KV. Cette commande publie uniquement CE jeu dans la KV partagée via le système déjà existant, après confirmation explicite.</p>'+ 
 '<button class="btn gold" onclick="nyxPublishGame()"'+(!scenes.length||needed.length?' disabled':'')+'>🔒 Enregistrer ce jeu dans CASHFLOW_KV</button>'+ 
 '<div class="tools-line" style="margin-top:14px"><button class="btn" onclick="setGameTab(\'media\')">← Revenir aux médias</button><button class="btn" onclick="setGameTab(\'live\')">🎥 Live (existant)</button><button class="btn" onclick="setGameTab(\'control\')">🧠 Contrôle (existant)</button><button class="btn" onclick="exportGamePDF()">⬇ Dossier PDF MJ</button></div>';
};
function status(msg){const el=document.getElementById('zip-build-progress');if(el)el.textContent=msg}
function name(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,70)||'jeu'}
function extension(url,kind,type){
 const path=new URL(url).pathname;let ext=path.match(/\.(png|jpe?g|webp|gif|mp3|wav|ogg|m4a|mp4|webm)$/i)?.[1]?.toLowerCase();
 if(ext)return ext==='jpeg'?'jpg':ext;
 if(/image\/jpeg/i.test(type))return 'jpg';if(/image\/webp/i.test(type))return 'webp';if(/image\/gif/i.test(type))return 'gif';
 return kind==='image'?'png':kind==='audio'?'mp3':'mp4';
}
function mimeOkay(kind,type){return !type||type==='application/octet-stream'||kind==='image'&&/^image\/(?:png|jpeg|webp|gif)$/i.test(type)||kind==='audio'&&/^audio\/(?:mpeg|mp3|wav|wave|ogg|mp4|x-m4a|aac)$/i.test(type)||kind==='video'&&/^video\/(?:mp4|webm|quicktime)$/i.test(type)}
async function embedMedia(zip,scenes){
 const list=[],seen=new Map(),all=scenes.flatMap((s,i)=>(s.slots||[]).filter(m=>allowedMedia(m.url)).map(m=>({m,s,i})));
 let total=0;
 for(const {m,s,i} of all){
  if(seen.has(m.url)){list.push({url:m.url,path:seen.get(m.url)});continue}
  status('Téléchargement depuis l’hébergeur externe : '+(seen.size+1)+' / '+all.length+' · '+(m.label||m.kind));
  let response;try{response=await fetch(m.url,{method:'GET',mode:'cors',credentials:'omit',redirect:'follow',cache:'no-store'})}catch(_){throw Error('Téléchargement externe bloqué (CORS ou réseau) : '+m.url)}
  if(!response.ok||response.type==='opaque')throw Error('Le média n’est pas téléchargeable ('+response.status+') : '+m.url);
  const type=String(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!mimeOkay(m.kind,type))throw Error('Ce lien ne renvoie pas un fichier '+m.kind+' compatible : '+m.url+' ('+type+')');
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>80*1024*1024||total+declared>250*1024*1024)throw Error('Limite de taille du ZIP : 80 Mo par média et 250 Mo au total. Utilise le ZIP léger pour les vidéos lourdes.');
  const blob=await response.blob();if(!blob.size||blob.size>80*1024*1024||total+blob.size>250*1024*1024)throw Error('Fichier vide ou trop lourd : '+m.url);
  const ext=extension(m.url,m.kind,type),path='media/'+name(s.act).slice(0,35)+'/scene-'+String(i+1).padStart(3,'0')+'/'+name(m.id||m.label)+'.'+ext;
  zip.file(path,blob);seen.set(m.url,'/'+path);list.push({url:m.url,path:'/'+path});total+=blob.size;
 }
 return {files:list,bytes:total};
}
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
window.nyxCompileGame=async function(mode){
 if(!['embedded','external-url'].includes(mode))return;
 if(!window.JSZip)return alert('JSZip indisponible.');
 let validated;try{validated=check()}catch(err){return alert(err.message)}
 const {t,id}=validated,d=currentProject.data||{},host=String(d.gameZipDomain||'').toLowerCase().trim();
 if(!/^[a-z0-9](?:[a-z0-9.-]{1,250}[a-z0-9])$/.test(host)||!host.endsWith('.nyxia.top')||host.includes('..'))return alert('Entre le vrai sous-domaine du jeu, sans https:// (par exemple reboot.nyxia.top).');
 const projectId=currentProject.id;
 if(!confirm('Compiler NyXia Game — '+currentProject.title+' pour '+host+' ? Mode : '+(mode==='embedded'?'télécharger les médias dans le ZIP':'URL externes seulement')+'. Aucune publication automatique.'))return;
 try{
  clearTimeout(saveTimer);if(!await saveCurrent())throw Error('Impossible de sauvegarder le projet avant de compiler.');status('Lecture de la coque NyXia Game…');
  const template=await fetch('/game-shell-template.zip',{cache:'no-store'});if(!template.ok)throw Error('Coque modèle absente du Labo : /game-shell-template.zip');
  const zip=await JSZip.loadAsync(await template.blob());if(!zip.file('_worker.js')||!zip.file('jeu.html')||!zip.file('wrangler.toml'))throw Error('Coque modèle incomplète : compilation annulée.');
  if(!(await zip.file('_worker.js').async('string')).includes('NYXIA_MJ_SCOPED_BRAIN_V1'))throw Error('Coque non mise à jour : remplace uniquement _worker.js dans ton game-shell-template.zip par le fichier du correctif NyXia MJ. Tes chat... restent inchangés.');
  let media={files:[],bytes:0};if(mode==='embedded')media=await embedMedia(zip,t.scenes);
  const all=t.scenes.flatMap(s=>(s.slots||[]).filter(m=>allowedMedia(m.url)).map(m=>({sceneId:s.id,kind:m.kind,id:m.id,label:m.label,url:m.url,trigger:m.trigger,playback:m.playback,source:m.source,sourceUrl:m.sourceUrl,credit:m.credit,license:m.license})));
  zip.file('game-manifest.json',JSON.stringify({schemaVersion:2,gameId:id,title:currentProject.title,description:d.packageSubtitle||'',mediaMode:mode,mediaFiles:media.files,mediaCount:all.length,compiledAt:new Date().toISOString()},null,2));
  zip.file('data/game.json',JSON.stringify({gameId:id,title:currentProject.title,description:d.packageSubtitle||'',version:d.productVersion||'1.0',mediaMode:mode},null,2));
  zip.file('data/media-urls.json',JSON.stringify({gameId:id,scenes:t.scenes.map(s=>({id:s.id,act:s.act,title:s.title,media:(s.slots||[]).filter(m=>allowedMedia(m.url)).map(m=>({id:m.id,kind:m.kind,url:m.url,label:m.label,trigger:m.trigger,playback:m.playback}))}))},null,2));
  zip.file('.assetsignore',String(await zip.file('.assetsignore').async('string'))+'\ndata/**\n');
  const original=await zip.file('wrangler.toml').async('string'),worker='nyxiagame-'+name(id).slice(0,40);
  let cfg=original.replace(/^name\s*=\s*"[^"]*"/m,'name = "'+worker+'"')
   .replace(/^pattern\s*=\s*"[^"]*"/m,'pattern = "'+host+'"')
   .replace(/^SITE_URL\s*=\s*"[^"]*"/m,'SITE_URL = "https://'+host+'/"')
   .replace(/^GAME_ID\s*=\s*"[^"]*"/m,'GAME_ID = "'+id+'"')
   .replace(/^PORTAIL\s*=\s*"[^"]*"/m,'PORTAIL = "'+worker+'"');
  if(!cfg.includes('GAME_ID = "'+id+'"')||!cfg.includes('pattern = "'+host+'"'))throw Error('La configuration Cloudflare n’a pas pu être adaptée intégralement.');
  zip.file('wrangler.toml',cfg);
  const pdf=await makePdf(currentProject);zip.file('documents/cahier-du-joueur.pdf',pdf);
  zip.file('INSTALLATION.txt','NyXia Game — '+currentProject.title+'\n\nSous-domaine : '+host+'\nIdentifiant jeu : '+id+'\n\n1. Déployer cette coque dans le dépôt de CE jeu (sans modifier les bindings CASHFLOW_KV et DB).\n2. Dans NyXiaLabo > Compilation ZIP, cliquer « Enregistrer ce jeu dans CASHFLOW_KV ». Ce transfert privé est nécessaire : le ZIP ne contient ni secrets ni cerveaux PNJ en fichiers statiques.\n3. Configurer domaine et vérifier la connexion et les droits acheteur sur ce sous-domaine.\n4. Tester toutes les scènes, tous les lecteurs et le bouton Reprendre.\n\nMode médias : '+mode+'\n'+(mode==='embedded'?'Les vrais fichiers téléchargés sont inclus sous media/. Le Worker contrôle les visiteurs du SITE, mais tout média inclus dans un dépôt GitHub PUBLIC peut être téléchargé directement depuis GitHub. Utilise un dépôt privé pour des fichiers non publics.':'Le ZIP inclut UNIQUEMENT les liens vers tes médias externes, aucun fichier audio/image/vidéo.')+'\n\nNe jamais diffuser un ZIP contenant des secrets de maître de jeu.\n');
  if(currentProject.id!==projectId)throw Error('Le projet a changé. La compilation est annulée.');
  status('Compression et préparation du téléchargement…');const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='NyXiaGame-'+name(currentProject.title)+'-'+(mode==='embedded'?'MEDIAS-INCLUS':'URL-SEULEMENT')+'.zip';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  status('ZIP téléchargé : coque complète, '+all.length+' références URL, '+media.files.length+' fichiers multimédias réellement intégrés. Déploiement et test acheteur encore nécessaires.');
 }catch(err){status('COMPILATION NON TERMINÉE : '+err.message);alert('Compilation interrompue : '+err.message+'\nAucun ZIP incomplet n’est présenté comme terminé.');}
};
window.nyxPublishGame=async function(){
 let checkResult;try{checkResult=check()}catch(err){return alert(err.message)}
 const d=currentProject.data||{};
 if(!confirm('Enregistrer / mettre à jour le produit '+currentProject.title+' ('+checkResult.id+') dans CASHFLOW_KV partagée ? Cela rend cette configuration accessible au Worker de ce jeu pour les comptes autorisés.'))return;
 try{clearTimeout(saveTimer);if(!await saveCurrent())throw Error('Sauvegarde du projet impossible.');
 const r=await api('/api/atelier/game/publish',{method:'POST',body:JSON.stringify({projectId:currentProject.id,productId:checkResult.id,title:currentProject.title,subtitle:d.packageSubtitle||'',description:d.packageNotes||d.idea||'',coverUrl:d.coverUrl||'',version:d.productVersion||'1.0',teams:d.liveTeams||''})});
 if(!r.ok||r.product?.id!==checkResult.id)throw Error('Confirmation du serveur incorrecte.');
 currentProject.data.publishedProductId=r.product.id;markDirty();await saveCurrent();renderGame();alert('Configuration enregistrée dans CASHFLOW_KV pour '+currentProject.title+'. Déploiement et contrôle des droits d’accès acheteur non encore testés.');
 }catch(err){alert('Publication non confirmée : '+err.message)}
};
})();
