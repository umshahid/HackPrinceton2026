import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Request webcam access and attach stream to a video element.
 */
export async function initCamera(videoElement) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true })
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
 * React hook that manages a hidden video element for webcam capture.
 * Returns { videoRef, captureFrame, cameraReady, error }
 */
export function useCamera() {
  const videoRef = useRef(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    // Create a hidden video element
    const video = document.createElement('video')
    video.setAttribute('autoplay', '')
    video.setAttribute('playsinline', '')
    video.style.display = 'none'
    document.body.appendChild(video)
    videoRef.current = video

    initCamera(video)
      .then(() => setCameraReady(true))
      .catch((err) => {
        console.error('Camera init failed:', err)
        setError(err)
      })

    return () => {
      stopCamera(video)
      video.remove()
    }
  }, [])

  const capture = useCallback(async () => {
    if (!videoRef.current || !cameraReady) return null
    return captureFrame(videoRef.current)
  }, [cameraReady])

  return { videoRef, captureFrame: capture, cameraReady, error }
}
