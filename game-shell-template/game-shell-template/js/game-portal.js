/* NyXia Game — réception du jeu compilé.
 * Aucune clé, aucun cerveau de MJ ni secret dans cette page.
 * L'autorisation doit TOUJOURS être contrôlée à nouveau par le Worker sur chaque ressource/API.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=String(text); if(className)n.className=className; return n; };
  const context = {manifest:null, allowed:false, access:null, account:null, currentView:'home', chatNode:null, chatParent:null, gameURL:null, eventWrite:false};
  const api = {access:'/api/game/access', account:'/api/game/account', events:'/api/game/events'};
  const isLocal = ['localhost','127.0.0.1'].includes(location.hostname);
  const preview = isLocal && new URLSearchParams(location.search).get('preview') === '1';
  const label = (key, text) => { const n=$(key); if(n)n.textContent=text; };

  function safeURL(value) {
    if(typeof value!=='string'||!value.trim())return null;
    try {
      const u=new URL(value, location.href);
      if(!['https:','http:'].includes(u.protocol))return null;
      if(u.origin===location.origin)return u.href;
      if(u.protocol!=='https:')return null;
      const allowed=context.manifest && Array.isArray(context.manifest.allowedOrigins)?context.manifest.allowedOrigins:[];
      if(allowed.some(origin=>{try{return new URL(origin).origin===u.origin && origin.startsWith('https://')}catch{return false}}))return u.href;
      return null;
    } catch {return null;}
  }
  function gameId(){return context.manifest?.gameId||'';}
  function showNotice(message,isError=false){const n=$('setup-notice');n.textContent=message;n.classList.toggle('warning',isError);}
  function accessStatus() {
    const n=$('corner-status');n.replaceChildren();
    const title=el('b',preview?'APERÇU LOCAL — pas de paiement vérifié':context.allowed?'✅ Jeu acheté — accès actif':context.access?.status==='expired'?'❎ Accès désactivé':'Jeu acheté : statut à vérifier');
    title.className=preview?'':context.allowed?'ok':context.access?.status==='expired'?'fail':'';
    n.append(title,el('small',preview?'Maquette visuelle uniquement':context.allowed?'Droits vérifiés par le serveur':context.access?.status==='expired'?'Mensualité ou droit expiré':'Aucune preuve de paiement reçue'));
  }
  function view(name, origin=null) {
    const valid=['home','chat','game','npcs','map','account'];if(!valid.includes(name))return;
    context.currentView=name;
    document.querySelectorAll('[data-screen]').forEach(p=>p.classList.toggle('active',p.dataset.screen===name));
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b===origin || (!origin&&b.dataset.view===name)));
    if(name==='game')openGame();
    if(name==='map')openMap();
    if(name==='account')loadAccount();
    $('main').scrollIntoView({behavior:'auto',block:'start'});
  }
  function manifestText() {
    const m=context.manifest;
    const title=m?.title||'Jeu non compilé';
    label('side-game-title',title);label('page-title','NyXia Game | '+title);
    label('page-subtitle',m?.universe||'Un portail individuel pour un jeu compilé');
    label('home-heading',title);label('home-description',m?.description||'La compilation fournira l’histoire, les médias, les personnages et les liens de ce jeu.');
    label('hero-game-title',title);label('hero-game-text',m?.description||'Le parcours jouable sera reçu depuis le Worker de ce jeu.');
    label('nav-game-name',m?.shortTitle||title);label('game-page-title',title);
    document.title='NyXia Game | '+title;
  }
  function resource(name) {
    const m=context.manifest||{};
    if(!context.allowed){showNotice('Accès à ce jeu non vérifié. Aucun matériel protégé n’est ouvert.',true);return;}
    const u=safeURL((m.resources||{})[name]);
    if(!u){showNotice('Cette ressource n’a pas encore été livrée par la compilation : '+name+'.',true);return;}
    window.open(u,'_blank','noopener,noreferrer');
  }
  function showAgent(name, button=null, npc=null) {
    const m=context.manifest||{};
    const agent=npc||((m.conversations||{})[name]);
    const display=npc?.name||({nyxia:'NyXia',diane:'Diane',eric:'Éric'}[name]||name);
    label('chat-title',display);label('chat-subtitle',npc?'Personnage du jeu · Conversation destinée au MJ':name==='nyxia'?'Informations du jeu · MJ solo':name==='diane'?'Univers NyXia et mini-formation diffusion':'Cercle d’entraide et rentabilisation');
    const url=safeURL(typeof agent==='string'?agent:agent?.url);
    const frame=$('chat-frame');
    if(context.chatNode&&context.chatNode.parentElement===$('dialog-frame-mount'))closeFullScreen();
    if(context.allowed&&url){
      frame.hidden=false;$('chat-empty').hidden=true;frame.src=url;
      $('chat-fullscreen-btn').disabled=false;
    }else{
      frame.removeAttribute('src');frame.hidden=true;$('chat-empty').hidden=false;
      $('chat-empty').replaceChildren(el('b',!context.allowed?'Accès non vérifié':'Conversation non compilée'),document.createTextNode(!context.allowed?'Connexion et licence requises.':'Le lien de ce personnage doit être fourni par la compilation.'));
      $('chat-fullscreen-btn').disabled=true;
    }
    view('chat',button);
  }
  function openGame() {
    const u=safeURL(context.manifest?.pages?.game);
    context.gameURL=u;
    const ok=context.allowed&&!!u;
    $('game-empty').hidden=ok;$('game-frame').hidden=!ok;$('game-newtab-btn').disabled=!ok;
    if(ok&&$('game-frame').getAttribute('src')!==u)$('game-frame').src=u;
    if(!ok)$('game-frame').removeAttribute('src');
    if(!ok)$('game-empty').replaceChildren(el('b',context.allowed?'Page de jeu absente':'Jeu non accessible'),document.createTextNode(context.allowed?'La compilation doit fournir la page des slides et médias.':'La licence doit être vérifiée par le Worker avant de charger les médias.'));
  }
  function openMap() {
    const u=safeURL(context.manifest?.resources?.map);
    const ok=context.allowed&&!!u;
    $('map-empty').hidden=ok;$('map-frame').hidden=!ok;
    if(ok&&$('map-frame').getAttribute('src')!==u)$('map-frame').src=u;
    if(!ok)$('map-frame').removeAttribute('src');
  }
  function npcs() {
    const select=$('npc-picker');select.replaceChildren(el('option','Choisis un PNJ du jeu'));select.firstChild.value='';
    const entries=Array.isArray(context.manifest?.npcs)?context.manifest.npcs.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string'&&x.id):[];
    for(const npc of entries){const opt=el('option',npc.name);opt.value=npc.id;select.append(opt);}
    $('npc-info').textContent=entries.length?entries.length+' PNJ reçus depuis la compilation de ce jeu. Le MJ choisit qui intervient.':'Aucun PNJ n’a encore été fourni par la compilation.';
    $('npc-open').disabled=!context.allowed||!entries.length;
  }
  function randomRoll(sides){
    // Rejection sampling : aucun biais modulo, y compris pour D100.
    const max=0x100000000,limit=max-(max%sides),buffer=new Uint32Array(1);
    do{crypto.getRandomValues(buffer)}while(buffer[0]>=limit);
    return buffer[0]%sides+1;
  }
  function roll(button){
    const sides=Number(button.dataset.die);if(![100,20,10,6,4].includes(sides))return;
    button.classList.remove('rolling');void button.offsetWidth;button.classList.add('rolling');
    const value=randomRoll(sides);label('dice-result',`D${sides} → ${value} · Résultat local (non transmis au moteur du jeu)`);
    setTimeout(()=>button.classList.remove('rolling'),700);
  }
  function closeFullScreen(){
    if(!context.chatNode)return;
    $('chat-dialog').hidden=true;
    if(context.chatParent)context.chatParent.append(context.chatNode);
    context.chatNode=null;context.chatParent=null;
    $('chat-fullscreen-btn').focus();
  }
  function fullScreen(){
    const frame=$('chat-frame');if(frame.hidden||!frame.src)return;
    context.chatNode=frame;context.chatParent=frame.parentElement;
    label('dialog-name',$('chat-title').textContent);
    $('dialog-frame-mount').append(frame);$('chat-dialog').hidden=false;$('close-fullscreen').focus();
  }
  async function requestJSON(url,options={}){
    let token='';try{token=sessionStorage.getItem('nyxia_token')||''}catch{}
    const headers={'Accept':'application/json',...(options.body?{'Content-Type':'application/json'}:{}),...(token?{'Authorization':'Bearer '+token}:{})};
    const res=await fetch(url,{...options,headers,credentials:'same-origin',cache:'no-store'});
    if(!res.ok)throw Error('HTTP '+res.status);
    return res.json();
  }
  async function loadManifest(){
    try{
      const res=await fetch('/game-manifest.json',{cache:'no-store'});
      if(!res.ok)throw Error('HTTP '+res.status);
      const m=await res.json();
      if(m.schemaVersion!==1||!m.gameId||!m.title)throw Error('gameId ou titre manquant');
      context.manifest=m;manifestText();npcs();
      showNotice('Fiche du jeu reçue. Vérification des droits en cours…');
    }catch(err){context.manifest=null;manifestText();npcs();showNotice('Aucun jeu compilé n’est encore raccordé. Configuration : '+err.message,true);}
  }
  async function loadAccess(){
    if(!gameId()){accessStatus();return;}
    if(preview){context.allowed=true;context.access={status:'preview'};showNotice('APERÇU LOCAL SEULEMENT — licence et paiement NON vérifiés. Ne jamais utiliser ce mode pour une vente.');accessStatus();npcs();return;}
    try{
      const result=await requestJSON(api.access+'?gameId='+encodeURIComponent(gameId()));
      context.access=result;
      context.allowed=result?.allowed===true&&result?.gameId===gameId()&&result?.status==='active';
      showNotice(context.allowed?'Accès à ce jeu confirmé.':'Accès non accordé. Vérifie le paiement et les droits du jeu.',!context.allowed);
    }catch(err){context.allowed=false;showNotice('Droits non vérifiés : l’API Cloudflare d’accès n’est pas raccordée ou ne répond pas ('+err.message+').',true);}
    accessStatus();npcs();
    if(context.currentView==='game')openGame();
    if(context.currentView==='map')openMap();
  }
  function accountGames(games){
    const box=$('account-games');box.replaceChildren();
    if(!Array.isArray(games)||!games.length){box.textContent='Aucun jeu confirmé reçu depuis le serveur.';return;}
    const table=el('table',undefined,'table');const header=el('tr');['Jeu','Mensualité / accès'].forEach(t=>header.append(el('th',t)));table.append(header);
    for(const game of games){const row=el('tr');row.append(el('td',game.title||'Jeu'),el('td',game.accessActive?'✅ Actif':'❎ Désactivé'));table.append(row)}
    box.append(table);
  }
  function accountSales(sales){
    const box=$('account-sales');box.replaceChildren();
    if(!Array.isArray(sales)||!sales.length){box.textContent='Aucune vente Promoteur confirmée reçue.';return;}
    const table=el('table',undefined,'table');for(const sale of sales){const row=el('tr');row.append(el('td',sale.label||'Vente confirmée'),el('td',String(sale.commissionCAD??'—')+' $ CAD'));table.append(row)}box.append(table);
  }
  function accountEvents(events){
    const box=$('account-events');box.replaceChildren();
    if(!Array.isArray(events)||!events.length){box.textContent='Aucun événement déclaré reçu.';return;}
    const table=el('table',undefined,'table');for(const event of events){const row=el('tr');row.append(el('td',event.title||'Événement'),el('td',event.date||'—'),el('td',String(event.revenueCAD??'—')+' $ CAD · déclaré'));table.append(row)}box.append(table);
  }
  async function loadAccount(){
    if(!context.allowed||preview){$('account-games').textContent=preview?'Prévisualisation : aucune vente ni licence réelle.':'Droits non vérifiés.';return;}
    try{
      const a=await requestJSON(api.account+'?gameId='+encodeURIComponent(gameId()));
      if(a?.gameId!==gameId())throw Error('jeu incorrect dans la réponse');
      context.account=a;context.eventWrite=a.eventWriteEnabled===true;
      accountGames(a.games);accountSales(a.sales);accountEvents(a.events);
      $('event-save').disabled=!context.eventWrite;
      label('event-status',context.eventWrite?'Enregistrement dans le compte sécurisé.':'Écriture des événements non activée sur le serveur.');
    }catch(err){$('account-games').textContent='Données du compte indisponibles ('+err.message+').';$('event-save').disabled=true;context.eventWrite=false;}
  }
  async function saveEvent(ev){
    ev.preventDefault();if(!context.allowed||!context.eventWrite||preview)return;
    const form=ev.currentTarget,values=new FormData(form);
    const payload={gameId:gameId(),title:String(values.get('title')||'').trim(),date:String(values.get('date')||''),people:Number(values.get('people')),revenueCAD:Number(values.get('revenue'))};
    if(!payload.title||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(payload.date)||!Number.isInteger(payload.people)||payload.people<0||!Number.isFinite(payload.revenueCAD)||payload.revenueCAD<0){label('event-status','Saisis des données valides.');return;}
    $('event-save').disabled=true;
    try{await requestJSON(api.events,{method:'POST',body:JSON.stringify(payload)});form.reset();label('event-status','Enregistré par le serveur.');await loadAccount()}
    catch(err){label('event-status','Événement non enregistré : '+err.message);$('event-save').disabled=!context.eventWrite;}
  }
  function wire(){
    document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>view(b.dataset.view,b)));
    document.querySelectorAll('[data-agent]').forEach(b=>b.addEventListener('click',()=>showAgent(b.dataset.agent,b)));
    document.querySelectorAll('[data-resource]').forEach(b=>b.addEventListener('click',()=>resource(b.dataset.resource)));
    document.querySelectorAll('[data-die]').forEach(b=>b.addEventListener('click',()=>roll(b)));
    $('npc-picker').addEventListener('change',()=>{$('npc-open').disabled=!context.allowed||!$('npc-picker').value});
    $('npc-open').addEventListener('click',()=>{const n=(context.manifest?.npcs||[]).find(x=>x.id===$('npc-picker').value);if(n)showAgent(n.id,null,n)});
    $('chat-fullscreen-btn').addEventListener('click',fullScreen);$('close-fullscreen').addEventListener('click',closeFullScreen);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('chat-dialog').hidden)closeFullScreen()});
    $('game-newtab-btn').addEventListener('click',()=>{if(context.allowed&&context.gameURL)window.open(context.gameURL,'_blank','noopener,noreferrer')});
    $('event-form').addEventListener('submit',saveEvent);
    $('logout-btn').addEventListener('click',()=>{sessionStorage.removeItem('nyxia_token');location.assign('/login.html')});
  }
  async function main(){wire();await loadManifest();await loadAccess();accessStatus();}
  document.addEventListener('DOMContentLoaded',main);
})();
