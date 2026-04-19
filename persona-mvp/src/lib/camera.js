import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Frame source URL. Supports two modes:
 *
 * 1. WebSocket relay (Node frame-server on Mac):
 *    - Default: ws://<hostname>:3001/stream
 *
 * 2. Direct HTTP poll from iPhone MJPEG server:
 *    - Set ?frameSource=http://<iphone-ip>:8080/frame.jpg in the browser URL
 *    - Or set ?frameSource=<iphone-ip> (shorthand, auto-expands)
 *
 * The HTTP mode polls /frame.jpg every 250ms — no intermediate server needed.
 */
function getFrameSource() {
  const params = new URLSearchParams(window.location.search)
  const src = params.get('frameSource')
  if (src) {
    // If it looks like a bare IP, expand to full URL
    if (/^\d+\.\d+\.\d+\.\d+$/.test(src)) {
      return { mode: 'http', url: `http://${src}:8080/frame.jpg` }
    }
    if (src.startsWith('http')) {
      return { mode: 'http', url: src }
    }
  }
  // Default: WebSocket relay
  return { mode: 'ws', url: `ws://${window.location.hostname}:3001/stream` }
}

/**
 * Decode a JPEG Blob into an ImageData object via createImageBitmap + canvas.
 */
async function decodeJpeg(blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { imageData, canvas }
}

/**
 * React hook that receives frames from either:
 *  - WebSocket frame server (default)
 *  - iPhone MJPEG HTTP endpoint (via ?frameSource query param)
 *
 * Returns { captureFrame, cameraReady, error, frameUrl, videoRef }
 */
export function useCamera() {
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState(null)
  const [frameUrl, setFrameUrl] = useState(null)

  const latestBlobRef = useRef(null)
  const latestImageDataRef = useRef(null)
  const prevUrlRef = useRef(null)
  const videoRef = useRef(null)

  useEffect(() => {
    const source = getFrameSource()
    let disposed = false

    async function processFrame(blob) {
      try {
        latestBlobRef.current = blob
        const { imageData } = await decodeJpeg(blob)
        latestImageDataRef.current = imageData

        const url = URL.createObjectURL(blob)
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
        prevUrlRef.current = url
        setFrameUrl(url)
        setCameraReady(true)
        setError(null)
      } catch (err) {
        console.warn('[camera] Frame decode error:', err)
      }
    }

    if (source.mode === 'http') {
      // --- HTTP polling mode ---
      console.log('[camera] Using HTTP polling:', source.url)
      let timer = null

      async function poll() {
        if (disposed) return
        try {
          const resp = await fetch(source.url, { cache: 'no-store' })
          if (resp.ok) {
            const blob = await resp.blob()
            await processFrame(blob)
          }
        } catch (err) {
          // Silently retry — server might not have a frame yet
        }
        if (!disposed) {
          timer = setTimeout(poll, 250)
        }
      }

      poll()

      return () => {
        disposed = true
        clearTimeout(timer)
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      }
    } else {
      // --- WebSocket mode (default) ---
      console.log('[camera] Using WebSocket:', source.url)
      let ws = null
      let reconnectTimer = null

      function connect() {
        if (disposed) return
        ws = new WebSocket(source.url)
        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
          console.log('[camera] Connected to frame server')
          setError(null)
        }

        ws.onmessage = async (event) => {
          const blob = new Blob([event.data], { type: 'image/jpeg' })
          await processFrame(blob)
        }

        ws.onclose = () => {
          if (disposed) return
          console.log('[camera] Disconnected, reconnecting in 2s…')
          reconnectTimer = setTimeout(connect, 2000)
        }

        ws.onerror = (err) => {
          console.error('[camera] WebSocket error:', err)
          setError(new Error('Frame server connection failed'))
          ws.close()
        }
      }

      connect()

      return () => {
        disposed = true
        clearTimeout(reconnectTimer)
        if (ws) ws.close()
        if (prevUrlRef.current) URL.revokeObjectURL(prevUrlRef.current)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const captureFrame = useCallback(async () => {
    if (!latestImageDataRef.current || !latestBlobRef.current) return null
    return { imageData: latestImageDataRef.current, blob: latestBlobRef.current }
  }, [])

  return { videoRef, captureFrame, cameraReady, error, frameUrl }
}
