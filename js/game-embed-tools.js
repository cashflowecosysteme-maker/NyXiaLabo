/* NyXiaLabo — extensions légères pour NyXia Game.
 * - Les présentations Canva sont maintenant un vrai type de média géré par game-media-url-editor.js.
 * - Outils internes propres à chaque jeu, injectés automatiquement à la compilation.
 */
(function(){
'use strict';
function toolEsc(v){return typeof esc==='function'?esc(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function cleanToolPath(v){v=String(v||'').trim();if(!/^\/(?!\/)/.test(v)||v.includes('..')||/^[a-z]+:/i.test(v))return '';return v.slice(0,700)}
function toolsList(){var d=currentProject&&currentProject.data||{};return Array.isArray(d.gameTools)?d.gameTools:[]}
function saveTools(list){if(!currentProject)return;currentProject.data=currentProject.data||{};currentProject.data.gameTools=list.slice(0,24);if(typeof markDirty==='function')markDirty();if(typeof renderGame==='function')renderGame()}
window.nyxGameToolAdd=function(){
 var list=toolsList().slice();if(list.length>=24)return alert('Maximum 24 outils pour un jeu.');
 list.push({id:'outil-'+crypto.randomUUID().replace(/-/g,'').slice(0,16),name:'Nouvel outil',icon:'🧰',path:''});saveTools(list)
}
window.nyxGameToolSet=function(i,field,value){
 var list=toolsList().map(function(x){return Object.assign({},x)}),x=list[i];if(!x)return;
 if(field==='path'){value=String(value||'').trim();if(value&&!cleanToolPath(value))return alert('Utilise uniquement une page de CE portail, par exemple /ovilus.html. Les sites externes ne sont pas acceptés.');x.path=value}
 else if(field==='icon')x.icon=String(value||'🧰').slice(0,8);
 else if(field==='name')x.name=String(value||'').slice(0,100);
 saveTools(list)
}
window.nyxGameToolRemove=function(i){var list=toolsList().slice();if(!list[i])return;if(!confirm('Retirer cet outil de CE jeu ? La page elle-même ne sera pas supprimée.'))return;list.splice(i,1);saveTools(list)}
function toolsPanel(){
 var list=toolsList(),rows='';
 list.forEach(function(x,i){
  rows += '<div class="row" style="align-items:end;margin:8px 0">'
    + '<div class="field"><label>Emoji</label><input value="'+toolEsc(x.icon||'🧰')+'" oninput="nyxGameToolSet('+i+',&quot;icon&quot;,this.value)"></div>'
    + '<div class="field"><label>Nom</label><input value="'+toolEsc(x.name||'')+'" oninput="nyxGameToolSet('+i+',&quot;name&quot;,this.value)"></div>'
    + '<div class="field" style="flex:2"><label>Page du portail</label><input value="'+toolEsc(x.path||'')+'" placeholder="/ovilus.html" onchange="nyxGameToolSet('+i+',&quot;path&quot;,this.value)"></div>'
    + '<button class="btn danger" type="button" onclick="nyxGameToolRemove('+i+')">✕</button></div>';
 });
 return '<div class="panel" style="margin-bottom:14px;border-color:rgba(167,139,250,.45)"><h4>🧰 Outils de CE jeu</h4>'
  + '<p class="muted">Ajoute ici seulement des pages qui font partie de ton propre portail. À la compilation, elles apparaîtront automatiquement sous <b>Outils</b> dans la barre de gauche et s’ouvriront à l’intérieur du portail en iframe.</p>'
  + rows
  + '<button class="btn gold" type="button" onclick="nyxGameToolAdd()">+ Ajouter un outil au jeu</button></div>';
}
function install(){
 if(typeof window.gamePackage==='function'&&!window.gamePackage.__nyxiaToolsWrapped){
  var originalPackage=window.gamePackage;
  var wrappedPackage=function(d){return toolsPanel()+originalPackage(d)};wrappedPackage.__nyxiaToolsWrapped=true;window.gamePackage=wrappedPackage;
 }
}
install();
setTimeout(install,0);
})();
