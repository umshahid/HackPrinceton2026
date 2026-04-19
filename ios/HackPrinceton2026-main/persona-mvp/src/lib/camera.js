import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Prompt the user to share a window/screen (pick the WhatsApp Desktop window
 * showing the glasses feed) and attach the resulting MediaStream to the video
 * element. Must be called from a user gesture (click) per browser policy.
 */
export async function initDisplayCapture(videoElement) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15 } },
    audio: false,
  })
  videoElement.srcObject = stream
  await videoElement.play()
  return stream
}

/**
 * Draw one frame from a playing video element to an offscreen canvas.
 * Returns { imageData, blob } where blob is a JPEG Blob.
 */
export async function captureFrame(videoElement) {
  const canvas = document.createElement('canvas')
  canvas.width = videoElement.videoWidth || 640
  canvas.height = videoElement.videoHeight || 480
  const ctx = canvas.getContext('2d')
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  )
  return { imageData, blob }
}

/**
 * Stop all tracks on a video element's media stream.
 */
export function stopCamera(videoElement) {
  const stream = videoElement?.srcObject
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
    videoElement.srcObject = null
  }
}

/**
 * React hook that manages a hidden video element fed by screen/window share.
 * Init is NOT automatic — call `startCapture()` from a click handler so the
 * browser's share picker appears. Pick the WhatsApp Desktop window.
 * Returns { videoRef, captureFrame, startCapture, cameraReady, error }
 */
export function useCamera() {
  const videoRef = useRef(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const video = document.createElement('video')
    video.setAttribute('autoplay', '')
    video.setAttribute('playsinline', '')
    video.muted = true
    video.style.display = 'none'
    document.body.appendChild(video)
    videoRef.current = video

    return () => {
      stopCamera(video)
      video.remove()
    }
  }, [])

  const startCapture = useCallback(async () => {
    if (!videoRef.current) return false
    if (cameraReady) return true
    try {
      const stream = await initDisplayCapture(videoRef.current)
      // If user stops sharing from the browser bar, reset.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setCameraReady(false)
      })
      setCameraReady(true)
      return true
    } catch (err) {
      console.error('Display capture init failed:', err)
      setError(err)
      return false
    }
  }, [cameraReady])

  const capture = useCallback(async () => {
    if (!videoRef.current || !cameraReady) return null
    return captureFrame(videoRef.current)
  }, [cameraReady])

  return { videoRef, captureFrame: capture, startCapture, cameraReady, error }
}
