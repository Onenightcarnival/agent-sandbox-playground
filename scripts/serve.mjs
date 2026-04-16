/**
 * Production server: serves VitePress static build + proxies /api/* to LLM API.
 * Zero extra dependencies — uses Node.js built-in modules only.
 *
 * Usage:
 *   npm run build
 *   npm run serve
 *
 * Configure API_TARGET in .env file or via environment variable.
 * Then open http://localhost:3000 and set Base URL to /api/v1
 */

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Load .env file
const envFile = path.join(ROOT, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.+?)\s*$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2]
    }
  }
}

const PORT = parseInt(process.env.PORT || '3000')
const API_TARGET = (process.env.API_TARGET || '').replace(/\/+$/, '')
const DIST = path.resolve(ROOT, 'docs/.vitepress/dist')

if (!API_TARGET) {
  console.error('Usage: API_TARGET=http://your-llm-api:8000 node scripts/serve.mjs')
  process.exit(1)
}

if (!fs.existsSync(DIST)) {
  console.error(`Build output not found at ${DIST}. Run "npm run build" first.`)
  process.exit(1)
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

function serveStatic(req, res) {
  let filePath = path.join(DIST, req.url === '/' ? '/index.html' : req.url)

  // Try .html fallback for clean URLs
  if (!path.extname(filePath) && !filePath.endsWith('/')) {
    filePath += '.html'
  }

  if (!fs.existsSync(filePath)) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
  }

  const ext = path.extname(filePath)
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
  fs.createReadStream(filePath).pipe(res)
}

const isHttps = API_TARGET.startsWith('https')
const transport = isHttps ? https : http

function proxyRequest(req, res) {
  const targetPath = req.url.replace(/^\/api/, '')
  const targetUrl = new URL(targetPath, API_TARGET)

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: { ...req.headers, host: targetUrl.host },
    rejectUnauthorized: false,
  }

  const proxyReq = transport.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, {
      ...proxyRes.headers,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': '*',
      'access-control-allow-headers': '*',
    })
    proxyRes.pipe(res)
  })

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: `Proxy error: ${err.message}` }))
  })

  req.pipe(proxyReq)
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': '*',
      'access-control-allow-headers': '*',
      'access-control-max-age': '86400',
    })
    res.end()
    return
  }

  if (req.url.startsWith('/api')) {
    proxyRequest(req, res)
  } else {
    serveStatic(req, res)
  }
})

server.listen(PORT, () => {
  console.log(`Serving:  http://localhost:${PORT}`)
  console.log(`API proxy: /api/* -> ${API_TARGET}`)
  console.log(`\nSet Base URL in playground to: /api/v1`)
})
