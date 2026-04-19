import { WebSocketServer } from 'ws'

const PORT = 3001

// Latest frame buffer (raw JPEG bytes)
let latestFrame = null

// Connected frontend clients (subscribed to /stream)
const streamClients = new Set()

// --- Ingest server: iPhone pushes JPEG frames here ---
const ingestWss = new WebSocketServer({ noServer: true })

ingestWss.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress
  console.log(`[ingest] iPhone connected from ${remote}`)

  ws.on('message', (data, isBinary) => {
    if (!isBinary) {
      console.warn('[ingest] Ignoring non-binary message')
      return
    }
    latestFrame = data
    const now = new Date().toISOString()
    console.log(`[ingest] Frame received: ${data.byteLength} bytes @ ${now}`)

    // Forward to all subscribed frontend clients
    for (const client of streamClients) {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data)
      }
    }
  })

  ws.on('close', () => {
    console.log(`[ingest] iPhone disconnected (${remote})`)
  })
})

// --- Stream server: frontend subscribes to receive frames ---
const streamWss = new WebSocketServer({ noServer: true })

streamWss.on('connection', (ws, req) => {
  const remote = req.socket.remoteAddress
  console.log(`[stream] Frontend client connected from ${remote}`)
  streamClients.add(ws)

  // Send the latest frame immediately if we have one
  if (latestFrame && ws.readyState === 1) {
    ws.send(latestFrame)
  }

  ws.on('close', () => {
    streamClients.delete(ws)
    console.log(`[stream] Frontend client disconnected (${remote})`)
  })
})

// --- HTTP server for upgrade routing ---
import { createServer } from 'http'

const server = createServer((req, res) => {
  // Simple health check / latest frame endpoint
  if (req.method === 'GET' && req.url === '/latest-frame') {
    if (!latestFrame) {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': latestFrame.byteLength,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    })
    res.end(latestFrame)
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Persona Frame Server\n  /ingest  — iPhone pushes JPEG frames (WebSocket)\n  /stream  — Frontend subscribes to frames (WebSocket)\n  /latest-frame — GET latest JPEG\n')
})

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`)

  if (pathname === '/ingest') {
    ingestWss.handleUpgrade(req, socket, head, (ws) => {
      ingestWss.emit('connection', ws, req)
    })
  } else if (pathname === '/stream') {
    streamWss.handleUpgrade(req, socket, head, (ws) => {
      streamWss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[frame-server] Listening on 0.0.0.0:${PORT}`)
  console.log(`  iPhone → ws://<your-ip>:${PORT}/ingest`)
  console.log(`  Frontend → ws://localhost:${PORT}/stream`)
})
