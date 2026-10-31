/**
 * dsh-firefly-bg —— 宿主半端
 * ============================================================================
 * 只干一件事：把插件包里自带的壁纸用**同源 HTTP 路由**发出去，让浏览器半端
 * 能直接 <img src> / background-image 用。
 *
 *   GET /api/firefly-bg/list          → { ok, wallpapers: [{ id, name, note, position }] }
 *   GET /api/firefly-bg/img/<id>      → 原图（长边 2560）
 *   GET /api/firefly-bg/thumb/<id>    → 缩略图（设置页选图用）
 *
 * 不写任何用户数据、不碰网络。图片全在包内 assets/ 下，随包发布。
 * ============================================================================
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'firefly-bg'
// webServer 是硬依赖：没有 HTTP 服务的 profile（纯 TUI）里这个包不会被加载。
export const inject = ['webServer']

const here = dirname(fileURLToPath(import.meta.url))
const WALL_DIR = join(here, 'assets', 'wallpapers')
const THUMB_DIR = join(here, 'assets', 'thumbs')

/**
 * 浏览器半端画过一笔就记在这儿：用来判断「页面到底有没有吃上新代码」。
 * 只活在内存里，宿主一重启就清空。
 */
let lastPing = null

/**
 * 壁纸清单 = 唯一的真相来源。`position` 是 background-position：
 * 换图时构图不一样，不能让浏览器一律居中裁。
 */
const WALLPAPERS = [
  {
    id: '01-rooftop',
    name: '天台黄昏',
    note: '城市灯火刚亮起来的那一会儿',
    position: '58% 50%',
  },
  {
    id: '02-fireworks',
    name: '烟花夜',
    note: '手持烟花，笑得最开心的一张',
    position: '56% 50%',
  },
  {
    id: '03-desk',
    name: '书桌微光',
    note: '台灯、旧键盘、蝴蝶',
    position: '50% 46%',
  },
  {
    id: '04-sam',
    name: '并肩',
    note: '机甲与流萤，火光很好看（偏暖）',
    position: '62% 46%',
  },
]

function log(...args) {
  try {
    // eslint-disable-next-line no-console
    console.log('[firefly-bg]', ...args)
  } catch {
    /* 日志失败不影响功能 */
  }
}

function sendJson(res, code, obj) {
  try {
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(obj))
  } catch {
    /* 客户端已断开 */
  }
}

/** 把一张图读出来发出去（带一次性缓存 + immutable，浏览器刷新不重下） */
function sendImage(res, dir, id, extFallback = 'jpg') {
  if (!/^[a-z0-9-]+$/i.test(String(id || ''))) {
    return sendJson(res, 400, { ok: false, error: 'bad id' })
  }
  const file = join(dir, `${id}.${extFallback}`)
  if (!existsSync(file)) return sendJson(res, 404, { ok: false, error: `no such image: ${id}` })
  try {
    const st = statSync(file)
    const buf = readFileSync(file)
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': String(buf.length),
      'cache-control': 'public, max-age=86400, immutable',
      // 让浏览器知道这张图会不会变：换壁纸是换文件名，所以可以长缓存
      etag: `"${id}-${st.size}"`,
    })
    res.end(buf)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e?.message ?? e) })
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1')
  const path = url.pathname
  const method = req.method || 'GET'

  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, error: 'read only' })
  }

  if (path === '/api/firefly-bg/list' || path === '/api/firefly-bg') {
    return sendJson(res, 200, {
      ok: true,
      wallpapers: WALLPAPERS.filter((w) => existsSync(join(WALL_DIR, `${w.id}.jpg`))),
    })
  }

  if (path.startsWith('/api/firefly-bg/img/')) {
    const id = decodeURIComponent(path.slice('/api/firefly-bg/img/'.length)).replace(/\.jpg$/i, '')
    return sendImage(res, WALL_DIR, id)
  }

  if (path.startsWith('/api/firefly-bg/thumb/')) {
    const id = decodeURIComponent(path.slice('/api/firefly-bg/thumb/'.length)).replace(/\.jpg$/i, '')
    return sendImage(res, THUMB_DIR, id)
  }

  if (path === '/api/firefly-bg/ping') {
    lastPing = {
      at: new Date().toISOString(),
      build: url.searchParams.get('b') || '',
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
    }
    return sendJson(res, 200, { ok: true, build: lastPing.build })
  }

  if (path === '/api/firefly-bg/health') {
    return sendJson(res, 200, {
      ok: true,
      version: 1,
      wallpapers: WALLPAPERS.length,
      dir: WALL_DIR,
      lastPing,
    })
  }

  return sendJson(res, 404, { ok: false, error: `unknown ${method} ${path}` })
}

export function apply(ctx) {
  try {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: '/api/firefly-bg',
          handler: async (req, res) => {
            try {
              await handle(req, res)
            } catch (e) {
              sendJson(res, 500, { ok: false, error: String(e?.message ?? e) })
            }
          },
        }),
      'firefly-bg: /api/firefly-bg 路由',
    )
    log('已挂载：壁纸 ' + WALLPAPERS.length + ' 张 → /api/firefly-bg/*')
  } catch (e) {
    // 路由没挂上不能让整个宿主起不来：浏览器半端会退回纯色渐变背景。
    log('HTTP 路由没挂上：' + String(e?.message ?? e))
  }
}
