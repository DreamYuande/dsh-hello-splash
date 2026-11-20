import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { bootGlobal, configEndpoint, configGlobal, launchEndpoint, launchGlobal, legacyKey, normalizeSettings } from './config.js'

export const inject = ['profileContext', 'webServer', 'connection']

/** Serialized as a classic script by the host's official index-injection API. */
function coverBeforeMount(configKey, bootKey, storageKey, launchKey, readyPath) {
  if (!window.dshDesktopBoot || window !== window.top ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches || window[bootKey] || window[launchKey]?.animated) return
  let settings = window[configKey]
  if (settings === null) {
    try { settings = JSON.parse(localStorage.getItem(storageKey)) } catch {}
  }
  if (settings?.enabled === false) return

  const cover = document.createElement('div')
  const background = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(settings?.background) ? settings.background : '#FFFFFF'
  cover.id = 'dshhs-boot-cover'
  cover.setAttribute('aria-hidden', 'true')
  cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:' + background
  document.body.append(cover)

  const state = { skipped: false, release }
  window[bootKey] = state
  const timer = setTimeout(skip, 4200)
  const launch = window[launchKey]
  if (launch) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!state.skipped) void fetch(readyPath, {
        method: 'POST',
        headers: { 'x-dsh-hello-launch': launch.id },
        cache: 'no-store',
      }).catch(() => {})
    }))
  }
  if (settings?.escSkip !== false) window.addEventListener('keydown', onKeyDown, true)

  function release() {
    clearTimeout(timer)
    window.removeEventListener('keydown', onKeyDown, true)
    cover.remove()
  }

  function skip() {
    state.skipped = true
    release()
  }

  function onKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    skip()
  }
}

export function apply(ctx) {
  const file = join(ctx.profileContext.dir, 'plugin-data', 'dsh-hello-splash', 'config.json')
  const launchRequest = join(dirname(file), 'launch.request')
  const readLaunch = () => {
    try {
      if (Date.now() - statSync(launchRequest).mtimeMs > 18000) return null
      const [id, mode] = readFileSync(launchRequest, 'utf8').trim().split(/\s+/)
      return /^[0-9a-f]{32}$/.test(id) ? { id, animated: mode === 'animated' } : null
    } catch {
      return null
    }
  }
  const readSettings = () => {
    try {
      return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      if (error.code !== 'ENOENT') ctx.logger.warn('hello-splash: could not read profile settings')
      return null
    }
  }
  ctx.on('webserver/index-inject', (table) => {
    table.push(
      { kind: 'global', name: configGlobal, value: readSettings() },
      { kind: 'global', name: launchGlobal, value: readLaunch() },
      { kind: 'script', placement: 'body', text: '(' + coverBeforeMount.toString() + ')(' +
        [configGlobal, bootGlobal, legacyKey, launchGlobal, launchEndpoint].map(key => JSON.stringify(key)).join(',') + ')' },
    )
  }, { prepend: true })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: launchEndpoint,
    handler: async (req, res) => {
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) return res.writeHead(rejection).end()
      if (req.method !== 'POST') return res.writeHead(405).end()
      const token = readLaunch()?.id
      if (!token || req.headers['x-dsh-hello-launch'] !== token) return res.writeHead(409).end()
      try {
        await writeFile(join(dirname(file), 'launch-ready-' + token), '', { flag: 'wx' })
      } catch (error) {
        if (error.code !== 'EEXIST') return res.writeHead(503).end()
      }
      return res.writeHead(204).end()
    },
  }), 'hello-splash: launcher handoff')

  let pending = Promise.resolve()
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: configEndpoint,
    handler: async (req, res) => {
      const respond = (code, body) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(body))
      }
      try {
        const rejection = ctx.connection.requestRejection(req)
        if (rejection !== undefined) return respond(rejection, { error: 'Request rejected' })
        if (req.method === 'GET') return respond(200, readSettings())
        if (req.method !== 'PUT') return respond(405, { error: 'Method not allowed' })
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
          return respond(415, { error: 'Expected JSON' })
        }
        const chunks = []
        let length = 0
        for await (const chunk of req.iterator({ destroyOnReturn: false })) {
          length += chunk.length
          if (length > 4096) {
            req.resume()
            return respond(413, { error: 'Settings too large' })
          }
          chunks.push(chunk)
        }
        let input
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {}
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          return respond(400, { error: 'Invalid settings' })
        }
        const settings = normalizeSettings(input)
        const write = pending.then(async () => {
          const temporary = file + '.' + randomUUID() + '.tmp'
          await mkdir(dirname(file), { recursive: true })
          try {
            await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n')
            await rename(temporary, file)
          } finally {
            await rm(temporary, { force: true })
          }
        })
        pending = write.catch(() => {})
        await write
        return respond(200, settings)
      } catch {
        ctx.logger.warn('hello-splash: settings request failed')
        return respond(500, { error: 'Could not access profile settings' })
      }
    },
  }), 'hello-splash: settings API')
}


