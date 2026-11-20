/** Tiny static file server for local animation iteration (development only). */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? '.')
const port = Number(process.argv[3] ?? 4173)
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jhf': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
}

http.createServer((req, res) => {
  let urlPath
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  } catch {
    res.writeHead(400).end('bad request')
    return
  }
  const file = path.join(root, urlPath === '/' ? '/index.html' : urlPath)
  const relative = path.relative(root, file)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    res.writeHead(403).end('forbidden')
    return
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(data)
  })
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`))
