/**
 * starry-bg.js — Canvas ciel étoilé + couche commune NyXiaLabo
 * Aucune dépendance pour le fond.
 *
 * Cette version conserve le fond LIVE et ajoute seulement :
 * - accès visible vers l'Atelier Équipe ;
 * - actions uniformes des réponses IA : Écouter, Copier, Réessayer, PDF.
 */
;(function () {
  'use strict'

  var canvas = document.getElementById('starry-canvas')
  if (!canvas) return

  var ctx = canvas.getContext('2d')
  var stars = []
  var shootingStars = []
  var STAR_COUNT = 400
  var SHOOTING_INTERVAL = 3000

  function resize() {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }

  function createStars() {
    stars = []
    for (var i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 1.5 + 0.3,
        opacity: Math.random() * 0.8 + 0.2,
        twinkleSpeed: Math.random() * 0.02 + 0.005,
        phase: Math.random() * Math.PI * 2
      })
    }
  }

  function createShootingStar() {
    shootingStars.push({
      x: Math.random() * canvas.width * 0.7,
      y: Math.random() * canvas.height * 0.3,
      length: Math.random() * 80 + 40,
      speed: Math.random() * 8 + 4,
      angle: Math.PI / 4 + (Math.random() - 0.5) * 0.3,
      opacity: 1,
      life: 1
    })
  }

  function drawStars(time) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i]
      var flicker = Math.sin(time * s.twinkleSpeed + s.phase) * 0.3 + 0.7
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,' + (s.opacity * flicker).toFixed(3) + ')'
      ctx.fill()
    }
  }

  function drawShootingStars() {
    for (var i = shootingStars.length - 1; i >= 0; i--) {
      var ss = shootingStars[i]
      var tailX = ss.x - Math.cos(ss.angle) * ss.length
      var tailY = ss.y - Math.sin(ss.angle) * ss.length

      var grad = ctx.createLinearGradient(tailX, tailY, ss.x, ss.y)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(1, 'rgba(255,255,255,' + (ss.opacity * ss.life).toFixed(3) + ')')

      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.lineTo(ss.x, ss.y)
      ctx.strokeStyle = grad
      ctx.lineWidth = 1.5
      ctx.stroke()

      ss.x += Math.cos(ss.angle) * ss.speed
      ss.y += Math.sin(ss.angle) * ss.speed
      ss.life -= 0.015

      if (ss.life <= 0) shootingStars.splice(i, 1)
    }
  }

  function animate(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawStars(time)
    drawShootingStars()
    requestAnimationFrame(animate)
  }

  resize()
  createStars()
  requestAnimationFrame(animate)

  setInterval(createShootingStar, SHOOTING_INTERVAL)
  window.addEventListener('resize', function () {
    resize()
    createStars()
  })
})()

/* ═══════════════════════════════════════════════════════════════════════════
   Couche commune NyXiaLabo — dashboard seulement
   ═══════════════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict'

  function isDashboard() {
    return !!document.getElementById('sidebar') && !!document.getElementById('panel-body')
  }

  function getMessageText(m) {
    if (!m) return ''
    if (typeof m.content === 'string') return m.content
    if (Array.isArray(m.content)) {
      var part = m.content.find(function (c) { return c && c.type === 'text' })
      return part ? (part.text || '') : ''
    }
    return ''
  }

  function injectCss() {
    if (document.getElementById('nx-labo-common-css')) return
    var style = document.createElement('style')
    style.id = 'nx-labo-common-css'
    style.textContent =
      '.nx-msg-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px;padding-top:5px;border-top:1px solid rgba(123,92,255,.08)}' +
      '.nx-msg-actions button{background:none;border:0;color:var(--t4);cursor:pointer;font-size:12px;padding:0}' +
      '.nx-msg-actions button:hover{color:var(--t2)}' +
      '.nx-atelier-link{margin:8px 12px 2px;padding:10px 12px;border-radius:11px;border:1px solid rgba(244,200,66,.24);background:linear-gradient(135deg,rgba(123,92,255,.15),rgba(244,200,66,.06));color:#f4d98d;font-size:13px;font-weight:700;cursor:pointer;display:flex;gap:10px;align-items:center}' +
      '.nx-atelier-link:hover{border-color:rgba(244,200,66,.45);background:linear-gradient(135deg,rgba(123,92,255,.22),rgba(244,200,66,.1))}' +
      '.nx-header-atelier{margin-right:8px;padding:6px 13px;border-radius:50px;border:1px solid rgba(167,139,250,.28);background:rgba(123,92,255,.10);color:#d8ccff;font-size:12px;font-weight:700;cursor:pointer}'
    document.head.appendChild(style)
  }

  function injectAtelierLinks() {
    if (!isDashboard()) return

    var brand = document.querySelector('.brand-name')
    if (brand && brand.textContent.trim() === 'Sandbox IA') brand.textContent = 'NyXiaLabo'

    var sidebar = document.getElementById('sidebar')
    if (sidebar && !document.getElementById('nx-atelier-side')) {
      var btn = document.createElement('button')
      btn.id = 'nx-atelier-side'
      btn.className = 'nx-atelier-link'
      btn.innerHTML = '<span>🧪</span><span>Atelier équipe</span>'
      btn.onclick = function () { window.location.href = '/atelier-equipe.html' }
      sidebar.insertBefore(btn, sidebar.firstChild)
    }

    var logout = document.querySelector('.btn-logout')
    if (logout && !document.getElementById('nx-atelier-head')) {
      var hbtn = document.createElement('button')
      hbtn.id = 'nx-atelier-head'
      hbtn.className = 'nx-header-atelier'
      hbtn.textContent = '🧪 Atelier équipe'
      hbtn.onclick = function () { window.location.href = '/atelier-equipe.html' }
      logout.parentNode.insertBefore(hbtn, logout)
    }
  }

  window.nxCopyAssistantMessage = async function (idx) {
    try {
      var history = window.chatHistories && window.chatHistories[window.currentToolId]
      var text = getMessageText(history && history[idx])
      if (!text) return
      await navigator.clipboard.writeText(text)
      var btn = document.activeElement
      if (btn && btn.tagName === 'BUTTON') {
        var old = btn.textContent
        btn.textContent = '✓ Copié'
        setTimeout(function () { btn.textContent = old }, 900)
      }
    } catch (e) {
      alert('Impossible de copier cette réponse : ' + e.message)
    }
  }

  window.nxRetryAssistantMessage = function (idx) {
    var histories = window.chatHistories
    var toolId = window.currentToolId
    if (!histories || !toolId || !histories[toolId]) return
    var history = histories[toolId]
    var msg = history[idx]
    if (!msg || msg.role === 'user') return

    if (idx < history.length - 1 && !confirm('Réessayer cette réponse supprimera les messages qui la suivent dans cette conversation. Continuer ?')) return

    var base = history.slice(0, idx)
    if (!base.length || base[base.length - 1].role !== 'user') {
      alert('Je ne trouve pas le message utilisateur associé à cette réponse.')
      return
    }

    histories[toolId] = base
    var msgsEl = document.getElementById('chat-messages')
    if (msgsEl) {
      msgsEl.innerHTML = base.map(window.renderMsg).join('') + '<div class="msg bot" id="typing"><div class="msg-bubble">…</div></div>'
      msgsEl.scrollTop = msgsEl.scrollHeight
    }

    var sendBtn = document.getElementById('btn-send')
    if (sendBtn) sendBtn.disabled = true

    fetch('/api/chat', {
      method: 'POST',
      headers: window.authHeaders(),
      body: JSON.stringify({ toolId: toolId, messages: base })
    })
    .then(function (r) { return r.json() })
    .then(function (data) {
      var typing = document.getElementById('typing'); if (typing) typing.remove()
      histories[toolId].push({ role: 'assistant', content: data.error ? ('⚠️ Erreur : ' + window.errText(data.error)) : (data.text || '(réponse vide)') })
      if (msgsEl) {
        msgsEl.innerHTML = histories[toolId].map(window.renderMsg).join('')
        msgsEl.scrollTop = msgsEl.scrollHeight
      }
    })
    .catch(function (e) {
      var typing = document.getElementById('typing'); if (typing) typing.remove()
      histories[toolId].push({ role: 'assistant', content: '⚠️ Erreur réseau : ' + e.message })
      if (msgsEl) msgsEl.innerHTML = histories[toolId].map(window.renderMsg).join('')
    })
    .finally(function () { if (sendBtn) sendBtn.disabled = false })
  }

  function patchMessageActions() {
    if (!isDashboard() || typeof window.renderMsg !== 'function' || window.renderMsg.__nxPatched) return

    var enhanced = function (m, idx) {
      var text = getMessageText(m)
      var img = (m && typeof m.content === 'object' && Array.isArray(m.content))
        ? ((m.content.find(function (c) { return c.type === 'image_url' }) || {}).image_url || null)
        : null
      var imgHtml = img ? '<img src="' + img.url + '" style="max-width:220px;border-radius:10px;display:block;margin-bottom:6px">' : ''
      var bodyHtml = m.role === 'user' ? window.esc(text) : window.renderMarkdown(text)
      var actions = ''
      if (m.role !== 'user') {
        actions = '<div class="nx-msg-actions">' +
          '<button onclick="speakText(' + idx + ')" title="Écouter">🔊 Écouter</button>' +
          '<button onclick="nxCopyAssistantMessage(' + idx + ')" title="Copier">📋 Copier</button>' +
          '<button onclick="nxRetryAssistantMessage(' + idx + ')" title="Réessayer">↺ Réessayer</button>' +
          '<button onclick="exportSingleMessagePDF(' + idx + ')" title="Exporter en PDF">⬇ PDF</button>' +
          '</div>'
      }
      return '<div class="msg ' + (m.role === 'user' ? 'user' : 'bot') + '"><div class="msg-bubble">' + imgHtml + bodyHtml + actions + '</div></div>'
    }
    enhanced.__nxPatched = true
    window.renderMsg = enhanced

    // Réaffiche immédiatement l'historique courant si un chat est déjà ouvert.
    try {
      var el = document.getElementById('chat-messages')
      var history = window.chatHistories && window.chatHistories[window.currentToolId]
      if (el && history) el.innerHTML = history.map(window.renderMsg).join('')
    } catch (e) {}
  }

  function enhance() {
    if (!isDashboard()) return
    injectCss()
    injectAtelierLinks()
    patchMessageActions()

    var sidebar = document.getElementById('sidebar')
    if (sidebar && window.MutationObserver) {
      var scheduled = false
      new MutationObserver(function () {
        if (scheduled) return
        scheduled = true
        setTimeout(function () {
          scheduled = false
          injectAtelierLinks()
        }, 0)
      }).observe(sidebar, { childList: true })
    }
  }

  // Le fichier est chargé en defer : le gros script inline du dashboard a fini
  // de déclarer ses fonctions quand ce callback s'exécute.
  setTimeout(enhance, 0)
})()
