/* NyXiaLabo — moteur de dialogues réutilisable. Aucune API, aucun TTS, aucune mutation du manuscrit.
   Extractions IA = propositions dont les segments sont retrouvés littéralement dans la source.
   Le classement consomme exclusivement le document 1 réimporté et validé. */
(function(root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  root.NyXiaDialogueCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function nl(s) { return String(s == null ? '' : s).replace(/\r\n?/g, '\n'); }
  function heading(line) {
    var m = line.match(/^\s*(?:\\?#){1,6}\s+(.+?)\s*$/);
    return m ? m[1].replace(/\\([#*_-])/g, '$1').trim() : '';
  }
  function isAct(h) { return /^acte\b/i.test(h); }
  function isChapter(h) { return /^chapitre\b/i.test(h); }
  function lineAt(src, pos) { return src.slice(0, pos).split('\n').length; }
  function scan(source) {
    var s=nl(source), lines=s.split('\n'), candidates=[], act='Sans acte', chapter='Sans chapitre', pos=0;
    lines.forEach(function(line, n) {
      var h=heading(line);
      if (h && isAct(h)) {act=h; chapter='Sans chapitre';}
      if (h && isChapter(h)) chapter=h;
      if (!h) {
        var dash=line.match(/^(\s*[—–]\s*)(\S[\s\S]*)$/u);
        var named=line.match(/^\s*([^:«»]{1,100}?)\s*:\s*«([^»]+)»\s*$/u);
        if (dash || named) {
          var offset=dash?dash[1].length:line.indexOf('«')+1;
          candidates.push({start:pos+offset, end:pos+line.length, line:n+1, act:act,chapter:chapter,
            sourceText:line, kind:dash?'dash':'named',character:named?named[1].trim():'',
            hint:named?named[2]:'',rawStart:pos,rawEnd:pos+line.length});
        } else if (/«[^»]+»/.test(line)) {
          var re=/«([^»]+)»/g, m;
          while((m=re.exec(line)))candidates.push({start:pos+m.index+1,end:pos+m.index+m[0].length-1,
            line:n+1,act:act,chapter:chapter,sourceText:line,kind:'citation-incertaine',
            character:'',hint:m[1],rawStart:pos,rawEnd:pos+line.length});
        }
      }
      pos+=line.length+1;
    });
    return candidates;
  }
  function makeChunks(source, max) {
    var s=nl(source),limit=max||7900, blocks=[],last=0,act='Sans acte',chapter='Sans chapitre';
    // Chaque caractère du manuscrit appartient à un bloc, sans couper un paragraphe si possible.
    var lines=s.split('\n'), pos=0, starts=[];
    lines.forEach(function(line){var h=heading(line);if(h&&(isAct(h)||isChapter(h)))starts.push(pos);pos+=line.length+1;});
    starts=Array.from(new Set([0].concat(starts).concat([s.length]))).sort(function(a,b){return a-b});
    function append(a,b){
      var text=s.slice(a,b);if(!text.trim())return;
      var pre=s.slice(0,a).split('\n');var ha='Sans acte',hc='Sans chapitre';
      pre.forEach(function(l){var h=heading(l);if(isAct(h)){ha=h;hc='Sans chapitre';}if(isChapter(h))hc=h;});
      blocks.push({start:a,end:b,text:text,act:ha,chapter:hc});
    }
    for(var i=0;i<starts.length-1;i++){
      var a=starts[i],end=starts[i+1];
      while(end-a>limit){
        var preferred=s.lastIndexOf('\n\n',a+limit),cut=preferred>a+Math.floor(limit/3)?preferred+2:s.lastIndexOf('\n',a+limit);
        if(cut<=a+Math.floor(limit/3))cut=a+limit;
        append(a,cut);a=cut;
      }
      append(a,end);
    }
    return blocks;
  }
  function exactSegments(source, parts, from, to) {
    var s=nl(source), cursor=Number(from)||0, end=to==null?s.length:to, located=[];
    if(!Array.isArray(parts)||!parts.length)return null;
    for(var i=0;i<parts.length;i++){
      var p=parts[i]; if(typeof p!=='string'||!p.length)return null;
      var j=s.indexOf(p,cursor);if(j<0||j+p.length>end)return null;
      located.push({start:j,end:j+p.length,text:p});cursor=j+p.length;
    }
    return located;
  }
  function speechFromSegments(source, segments) {
    var s=nl(source);return segments.map(function(p){return s.slice(p.start,p.end)}).join(' ');
  }
  function acceptAI(source, chunks, responses, makeId) {
    var s=nl(source),rows=[],rejections=[],next=0,matchCount=0;
    chunks.forEach(function(block,bi){
      var response=responses[bi],entries=response&&response.entries;
      if(!Array.isArray(entries)){rejections.push('Bloc '+(bi+1)+' : réponse sans entries');return;}
      var cursor=block.start;
      entries.forEach(function(entry,ei){
        var pieces=entry&&entry.segments;
        if(!Array.isArray(pieces)&&typeof entry.text==='string')pieces=[entry.text];
        var spans=exactSegments(s,pieces,cursor,block.end);
        if(!spans){rejections.push('Bloc '+(bi+1)+', entrée '+(ei+1)+' : paroles absentes ou modifiées dans le manuscrit');return;}
        // En cas d'entrées non triées, conserver un signal d'échec au lieu de trier silencieusement.
        var start=spans[0].start,stop=spans[spans.length-1].end,pre=s.slice(block.start,start).split('\n');
        var act=block.act,chapter=block.chapter;
        pre.forEach(function(line){var h=heading(line);if(isAct(h)){act=h;chapter='Sans chapitre';}if(isChapter(h))chapter=h;});
        var context=s.slice(Math.max(0,start-1200),Math.min(s.length,stop+1000));
        var actor=typeof entry.character==='string'?entry.character.trim():'';
        var raw=s.slice(start,stop);
        rows.push({id:makeId(),act:act,chapter:chapter,character:actor,text:speechFromSegments(s,spans),
          sourceText:raw,sourceLine:lineAt(s,start),sourceStart:start,sourceEnd:stop,
          sourceSegments:spans.map(function(x){return {start:x.start,end:x.end};}),
          contextBefore:s.slice(Math.max(0,start-400),start),contextAfter:s.slice(stop,Math.min(s.length,stop+400)),
          needsReview:true,reviewedDocument:false,sourceMethod:'IA vérifiée littéralement',
          sourceKey:'span:'+start+':'+stop});
        cursor=stop;matchCount++;
      });
    });
    rows.sort(function(a,b){return a.sourceStart-b.sourceStart});
    var candidates=scan(s),uncovered=candidates.filter(function(c){return !rows.some(function(r){return r.sourceStart<c.rawEnd&&r.sourceEnd>c.rawStart})});
    return {rows:rows,rejections:rejections,uncovered:uncovered,candidates:candidates.length,accepted:matchCount};
  }
  function fallback(source,filename,makeId) {
    var s=nl(source),candidates=scan(s);
    return candidates.map(function(c){
      var raw=s.slice(c.rawStart,c.rawEnd),txt='';
      if(c.kind==='named')txt=c.hint;
      else if(c.kind==='citation-incertaine')txt=c.hint;
      else {
        // Le tiret introduit un CANDIDAT, pas une transcription certifiée :
        // tant que l'IA ou Diane ne l'a pas isolé, aucune narration n'est exportée.
        txt='';
      }
      return {id:makeId(),character:c.character,act:c.act,chapter:c.chapter,text:txt,
        sourceText:raw,sourceFile:filename,sourceLine:c.line,sourceStart:c.start,sourceEnd:c.end,
        sourceKey:filename+'|'+c.start+'|'+c.end,sourceMethod:'Repérage provisoire',
        needsReview:true,reviewedDocument:false,ambiguous:c.kind==='citation-incertaine'||txt.length===0,
        contextBefore:s.slice(Math.max(0,c.rawStart-450),c.rawStart),
        contextAfter:s.slice(c.rawEnd,Math.min(s.length,c.rawEnd+450))};
    });
  }
  function actorInfo(name) {
    var actual=String(name||'').trim(),m=actual.match(/^(.*?)\s*\(([^()]*)\)\s*$/u);
    var primary=m?m[1].trim():actual;
    var secondary=/^(?:voix\b|narrat(?:eur|rice)\b|entit[ée]\b)/iu.test(primary);
    return {primary:primary,variant:m?m[2].trim():'',secondary:secondary};
  }
  function validateRows(rows) {
    var ids=new Set();
    (rows||[]).forEach(function(r,i){
      if(!r||!r.id||ids.has(r.id))throw Error('ID absent ou répété à la réplique '+(i+1));
      if(!r.character||!String(r.text||'').trim())throw Error('Personnage ou parole manquant à la réplique '+(i+1));
      ids.add(r.id);
    });
    return ids.size;
  }
  function group(rows) {
    var total=validateRows(rows),groups=[],known=new Map(),secondary=[];
    rows.forEach(function(r,i){
      var info=actorInfo(r.character),container=info.secondary?secondary:groups,grp=known.get((info.secondary?'secondary:':'actor:')+info.primary);
      if(!grp){grp={name:info.primary,secondary:info.secondary,items:[]};known.set((info.secondary?'secondary:':'actor:')+info.primary,grp);container.push(grp);}
      grp.items.push({row:r,index:i+1,variant:info.variant});
    });
    var result=groups.concat(secondary);
    var flattened=result.flatMap(function(g){return g.items;});
    if(flattened.length!==total||new Set(flattened.map(function(x){return x.row.id})).size!==total)
      throw Error('Contrôle bloquant : le classement a perdu ou dupliqué des répliques.');
    flattened.forEach(function(x){if(x.row.text!==rows[x.index-1].text)throw Error('Texte modifié pendant le classement.');});
    return {groups:result,total:total,characters:groups.length,secondary:secondary.length};
  }
  function document1(rows,title){
    var md='# '+(title||'Projet')+' — DOCUMENT 1 · DIALOGUES À VALIDER\n\n';var act='',chapter='';
    rows.forEach(function(r,i){
      if((r.act||'Sans acte')!==act){act=r.act||'Sans acte';chapter='';md+='## '+act+'\n\n';}
      if((r.chapter||'Sans chapitre')!==chapter){chapter=r.chapter||'Sans chapitre';md+='['+chapter+']\n\n';}
      md+=(r.character||'À attribuer')+' : «'+String(r.text||'')+'»\n';
      md+='<!-- NYXIA-REPLIQUE-ID:'+r.id+' -->\n';
      md+='<!-- Provenance : '+String(r.sourceFile||'saisie manuelle').replace(/-->/g,'')+' ; ligne '+(r.sourceLine||'?')+' -->\n\n';
    });
    return md;
  }
  function parseDocument1(doc) {
    var lines=nl(doc).split('\n'),out=[],act='Sans acte',chapter='Sans chapitre',pending=null;
    lines.forEach(function(line,n){
      var a=line.match(/^##\s+(.+?)\s*$/),c=line.match(/^###\s+(.+?)\s*$/)||line.match(/^\[(Chapitre[^\]]+)\]\s*$/i);
      if(a){if(pending)throw Error('ID manquant avant la ligne '+(n+1));act=a[1];chapter='Sans chapitre';return;}
      if(c){if(pending)throw Error('ID manquant avant la ligne '+(n+1));chapter=c[1];return;}
      var id=line.match(/^<!-- NYXIA-REPLIQUE-ID:([a-zA-Z0-9_-]+) -->\s*$/);
      if(id){if(!pending)throw Error('ID isolé ligne '+(n+1));pending.id=id[1];out.push(pending);pending=null;return;}
      if(!pending){
        var m=line.match(/^(.+?)\s*:\s*«([\s\S]*)»\s*$/u);
        if(m){pending={id:'',character:m[1].trim()==='À attribuer'?'':m[1].trim(),text:m[2],act:act,chapter:chapter};return;}
      }else if(line.trim())throw Error('Format de dialogue inattendu ligne '+(n+1)+'. Place chaque réplique sur une ligne.');
    });
    if(pending)throw Error('Dernière réplique sans identifiant.');
    return out;
  }
  function reconcile(incoming,existing) {
    if(!Array.isArray(incoming)||!incoming.length)throw Error('Aucune réplique du document 1 trouvée.');
    if(!Array.isArray(existing)||!existing.length)throw Error('Aucune extraction initiale trouvée dans le projet.');
    var old=new Map(existing.map(function(r){return [r.id,r]})),seen=new Set();
    incoming.forEach(function(r){
      if(!r.id||seen.has(r.id)||!old.has(r.id))throw Error('Identifiant inconnu, absent ou en double : '+r.id);
      if(!r.character||!r.text.trim())throw Error('Réplique sans personnage ou sans texte : '+r.id);
      seen.add(r.id);
    });
    if(seen.size!==old.size)throw Error('Document incomplet : '+(old.size-seen.size)+' réplique(s) manquante(s).');
    // L'ordre du document validé est l'autorité, jamais celui du projet ancien.
    return incoming.map(function(r,i){return Object.assign({},old.get(r.id),r,{reviewedDocument:true,needsReview:false,order:i});});
  }
  function chapterReference(title){
    var m=String(title||'').match(/^chapitre\s+(.+?)(?:\s+[—–]\s+.+)?$/i);
    return m?'Ch. '+m[1]:title||'Sans chapitre';
  }
  function document2(rows,title) {
    var g=group(rows),md='# '+(title||'Projet')+' — DOCUMENT 2 · VOIX PAR PERSONNAGE\n\n',secondaryWritten=false;
    g.groups.forEach(function(grp){
      if(grp.secondary&&!secondaryWritten){md+='## VOIX & ENTITÉS SECONDAIRES\n\n';secondaryWritten=true;}
      md+=(grp.secondary?'### ':'## ')+grp.name+'\n\n';var act='';
      grp.items.forEach(function(item){
        var r=item.row,now=r.act||'Sans acte';if(now!==act){act=now;md+='**'+act+'**\n\n';}
        var suffix=item.variant?' ('+item.variant+')':'';
        md+='> ['+chapterReference(r.chapter)+']'+suffix+' «'+r.text+'»\n';
        md+='<!-- NYXIA-REPLIQUE-ID:'+r.id+' -->\n';
      md+='<!-- Provenance : '+String(r.sourceFile||'saisie manuelle').replace(/-->/g,'')+' ; ligne '+(r.sourceLine||'?')+' -->\n\n';
      });
      md+='---\n\n';
    });
    md+='**Contrôle : '+g.total+' répliques validées = '+g.groups.reduce(function(a,x){return a+x.items.length;},0)+' répliques classées.**\n';
    return md;
  }
  return {nl:nl,heading:heading,scan:scan,makeChunks:makeChunks,exactSegments:exactSegments,
    acceptAI:acceptAI,fallback:fallback,actorInfo:actorInfo,group:group,validateRows:validateRows,
    document1:document1,parseDocument1:parseDocument1,reconcile:reconcile,document2:document2};
});
