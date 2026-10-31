/**
 * dsh-firefly-bg —— 浏览器半端
 * ============================================================================
 * 干两件事：
 *   1) 在 document.body 底下挂一层 fixed 背景（壁纸 + 遮罩 + 萤火虫 + 暗角），
 *      并把主题的面板令牌换成半透明 —— 「毛玻璃」效果就是这么出来的。
 *   2) 往「设置」里加一页「流萤背景」：选图、遮罩、模糊、粒子数、面板通透度。
 *
 * 设计取舍：
 *   - 不注册任何槽位浮层，背景层是纯 DOM，DSH 换布局也不影响它。
 *   - 设置存 localStorage：只活在这台机器的这个浏览器里，不上传、不写宿主配置。
 *   - 关掉开关 = 把所有被改过的 CSS 变量**原样删掉**，主题立刻回到出厂外观。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-firefly-bg',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /** 改完 client.js 就 +1：面板右上角会显示，用来确认浏览器有没有吃新代码 */
    const BUILD = 11

    /** 页面里冒出来的错，攒着，诊断时一起报回去 */
    const ERRS = []
    try {
      window.addEventListener('error', (e) => ERRS.push(String((e && e.message) || 'error').slice(0, 90)))
      window.addEventListener('unhandledrejection', (e) => ERRS.push('rej:' + String((e && e.reason) || '').slice(0, 80)))
    } catch {
      /* 忽略 */
    }

    const API = '/api/firefly-bg'
    const STORE_KEY = 'dsh-firefly-bg/settings/v1'
    const ROOT_ID = 'ffbg-root'
    const CSS_ID = 'ffbg-style'

    const DEFAULTS = Object.freeze({
      on: true,
      wp: '01-rooftop',
      dim: 55, // 遮罩浓度 0..90
      blur: 0, // 背景模糊 px 0..24
      motes: 26, // 萤火虫数量 0..64
      glass: 62, // 面板通透度 0..100（100 = 最实）
      kenburns: true, // 缓慢漂移
      shuffle: false, // 每次打开随机换一张
    })

    const FALLBACK_WALLS = [
      { id: '01-rooftop', name: '天台黄昏', position: '58% 50%' },
      { id: '02-fireworks', name: '烟花夜', position: '56% 50%' },
      { id: '03-desk', name: '书桌微光', position: '50% 46%' },
      { id: '04-sam', name: '并肩', position: '62% 46%' },
    ]

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo))

    /* ------------------------------------------------------------------ */
    /* 设置：读写 + 订阅                                                    */
    /* ------------------------------------------------------------------ */

    let state = readStore()
    const listeners = new Set()

    function readStore() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        const obj = raw ? JSON.parse(raw) : null
        return { ...DEFAULTS, ...(obj && typeof obj === 'object' ? obj : {}) }
      } catch {
        return { ...DEFAULTS }
      }
    }

    function writeStore(next) {
      try {
        // __rolled 只是这一次打开的临时标记，不落盘 —— 否则「每次随机」会失效
        const { __rolled, ...persist } = next
        window.localStorage.setItem(STORE_KEY, JSON.stringify(persist))
      } catch {
        /* 隐私模式 / 配额满：设置照旧生效，只是记不住 */
      }
    }

    function setState(patch) {
      state = { ...state, ...patch }
      writeStore(state)
      applyVisual()
      for (const fn of listeners) {
        try {
          fn(state)
        } catch {
          /* 某个订阅者炸了不影响别人 */
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 背景层                                                              */
    /* ------------------------------------------------------------------ */

    let root = null
    let photoWrap = null
    let photo = null
    let motesCanvas = null
    let motesStop = null
    const touchedVars = new Set()

    const LAYER_CSS = `
#${ROOT_ID}{position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none;
  background:radial-gradient(120% 100% at 20% 0%,#0d2f2c 0%,#061416 45%,#03090b 100%);}
#${ROOT_ID}[data-on="0"]{display:none;}
#${ROOT_ID} > div,#${ROOT_ID} > canvas{position:absolute;inset:0;}
#ffbg-photo-wrap{overflow:hidden;}
#${ROOT_ID}[data-kenburns="1"] #ffbg-photo-wrap{animation:ffbg-drift 84s ease-in-out infinite alternate;}
@keyframes ffbg-drift{
  from{transform:scale(1.005) translate3d(0,0,0);}
  to{transform:scale(1.075) translate3d(-1.4%,-1.1%,0);}
}
#ffbg-photo{position:absolute;inset:0;background-position:center;background-size:cover;background-repeat:no-repeat;
  transition:opacity .5s ease,filter .25s ease;will-change:transform,filter;}
#ffbg-veil{background:
  radial-gradient(120% 90% at 16% 0%,rgba(126,255,214,.10),transparent 58%),
  radial-gradient(90% 80% at 86% 102%,rgba(96,206,255,.07),transparent 60%),
  linear-gradient(90deg,rgba(var(--ffbg-veil-rgb,2,10,12),calc(var(--ffbg-veil,.5) * .55)) 0%,
    rgba(var(--ffbg-veil-rgb,2,10,12),calc(var(--ffbg-veil,.5) * .22)) 46%,
    rgba(var(--ffbg-veil-rgb,2,10,12),0) 74%),
  linear-gradient(180deg,rgba(var(--ffbg-veil-rgb,2,10,12),var(--ffbg-veil,.5)) 0%,
    rgba(var(--ffbg-veil-rgb,2,10,12),calc(var(--ffbg-veil,.5) * .72)) 44%,
    rgba(var(--ffbg-veil-rgb,2,10,12),calc(var(--ffbg-veil,.5) * 1.05)) 100%);}
#ffbg-glow{background:radial-gradient(58% 48% at 76% 20%,rgba(127,232,196,.16),transparent 72%);
  animation:ffbg-breathe 11s ease-in-out infinite;mix-blend-mode:screen;}
@keyframes ffbg-breathe{0%,100%{opacity:.55;}50%{opacity:1;}}
#ffbg-vignette{background:radial-gradient(128% 118% at 50% 42%,transparent 42%,rgba(0,0,0,.52) 100%);}
#ffbg-root[data-dark="0"] #ffbg-vignette{background:radial-gradient(128% 118% at 50% 42%,transparent 52%,rgba(24,60,66,.20) 100%);}
#ffbg-motes{mix-blend-mode:screen;transition:opacity .4s ease;width:100%;height:100%;}
#ffbg-root[data-dark="0"] #ffbg-motes{mix-blend-mode:normal;opacity:.75;}
html,body{background-color:transparent !important;background-image:none !important;}
@media (prefers-reduced-motion:reduce){
  #${ROOT_ID}[data-kenburns="1"] #ffbg-photo-wrap{animation:none;}
  #ffbg-glow{animation:none;}
}
`

    function ensureStyle() {
      if (document.getElementById(CSS_ID)) return
      const style = document.createElement('style')
      style.id = CSS_ID
      style.setAttribute('data-plugin-css', 'dsh-firefly-bg')
      style.textContent = LAYER_CSS
      document.head.appendChild(style)
    }

    function ensureLayer() {
      if (root && document.body.contains(root)) return root
      const old = document.getElementById(ROOT_ID)
      if (old) old.remove()

      const el = document.createElement('div')
      el.id = ROOT_ID
      el.setAttribute('aria-hidden', 'true')

      photoWrap = document.createElement('div')
      photoWrap.id = 'ffbg-photo-wrap'
      photo = document.createElement('div')
      photo.id = 'ffbg-photo'
      photoWrap.appendChild(photo)

      const veil = document.createElement('div')
      veil.id = 'ffbg-veil'
      const glow = document.createElement('div')
      glow.id = 'ffbg-glow'
      const vignette = document.createElement('div')
      vignette.id = 'ffbg-vignette'

      motesCanvas = document.createElement('canvas')
      motesCanvas.id = 'ffbg-motes'

      el.append(photoWrap, veil, motesCanvas, glow, vignette)
      document.body.appendChild(el)
      root = el
      return el
    }

    /* ------------------------------------------------------------------ */
    /* 打通「不透明背景」                                                   */
    /* ------------------------------------------------------------------ */
    /* DSH 的外壳容器自带不透明底色（实测是 rgb(249,250,251)），壁纸画在
     * z-index:-2 的图层上就会被它整块盖住。这里做一次「打洞」：凡是几乎铺满
     * 视口、底色不透明、又不是毛玻璃的容器，把它的 background-color 顶成透明。
     * 关掉插件时按记下的原值还原。
     *
     * 为什么不写死类名：DSH 的类名是构建期哈希（mP3x-q_frame），升级就变。 */

    function isOpaqueColor(c) {
      if (!c || c === 'transparent') return false
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return false
      const parts = m[1].split(',').map((s) => parseFloat(s))
      const a = parts.length > 3 ? parts[3] : 1
      return a > 0.9
    }

    const clearedEls = new Set()

    function punchThrough() {
      if (!state.on || !document.body) return 0
      const vw = window.innerWidth || 1280
      const vh = window.innerHeight || 800
      let n = 0

      const visit = (el, depth) => {
        if (depth > 6 || !el) return
        let kids
        try {
          kids = Array.from(el.children)
        } catch {
          return
        }
        for (const child of kids) {
          if (!child || child.id === ROOT_ID || child.id === CSS_ID) continue
          if (budget-- <= 0) return
          // 弹窗自己有自己的玻璃底，别动它
          if (child.getAttribute && (child.getAttribute('role') === 'dialog' || child.getAttribute('aria-modal') === 'true')) continue
          let cs
          try {
            cs = window.getComputedStyle(child)
          } catch {
            continue
          }
          const cw = child.offsetWidth
          const ch = child.offsetHeight
          const big = cw >= vw * 0.5 && ch >= vh * 0.5
          const blurry = cs.backdropFilter && cs.backdropFilter !== 'none'
          if (big && !blurry && isOpaqueColor(cs.backgroundColor)) {
            if (!child.dataset.ffbgCleared) {
              child.dataset.ffbgCleared = '1'
              child.dataset.ffbgBg = child.style.getPropertyValue('background-color')
              child.dataset.ffbgBgPrio = child.style.getPropertyPriority('background-color')
              clearedEls.add(child)
            }
            child.style.setProperty('background-color', 'transparent', 'important')
            n += 1
            visit(child, depth + 1)
            continue
          }
          // 继续往下找：0x0 的包裹层（常见于 React 外壳）、跨半边以上的容器、以及大容器
          const wrapper = cw === 0 && ch === 0
          const spans = cw >= vw * 0.5 || ch >= vh * 0.5
          if (wrapper || spans || big) visit(child, depth + 1)
        }
      }

      let budget = 4000
      visit(document.body, 0)
      return n
    }

    function restorePunched() {
      for (const el of clearedEls) {
        try {
          const bg = el.dataset.ffbgBg || ''
          const prio = el.dataset.ffbgBgPrio || ''
          if (bg) el.style.setProperty('background-color', bg, prio)
          else el.style.removeProperty('background-color')
          delete el.dataset.ffbgCleared
          delete el.dataset.ffbgBg
          delete el.dataset.ffbgBgPrio
        } catch {
          /* 忽略 */
        }
      }
      clearedEls.clear()
    }

    function wallPosition(id) {
      const w = FALLBACK_WALLS.find((x) => x.id === id)
      return (w && w.position) || 'center'
    }

    function isDark() {
      if (document.body && document.body.hasAttribute('data-ds-dark-theme')) return true
      if (document.documentElement.hasAttribute('data-ds-dark-theme')) return true
      if (document.body && document.body.getAttribute('data-theme') === 'dark') return true
      try {
        return window.matchMedia('(prefers-color-scheme: dark)').matches
      } catch {
        return true
      }
    }

    /** 把主题令牌换成半透明：这是「毛玻璃」的全部秘密 */
    function applyTokens() {
      const targets = [document.documentElement, document.body].filter(Boolean)
      // 关掉插件：把改过的变量原样删掉，主题自己接管回去
      if (!state.on) {
        for (const el of targets) for (const k of touchedVars) el.style.removeProperty(k)
        return
      }
      const dark = isDark()
      const g = clamp(state.glass, 0, 100) / 100
      // k：0.30（最透）→ 0.96（最实）
      const k = dark ? 0.3 + 0.66 * g : 0.35 + 0.55 * g
      const rgb = dark ? '5,15,18' : '248,253,251'
      const rgba = (a) => `rgba(${rgb},${clamp(a, 0, 1).toFixed(3)})`
      const vars = {
        '--dsw-alias-bg-base': rgba(k * 0.5),
        '--dsw-alias-bg-layer-1': rgba(k * 0.78),
        '--dsw-alias-bg-layer-2': rgba(k * 0.9),
        '--dsw-alias-bg-layer-3': rgba(k * 0.97),
        '--dsw-alias-bg-overlay': rgba(k * 0.93),
        '--dsw-alias-specific-sidebar-fill': rgba(k * 0.45),
        '--dsw-alias-interactive-bg-hover': `rgba(127,232,196,${(0.06 + 0.06 * g).toFixed(3)})`,
        '--dsw-alias-border-l2': `rgba(127,232,196,${(0.1 + 0.1 * g).toFixed(3)})`,
      }
      for (const el of targets) {
        for (const [key, value] of Object.entries(vars)) {
          el.style.setProperty(key, value)
          touchedVars.add(key)
        }
      }
    }

    function applyVisual() {
      ensureLayer()
      root.dataset.on = state.on ? '1' : '0'
      root.dataset.kenburns = state.kenburns ? '1' : '0'
      // 遮罩浓度同时管两件事：把图压暗（brightness）+ 盖一层夜色（veil）
      const dim = clamp(state.dim, 0, 90) / 100
      const dark = isDark()
      root.dataset.dark = dark ? '1' : '0'
      // 浅色主题下不能把图压太暗（否则整页发灰），靠更淡的雾提亮
      root.style.setProperty('--ffbg-veil', (dark ? 0.06 + dim * 0.62 : 0.20 + dim * 0.42).toFixed(3))
      root.style.setProperty('--ffbg-veil-rgb', dark ? '2,10,12' : '250,253,252')

      const url = `${API}/img/${state.wp}`
      if (photo.dataset.src !== url) {
        photo.dataset.src = url
        photo.style.backgroundPosition = wallPosition(state.wp)
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => {
          if (photo.dataset.src === url) photo.style.backgroundImage = `url("${url}")`
        }
        // 拿不到图就留着下面那层纯色渐变，不报错、不白屏
        img.onerror = () => {
          if (photo.dataset.src === url) photo.style.backgroundImage = ''
        }
        img.src = url
      }

      const blur = clamp(state.blur, 0, 24)
      const bright = (1 - dim * (dark ? 0.62 : 0.24)).toFixed(3)
      // 浅色主题下垫一点点模糊，文字压在上面才清楚
      const effBlur = dark ? blur : Math.max(blur, 2.5)
      photo.style.filter = (effBlur > 0 ? `blur(${effBlur}px) ` : '') + `brightness(${bright}) saturate(1.04)`

      applyTokens()
      if (state.on) punchThrough()
      else restorePunched()
      if (motesCanvas) motesCanvas.style.opacity = state.on && state.motes > 0 ? '1' : '0'
    }

    /* ------------------------------------------------------------------ */
    /* 萤火虫                                                              */
    /* ------------------------------------------------------------------ */

    function makeSprite(color) {
      const s = document.createElement('canvas')
      s.width = 64
      s.height = 64
      const g = s.getContext('2d')
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      grd.addColorStop(0, color)
      grd.addColorStop(0.18, color.replace(/,\s*1\)$/, ',0.85)'))
      grd.addColorStop(0.55, color.replace(/,\s*1\)$/, ',0.18)'))
      grd.addColorStop(1, color.replace(/,\s*1\)$/, ',0)'))
      g.fillStyle = grd
      g.fillRect(0, 0, 64, 64)
      return s
    }

    function startMotes() {
      if (!motesCanvas || motesStop) return
      const c2 = motesCanvas.getContext('2d')
      if (!c2) return

      const MINT = makeSprite('rgba(178,255,226,1)')
      const GOLD = makeSprite('rgba(255,226,170,1)')

      let w = 0
      let h = 0
      let dpr = 1
      let raf = 0
      let last = 0
      let parts = []

      const fit = () => {
        dpr = Math.min(2, window.devicePixelRatio || 1)
        w = window.innerWidth
        h = window.innerHeight
        motesCanvas.width = Math.max(1, Math.round(w * dpr))
        motesCanvas.height = Math.max(1, Math.round(h * dpr))
        c2.setTransform(dpr, 0, 0, dpr, 0, 0)
      }

      const spawn = (seed) => {
        const gold = Math.random() < 0.16
        return {
          x: Math.random() * w,
          y: seed ? Math.random() * h : h + 20 + Math.random() * h * 0.2,
          r: (gold ? 1.6 : 1) * (0.8 + Math.random() * 1.9),
          a: 0.24 + Math.random() * 0.46,
          vy: 5 + Math.random() * 16, // px / 秒，往上飘
          sway: 8 + Math.random() * 26,
          phase: Math.random() * Math.PI * 2,
          freq: 0.12 + Math.random() * 0.4,
          flick: 0.9 + Math.random() * 2.4,
          sprite: gold ? GOLD : MINT,
        }
      }

      const sync = () => {
        const want = clamp(state.motes, 0, 64)
        while (parts.length > want) parts.pop()
        while (parts.length < want) parts.push(spawn(parts.length > 0))
      }

      fit()
      parts = Array.from({ length: clamp(state.motes, 0, 64) }, (_, i) => spawn(i > 0))

      const draw = (now) => {
        const t = now / 1000
        const dt = last ? Math.min(0.06, (now - last) / 1000) : 0.016
        last = now
        c2.clearRect(0, 0, w, h)
        c2.globalCompositeOperation = 'lighter'
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]
          p.y -= p.vy * dt
          if (p.y < -30) parts[i] = spawn(false)
          const x = p.x + Math.sin(t * p.freq * Math.PI * 2 + p.phase) * p.sway
          const y = p.y
          const flick = 0.55 + 0.45 * Math.sin(t * p.flick + p.phase)
          c2.globalAlpha = clamp(p.a * flick, 0, 1)
          const size = p.r * 13
          c2.drawImage(p.sprite, x - size / 2, y - size / 2, size, size)
        }
        c2.globalAlpha = 1
        raf = window.requestAnimationFrame(draw)
      }

      const still = () => {
        c2.clearRect(0, 0, w, h)
        c2.globalCompositeOperation = 'lighter'
        for (const p of parts) {
          const size = p.r * 13
          c2.globalAlpha = clamp(p.a, 0, 1)
          c2.drawImage(p.sprite, p.x - size / 2, p.y - size / 2, size, size)
        }
        c2.globalAlpha = 1
      }

      let reduced = false
      try {
        reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      } catch {
        reduced = false
      }

      const onResize = () => {
        fit()
        for (const p of parts) {
          p.x = Math.min(p.x, w)
          p.y = Math.min(p.y, h)
        }
        if (reduced) still()
      }
      window.addEventListener('resize', onResize)

      const onVisibility = () => {
        if (document.hidden) {
          if (raf) window.cancelAnimationFrame(raf)
          raf = 0
        } else if (!reduced && !raf) {
          last = 0
          raf = window.requestAnimationFrame(draw)
        }
      }
      document.addEventListener('visibilitychange', onVisibility)

      const onChange = () => {
        sync()
        if (reduced) still()
      }
      listeners.add(onChange)

      if (reduced) still()
      else raf = window.requestAnimationFrame(draw)

      motesStop = () => {
        if (raf) window.cancelAnimationFrame(raf)
        raf = 0
        window.removeEventListener('resize', onResize)
        document.removeEventListener('visibilitychange', onVisibility)
        listeners.delete(onChange)
      }
    }

    /* ------------------------------------------------------------------ */
    /* 设置页                                                              */
    /* ------------------------------------------------------------------ */

    const PANEL_CSS = `
[data-ff-page]{display:flex;flex-direction:column;gap:14px;max-width:720px;padding:2px 2px 14px;font-size:13px;}
[data-ff-hero]{display:flex;align-items:center;gap:12px;padding:2px 2px 4px;}
[data-ff-dot]{flex:none;width:36px;height:36px;border-radius:50%;
  background:radial-gradient(circle at 36% 30%,#e6fff6 0%,#8dffd6 34%,rgba(94,226,178,.28) 62%,rgba(94,226,178,0) 73%);
  box-shadow:0 0 22px rgba(110,255,205,.45),0 0 3px rgba(255,255,255,.5) inset;}
[data-ff-h1]{font-size:15px;font-weight:650;letter-spacing:.2px;}
[data-ff-sub]{font-size:11.5px;line-height:17.5px;color:var(--dsw-alias-label-tertiary,#8c9c98);}
[data-ff-card]{display:flex;flex-direction:column;gap:12px;padding:14px 15px;border-radius:14px;
  border:1px solid rgba(127,232,196,.16);
  background:linear-gradient(158deg,rgba(9,26,28,.82),rgba(6,18,20,.66));
  backdrop-filter:blur(14px);box-shadow:0 10px 30px rgba(0,0,0,.16);}
body:not([data-ds-dark-theme]) [data-ff-card]{border-color:rgba(24,120,96,.18);
  background:linear-gradient(158deg,rgba(255,255,255,.72),rgba(240,252,247,.5));}
[data-ff-row]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-ff-grow]{flex:1;min-width:0;}
[data-ff-switch]{flex:none;width:44px;height:25px;border-radius:999px;border:1px solid rgba(127,232,196,.3);
  background:rgba(127,232,196,.1);cursor:pointer;padding:0;position:relative;transition:background .18s ease;}
[data-ff-switch] > span{position:absolute;top:2px;left:2px;width:19px;height:19px;border-radius:50%;
  background:#cfe9e0;transition:transform .18s ease,background .18s ease;}
[data-ff-switch][data-on="1"]{background:rgba(96,232,180,.85);border-color:rgba(96,232,180,.9);}
[data-ff-switch][data-on="1"] > span{transform:translateX(19px);background:#05201a;}
[data-ff-grid]{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;}
[data-ff-wall]{position:relative;padding:0;border-radius:11px;overflow:hidden;cursor:pointer;
  border:1px solid rgba(255,255,255,.13);background:rgba(0,0,0,.25);font:inherit;color:inherit;
  transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease;}
[data-ff-wall]:hover{transform:translateY(-1px);border-color:rgba(127,232,196,.45);}
[data-ff-wall][data-on="1"]{border-color:#7fe8c4;box-shadow:0 0 0 2px rgba(127,232,196,.35),0 6px 18px rgba(0,0,0,.35);}
[data-ff-wall] img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;opacity:.92;}
[data-ff-wall][data-on="1"] img{opacity:1;}
[data-ff-wall] b{position:absolute;left:0;right:0;bottom:0;padding:14px 9px 6px;text-align:left;
  font-size:11.5px;font-weight:550;color:#fff;
  background:linear-gradient(180deg,transparent,rgba(0,0,0,.68));}
[data-ff-field]{display:flex;flex-direction:column;gap:6px;}
[data-ff-fieldhead]{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}
[data-ff-fieldname]{font-size:12.5px;font-weight:550;}
[data-ff-val]{font-size:11.5px;font-variant-numeric:tabular-nums;color:#8dffd6;}
body:not([data-ds-dark-theme]) [data-ff-val]{color:#0f8f6c;}
[data-ff-field] input[type=range]{width:100%;accent-color:#5ce0b4;height:18px;cursor:pointer;}
[data-ff-btn]{padding:7px 13px;border-radius:9px;font-size:12px;cursor:pointer;font-family:inherit;
  border:1px solid rgba(127,232,196,.24);background:rgba(127,232,196,.1);color:inherit;}
[data-ff-btn]:hover{background:rgba(127,232,196,.2);}
[data-ff-foot]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding-top:2px;}
[data-ff-badge]{font-size:10.5px;padding:2px 7px;border-radius:6px;letter-spacing:.3px;
  background:rgba(127,232,196,.14);color:#8dffd6;}
body:not([data-ds-dark-theme]) [data-ff-badge]{color:#0f8f6c;}
[data-ff-err]{font-size:12px;padding:10px 12px;border-radius:10px;background:rgba(240,120,120,.14);
  border:1px solid rgba(240,120,120,.3);}
`

    function Panel() {
      const [s, setS] = React.useState(() => ({ ...state }))
      const [walls, setWalls] = React.useState(FALLBACK_WALLS)
      const [err, setErr] = React.useState('')

      React.useEffect(() => {
        const fn = (next) => setS({ ...next })
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        fetch(`${API}/list`, { credentials: 'same-origin' })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (!alive || !j) return
            if (Array.isArray(j.wallpapers) && j.wallpapers.length) setWalls(j.wallpapers)
          })
          .catch(() => {
            if (alive) setErr('没拿到壁纸清单（宿主路由没起来？），先用内置的四张。')
          })
        return () => {
          alive = false
        }
      }, [])

      const patch = (p) => setState(p)

      const Switch = ({ on, onClick, label }) =>
        h(
          'button',
          {
            'data-ff-switch': '',
            'data-on': on ? '1' : '0',
            role: 'switch',
            'aria-checked': on,
            'aria-label': label,
            onClick,
          },
          h('span'),
        )

      const Slider = ({ label, value, min, max, step = 1, unit = '', hint, onChange }) =>
        h(
          'label',
          { 'data-ff-field': '' },
          h(
            'div',
            { 'data-ff-fieldhead': '' },
            h('span', { 'data-ff-fieldname': '' }, label),
            h('span', { 'data-ff-val': '' }, `${value}${unit}`),
          ),
          h('input', {
            type: 'range',
            min,
            max,
            step,
            value,
            onChange: (e) => onChange(Number(e.target.value)),
          }),
          hint ? h('div', { 'data-ff-sub': '' }, hint) : null,
        )

      return h(
        'div',
        { 'data-ff-page': '' },
        h(
          'div',
          { 'data-ff-hero': '' },
          h('div', { 'data-ff-dot': '' }),
          h(
            'div',
            { 'data-ff-grow': '' },
            h(
              'div',
              { 'data-ff-h1': '' },
              '流萤背景 ',
              h('span', { 'data-ff-badge': '' }, `v1.0 · b${BUILD}`),
            ),
            h('div', { 'data-ff-sub': '' }, '一张壁纸、一层萤火，别的都不动。设置只存在这台机器的浏览器里。'),
          ),
          h(
            'div',
            { 'data-ff-row': '' },
            h(Switch, { on: s.on, label: '启用背景', onClick: () => patch({ on: !s.on }) }),
          ),
        ),

        err ? h('div', { 'data-ff-err': '' }, err) : null,

        h(
          'div',
          { 'data-ff-card': '' },
          h(
            'div',
            { 'data-ff-row': '' },
            h(
              'div',
              { 'data-ff-grow': '' },
              h('div', { 'data-ff-fieldname': '' }, '壁纸'),
              h('div', { 'data-ff-sub': '' }, '点一张就换，立刻生效。'),
            ),
            h(
              'label',
              { 'data-ff-row': '', style: { gap: '6px', cursor: 'pointer' } },
              h('span', { 'data-ff-sub': '' }, '每次随机'),
              h(Switch, { on: s.shuffle, label: '每次打开随机换一张', onClick: () => patch({ shuffle: !s.shuffle }) }),
            ),
          ),
          h(
            'div',
            { 'data-ff-grid': '' },
            walls.map((w) =>
              h(
                'button',
                {
                  key: w.id,
                  'data-ff-wall': '',
                  'data-on': s.wp === w.id ? '1' : '0',
                  title: w.note || w.name,
                  onClick: () => patch({ wp: w.id }),
                },
                h('img', { src: `${API}/thumb/${w.id}`, alt: w.name, loading: 'lazy' }),
                h('b', null, w.name),
              ),
            ),
          ),
        ),

        h(
          'div',
          { 'data-ff-card': '' },
          h('div', { 'data-ff-fieldname': '' }, '氛围'),
          h(Slider, {
            label: '遮罩浓度',
            value: s.dim,
            min: 0,
            max: 90,
            unit: '%',
            hint: '越浓，文字越清楚；越淡，图越亮。',
            onChange: (v) => patch({ dim: v }),
          }),
          h(Slider, {
            label: '背景模糊',
            value: s.blur,
            min: 0,
            max: 24,
            unit: ' px',
            hint: '糊掉细节，只留颜色和光。',
            onChange: (v) => patch({ blur: v }),
          }),
          h(Slider, {
            label: '萤火虫',
            value: s.motes,
            min: 0,
            max: 64,
            unit: ' 只',
            hint: '0 = 只留静态背景。',
            onChange: (v) => patch({ motes: v }),
          }),
          h(Slider, {
            label: '面板通透度',
            value: s.glass,
            min: 0,
            max: 100,
            unit: '%',
            hint: '往左滑更透明（更透出壁纸），往右滑更实（更好读）。',
            onChange: (v) => patch({ glass: v }),
          }),
          h(
            'div',
            { 'data-ff-row': '' },
            h(Switch, { on: s.kenburns, label: '缓慢漂移', onClick: () => patch({ kenburns: !s.kenburns }) }),
            h(
              'div',
              { 'data-ff-grow': '' },
              h('div', { 'data-ff-fieldname': '' }, '缓慢漂移'),
              h('div', { 'data-ff-sub': '' }, '壁纸极慢地推近、平移，像镜头在呼吸。'),
            ),
          ),
        ),

        h(
          'div',
          { 'data-ff-foot': '' },
          h(
            'button',
            {
              'data-ff-btn': '',
              onClick: () => patch({ ...DEFAULTS, shuffle: false }),
            },
            '恢复默认',
          ),
          h(
            'button',
            {
              'data-ff-btn': '',
              onClick: () => patch({ on: false }),
            },
            '关掉背景',
          ),
          h('div', { 'data-ff-grow': '' }),
          h('div', { 'data-ff-sub': '' }, '改完直接看效果，不用重启；刷新页面也记得住。'),
        ),
      )
    }

    /** 面板自己的错误边界：某一处炸了只显示一句话，不整页消失 */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }

      static getDerivedStateFromError(err) {
        return { err }
      }

      render() {
        if (this.state.err) {
          return h(
            'div',
            { 'data-ff-page': '' },
            h('div', { 'data-ff-err': '' }, '这页出错了：' + String((this.state.err && this.state.err.message) || this.state.err)),
            h('button', { 'data-ff-btn': '', onClick: () => this.setState({ err: null }) }, '重试'),
          )
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ensureStyle()

        // 随机壁纸：只在「这次打开」时决定一次，之后切页不跳
        if (state.shuffle && !state.__rolled) {
          const ids = FALLBACK_WALLS.map((w) => w.id)
          const pick = ids[Math.floor(Math.random() * ids.length)]
          state = { ...state, wp: pick, __rolled: true }
        }

        ensureLayer()
        applyVisual()
        startMotes()

        // 外壳可能比插件晚渲染完：隔几拍再打几次洞
        for (const delay of [0, 400, 1500, 4000]) {
          try {
            window.setTimeout(() => {
              if (state.on) punchThrough()
            }, delay)
          } catch {
            /* 忽略 */
          }
        }

        // 切页/弹层会新长出容器，盯着点（节流 800ms）
        let shellObserver = null
        let shellTimer = 0
        try {
          shellObserver = new MutationObserver(() => {
            if (shellTimer) return
            shellTimer = window.setTimeout(() => {
              shellTimer = 0
              if (state.on) punchThrough()
            }, 800)
          })
          shellObserver.observe(document.body, { childList: true, subtree: true })
        } catch {
          /* 观察不到就算了，靠上面那几次延时 */
        }

        // 告诉宿主「我跑起来了」+ 顺手把真实 DOM 状态报回去：
        // 查 /api/firefly-bg/health 的 lastPing.build 就能远程看到为什么背景不显示。
        const diagInfo = () => {
          const info = {}
          try {
            const r = document.getElementById(ROOT_ID)
            info.root = r ? 1 : 0
            if (r) {
              const cs = getComputedStyle(r)
              info.z = cs.zIndex
              info.dis = cs.display
              info.op = cs.opacity
            }
            const ph = document.getElementById('ffbg-photo')
            info.img = ph && ph.style.backgroundImage ? 1 : 0
            info.htmlBg = getComputedStyle(document.documentElement).backgroundColor
            info.bodyBg = document.body ? getComputedStyle(document.body).backgroundColor : '-'
            info.base = document.body
              ? getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()
              : '-'
            const pts = [
              ['side', 0.16, 0.5],
              ['main', 0.55, 0.35],
              ['foot', 0.8, 0.85],
            ]
            const out = []
            for (const [tag, px, py] of pts) {
              let el = document.elementFromPoint(Math.round(innerWidth * px), Math.round(innerHeight * py))
              const parts = []
              for (let i = 0; el && i < 5; i++) {
                let c = '-'
                let bf = ''
                try {
                  const cs3 = getComputedStyle(el)
                  c = cs3.backgroundColor
                  if (cs3.backdropFilter && cs3.backdropFilter !== 'none') bf = '!bf'
                } catch {
                  /* 忽略 */
                }
                parts.push(
                  el.tagName.toLowerCase() +
                    (el.id ? '#' + el.id : '') +
                    '.' +
                    String(el.className || '').split(' ')[0].slice(0, 14) +
                    '=' +
                    c +
                    '|' +
                    el.offsetWidth +
                    'x' +
                    el.offsetHeight +
                    bf,
                )
                el = el.parentElement
              }
              out.push(tag + ':' + parts.join(' < '))
            }
            info.st = out.join(' || ').slice(0, 700)
            info.pn = clearedEls.size
            info.err = ERRS.join(' ; ').slice(0, 160)
            info.vw = innerWidth + 'x' + innerHeight
          } catch (e) {
            info.x = String(e).slice(0, 90)
          }
          return info
        }
        try {
          window.setTimeout(() => {
            let payload = 'n/a'
            try {
              payload = encodeURIComponent(JSON.stringify(diagInfo()))
            } catch {
              /* 忽略 */
            }
            fetch(`${API}/ping?b=${BUILD}|${payload}`, {
              credentials: 'same-origin',
              cache: 'no-store',
            }).catch(() => {})
          }, 900)
        } catch {
          /* 忽略 */
        }

        // 主题切换（深/浅）时重新算一次令牌
        let themeObserver = null
        try {
          themeObserver = new MutationObserver(() => applyTokens())
          for (const el of [document.documentElement, document.body]) {
            if (el) themeObserver.observe(el, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'data-theme', 'class'] })
          }
        } catch {
          /* 观察不到就只在初始化时算一次 */
        }

        ctx.effect(
          () => () => {
            try {
              themeObserver && themeObserver.disconnect()
            } catch {
              /* 忽略 */
            }
            try {
              shellObserver && shellObserver.disconnect()
            } catch {
              /* 忽略 */
            }
            try {
              restorePunched()
            } catch {
              /* 忽略 */
            }
            try {
              motesStop && motesStop()
            } catch {
              /* 忽略 */
            }
            motesStop = null
            try {
              for (const el of [document.documentElement, document.body]) {
                if (!el) continue
                for (const k of touchedVars) el.style.removeProperty(k)
              }
            } catch {
              /* 忽略 */
            }
            try {
              root && root.remove()
            } catch {
              /* 忽略 */
            }
            root = null
            const css = document.getElementById(CSS_ID)
            if (css) css.remove()
          },
          'firefly-bg: 背景层与令牌',
        )

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () =>
          slots.register(
            { name: 'settings.section', id: 'firefly-bg', order: 34, label: '流萤背景' },
            () => h(Boundary, null, h(Panel)),
          ),
        )
      },
    }
  },
})
