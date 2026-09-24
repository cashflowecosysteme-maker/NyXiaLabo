/* NyXia Game — ajout au DASHBORD ORIGINAL Séléna, conversations conservées. */
/* NYXIA_GAME_CUSTOM_TOOLS_V1 — outils du jeu chargés automatiquement dans la barre de gauche. */
'use strict';
var nxgState=null;
var nxgGameTools=[];
function nxgToken(){return sessionStorage.getItem('nyxia_token')||''}
async function nxgApi(endpoint,payload){let res=await fetch('/api/game/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:nxgToken(),...(payload||{})})});let raw=await res.text(),data;try{data=JSON.parse(raw)}catch(_){throw new Error('Le service ne répond pas pour le moment.')};if(!res.ok)throw new Error(data.error||'Action indisponible');return data}
function nxgOpenPanel(name){if(name==='nyxia'){openAgentTab('nyxia');return;}showPanel(name);if(name==='jeu'){const f=document.getElementById('nxg-game-frame');if(f&&f.getAttribute('src')!=='/jeu.html')f.src='/jeu.html';}if(name==='compte')nxgAccount();if(name==='carte')nxgMap();}
function nxgRoll(sides){if(![100,20,10,6,4].includes(sides))return;const x=new Uint32Array(1);const limit=Math.floor(4294967296/sides)*sides;do{crypto.getRandomValues(x)}while(x[0]>=limit);document.getElementById('nxg-dice-result').textContent='D'+sides+' : '+((x[0]%sides)+1);}
function nxgSelectNpc(id){if(!id)return;const npc=nxgState?.game?.npcs?.find(n=>n.id===id);if(!npc)return;const key='pnj-'+id;AGENT_PAGES[key]='/chat-pnj.html?npc='+encodeURIComponent(id)+'&name='+encodeURIComponent(npc.name);openAgentTab(key);}
function nxgOpenFormation(agent){openAgentTab(agent);const f=document.getElementById('agent-iframe');if(f){f.addEventListener('load',function once(){f.removeEventListener('load',once);try{f.contentWindow?.foRefreshLaunchButton?.()}catch(_){}},{once:true})}}

function nxgSafeToolPath(raw){
 try{
  const u=new URL(String(raw||''),location.origin);
  if(u.origin!==location.origin||!u.pathname.startsWith('/')||u.pathname.includes('..'))return '';
  return u.pathname+u.search+u.hash;
 }catch(_){return ''}
}
function nxgEnsureToolsUI(){
 var label=Array.from(document.querySelectorAll('.sidebar-label')).find(function(x){return x.textContent.trim()==='Outils'});
 var section=label&&label.parentElement;
 if(section&&!document.getElementById('nxg-game-tools-nav')){
  var holder=document.createElement('div');holder.id='nxg-game-tools-nav';
  var messages=document.getElementById('nav-messages');section.insertBefore(holder,messages||null);
 }
 var main=document.querySelector('.main-content');
 if(main&&!document.getElementById('panel-game-tool')){
  var panel=document.createElement('div');panel.className='panel nxg-panel';panel.id='panel-game-tool';panel.style.cssText='flex-direction:column;padding:0;overflow:hidden';
  var bar=document.createElement('div');bar.className='nxg-toolbar';
  var title=document.createElement('h2');title.id='nxg-game-tool-title';title.textContent='Outil du jeu';
  bar.appendChild(title);
  var frame=document.createElement('iframe');frame.id='nxg-game-tool-frame';frame.src='about:blank';frame.title='Outil du jeu';frame.allow='autoplay;fullscreen;microphone;camera';frame.style.cssText='width:100%;height:100%;border:0;display:block';
  panel.appendChild(bar);panel.appendChild(frame);main.appendChild(panel);
 }
}
function nxgOpenTool(id){
 const tool=nxgGameTools.find(function(x){return x.id===id});if(!tool)return;
 const path=nxgSafeToolPath(tool.path);if(!path)return;
 nxgEnsureToolsUI();
 document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
 document.querySelectorAll('.nav-item').forEach(function(n){n.classList.remove('active')});
 const panel=document.getElementById('panel-game-tool'),frame=document.getElementById('nxg-game-tool-frame'),title=document.getElementById('nxg-game-tool-title'),nav=document.getElementById('nav-game-tool-'+id);
 if(panel)panel.classList.add('active');if(nav)nav.classList.add('active');if(title)title.textContent=(tool.icon||'🧰')+' '+tool.name;
 if(frame){
  const token=nxgToken(),u=new URL(path,location.origin);if(token)u.searchParams.set('t',token);
  if(frame.getAttribute('data-tool')!==id||frame.src!==u.href){frame.setAttribute('data-tool',id);frame.src=u.href}
 }
 if(typeof closeMobileMenu==='function')closeMobileMenu();
}
function nxgRenderGameTools(){
 nxgEnsureToolsUI();
 const holder=document.getElementById('nxg-game-tools-nav');if(!holder)return;holder.replaceChildren();
 nxgGameTools.forEach(function(tool){
  const path=nxgSafeToolPath(tool.path);if(!path)return;
  const item=document.createElement('div');item.className='nav-item';item.id='nav-game-tool-'+tool.id;item.setAttribute('role','button');item.tabIndex=0;
  const icon=document.createElement('span');icon.className='nav-icon';icon.textContent=tool.icon||'🧰';
  const txt=document.createElement('span');txt.className='nav-text';
  const name=document.createElement('span');name.className='nav-name';name.textContent=tool.name||'Outil';
  const sub=document.createElement('span');sub.className='nav-sub';sub.textContent='Outil du jeu';
  txt.appendChild(name);txt.appendChild(sub);
  const arrow=document.createElement('span');arrow.className='nav-arrow';arrow.textContent='›';
  item.appendChild(icon);item.appendChild(txt);item.appendChild(arrow);
  const open=function(){nxgOpenTool(tool.id)};item.addEventListener('click',open);item.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();open()}});
  holder.appendChild(item);
 });
}
async function nxgLoadGameTools(){
 try{
  const r=await fetch('/game-tools.json',{cache:'no-store'});
  if(!r.ok){nxgGameTools=[];nxgRenderGameTools();return}
  const d=await r.json(),items=Array.isArray(d?.tools)?d.tools:[];
  nxgGameTools=items.slice(0,24).map(function(x,i){
   const path=nxgSafeToolPath(x?.path);if(!path)return null;
   return {id:String(x?.id||('tool-'+i)).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||('tool-'+i),name:String(x?.name||'Outil').slice(0,100),icon:String(x?.icon||'🧰').slice(0,8),path:path};
  }).filter(Boolean);
  nxgRenderGameTools();
 }catch(_){nxgGameTools=[];nxgRenderGameTools()}
}
async function nxgInit(){try{nxgState=await nxgApi('config');const p=nxgState.game;if(p){document.title='NyXia Game | '+p.title;const nav=document.getElementById('nxg-title-nav'),h=document.getElementById('nxg-game-title');if(nav)nav.textContent=p.title;if(h)h.textContent=p.title;const badge=document.querySelector('.btn-pro');if(badge)badge.textContent='🎲 NyXia Game | '+p.title;}const select=document.getElementById('nxg-npc-picker');select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent=p?.npcs?.length?'Choisis un personnage':'Aucun PNJ pour le moment';select.appendChild(empty);(p?.npcs||[]).forEach(n=>{const opt=document.createElement('option');opt.value=n.id;opt.textContent=n.name;select.appendChild(opt)});const badge=document.getElementById('nxg-corner');if(p&&nxgState.owned){badge.hidden=false;badge.textContent='✅ Jeu acheté · Accès actif';}else if(p&&!nxgState.allowed){badge.hidden=false;badge.textContent='❎ Accès indisponible';}else if(badge)badge.hidden=true;await nxgLoadGameTools();}catch(e){console.warn('NyXia Game',e.message)}}
async function nxgOpenResource(kind){nxgOpenPanel('ressource');const body=document.getElementById('nxg-resource-body'),title=document.getElementById('nxg-resource-title');title.textContent=kind==='materials'?'Matériel':'Informations du jeu';body.textContent='Chargement...';try{const d=await nxgApi('resource',{kind});title.textContent=d.title;body.textContent=d.text||'Ce contenu sera ajouté lors de la compilation.';}catch(e){body.textContent=e.message}}
function nxgMap(){const body=document.getElementById('nxg-map-content');body.replaceChildren();const url=nxgState?.game?.map;if(url){try{const u=new URL(url,location.href);if(['https:','http:'].includes(u.protocol)){const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener';a.textContent='Ouvrir la carte du jeu';body.appendChild(a);return}}catch(_){}}body.textContent='La carte apparaîtra avec ce jeu.'}
function nxgCard(title){const box=document.createElement('section');box.className='nxg-card';const h=document.createElement('h3');h.textContent=title;box.appendChild(h);return box}
function nxgLine(node,text){const p=document.createElement('p');p.textContent=text;node.appendChild(p);return p}
function nxgLink(node,label,url){if(!url)return;try{const u=new URL(url);if(!['https:','http:'].includes(u.protocol))return;const a=document.createElement('a');a.href=u.href;a.target='_blank';a.rel='noopener';a.textContent=label;node.appendChild(a)}catch(_){}}
async function nxgAccount(){const root=document.getElementById('nxg-account-content');root.textContent='Chargement...';try{nxgState=await nxgApi('config');root.replaceChildren();const p=nxgState.game;const games=nxgCard('Mes jeux');nxgLine(games,p?p.title:'Nom du jeu à venir');nxgLine(games,p?(nxgState.owned?'✅ Jeu acheté':'Accès au jeu disponible selon ton compte'):'Aucun jeu compilé pour le moment.');root.appendChild(games);const links=nxgCard('Boutique et répertoire');nxgLink(links,'Boutique',nxgState.shopUrl);if(nxgState.shopUrl&&nxgState.directoryUrl)nxgLine(links,' · ');nxgLink(links,'Répertoire',nxgState.directoryUrl);if(!nxgState.shopUrl&&!nxgState.directoryUrl)nxgLine(links,'Retrouve ces liens dans ton univers NyXia.');root.appendChild(links);const sales=nxgCard('Ventes Promoteur');if(nxgState.sales?.length)nxgState.sales.forEach(s=>nxgLine(sales,(Number(s.amount)||0).toFixed(2)+' '+(s.currency||'CAD')+' · Vente confirmée'));else nxgLine(sales,'Aucune vente confirmée disponible pour ce jeu.');root.appendChild(sales);const event=nxgCard('Mes événements payants');const form=document.createElement('form');form.style.cssText='display:grid;gap:5px';const labels=[['name','Nom de la soirée','text'],['date','Date','date'],['people','Participants','number'],['revenue','Revenus déclarés (CAD)','number']];for(const [name,label,type]of labels){const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.name=name;input.type=type;input.required=true;if(type==='number'){input.min='0';input.step=name==='people'?'1':'0.01'}l.appendChild(input);form.appendChild(l)}const save=document.createElement('button');save.type='submit';save.textContent='Enregistrer ma soirée';save.disabled=!p;form.appendChild(save);const status=document.createElement('p');form.appendChild(status);form.onsubmit=async e=>{e.preventDefault();save.disabled=true;const data=Object.fromEntries(new FormData(form));try{await nxgApi('events',{action:'add',...data});status.textContent='Soirée enregistrée.';nxgAccount();}catch(err){status.textContent=err.message;save.disabled=false}};event.appendChild(form);(nxgState.events||[]).slice().reverse().forEach(x=>nxgLine(event,x.date+' · '+x.name+' · '+x.people+' personnes · '+Number(x.revenue).toFixed(2)+' CAD'));root.appendChild(event);}catch(e){root.textContent=e.message}}
window.nxgInit=nxgInit;window.nxgOpenPanel=nxgOpenPanel;window.nxgRoll=nxgRoll;window.nxgSelectNpc=nxgSelectNpc;window.nxgOpenFormation=nxgOpenFormation;window.nxgOpenResource=nxgOpenResource;window.nxgOpenTool=nxgOpenTool;
