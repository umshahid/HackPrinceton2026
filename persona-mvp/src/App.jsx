import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Users, BarChart2, UtensilsCrossed } from 'lucide-react'
import { SessionProvider, useSession, SessionState } from './lib/session'
import { getConsent, saveConsent } from './lib/storage'
import { useCamera } from './lib/camera'
import { useSpeechActivity, useTranscription } from './lib/audio'
import { loadSceneModel, classifyScene } from './lib/models/sceneClassifier'
import { loadFoodModel, detectFoodPresence } from './lib/models/foodDetector'
import { loadFaceModels, detectFace, cropFaceThumbnail, matchOrCreatePerson, loadPersonsFromStorage } from './lib/models/faceDetector'
import PeopleTab from './components/tabs/PeopleTab'
import MetricsTab from './components/tabs/MetricsTab'
import MealsTab from './components/tabs/MealsTab'
import PromptCard from './components/prompts/PromptCard'

// ---------------------------------------------------------------------------
// Consent Screen
// ---------------------------------------------------------------------------

function ConsentScreen({ onConsent }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', padding: '32px 24px',
      maxWidth: '480px', margin: '0 auto', background: 'var(--surface)',
    }}>
      <h1 style={{
        fontSize: '36px', marginBottom: '8px', fontWeight: 700,
        fontFamily: 'Manrope, sans-serif', color: 'var(--primary)',
      }}>Persona</h1>
      <p style={{ color: 'var(--on-surface-variant)', marginBottom: '32px', fontSize: '14px' }}>
        Privacy disclosure
      </p>
      <div className="card" style={{
        marginBottom: '32px', lineHeight: '1.7', fontSize: '14px',
        color: 'var(--on-surface-variant)',
      }}>
        Persona will use your camera and microphone to automatically log conversations,
        track where you spend your time, and identify meals. Faces and voice of people
        you speak with may be captured. All processing happens on your device. Transcripts
        are sent (as text only) to an AI service for summarization.
      </div>
      <button
        className="btn-primary"
        style={{ width: '100%', padding: '14px', borderRadius: '9999px', fontSize: '15px' }}
        onClick={async () => {
          await saveConsent(new Date().toISOString())
          onConsent()
        }}
      >
        I Agree &amp; Continue
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner App (inside SessionProvider)
// ---------------------------------------------------------------------------

function AppContent() {
  const session = useSession()
  const { state, startSession, stopSession, activePrompt, dismissPrompt, currentScene } = session

  const { videoRef, captureFrame, cameraReady } = useCamera()
  const { speechActive, startAudioMonitoring, stopAudioMonitoring } = useSpeechActivity()
  const { transcript, startTranscription, stopTranscription, isListening } = useTranscription()

  const [activeTab, setActiveTab] = useState('metrics')
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsReady, setModelsReady] = useState(false)

  // Visible video element for preview
  const previewRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const faceBoxRef = useRef(null)

  // Mirror camera stream to visible preview
  useEffect(() => {
    if (previewRef.current && videoRef.current) {
      const stream = videoRef.current.srcObject
      if (stream) {
        previewRef.current.srcObject = stream
      }
    }
  }, [cameraReady, videoRef])

  // Load models on first session start
  const handleStartSession = useCallback(async () => {
    if (!modelsReady) {
      setModelsLoading(true)
      try {
        await Promise.all([
          loadSceneModel(),
          loadFoodModel(),
          loadFaceModels(),
          loadPersonsFromStorage(),
        ])
        setModelsReady(true)
      } catch (err) {
        console.error('Model loading error:', err)
      }
      setModelsLoading(false)
    }

    // Start audio
    try { await startAudioMonitoring() } catch (e) { console.warn('Audio init:', e) }

    startSession()
  }, [modelsReady, startSession, startAudioMonitoring])

  const handleStopSession = useCallback(() => {
    stopSession()
    stopAudioMonitoring()
    if (isListening) stopTranscription()
  }, [stopSession, stopAudioMonitoring, isListening, stopTranscription])

  // Draw face bounding box on overlay canvas
  const drawFaceBox = useCallback((faceResult) => {
    faceBoxRef.current = faceResult
    const canvas = overlayCanvasRef.current
    const video = previewRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')
    // Match canvas size to displayed video size
    const rect = video.getBoundingClientRect()
    canvas.width = rect.width
    canvas.height = rect.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (!faceResult || !faceResult.box) return

    const { box } = faceResult
    // Scale from source video resolution to displayed size
    const videoW = video.videoWidth || 640
    const videoH = video.videoHeight || 480
    const scaleX = rect.width / videoW
    const scaleY = rect.height / videoH

    // Mirror the x coordinate (video is mirrored via scaleX(-1))
    const mirroredX = videoW - box.x - box.width

    const dx = mirroredX * scaleX
    const dy = box.y * scaleY
    const dw = box.width * scaleX
    const dh = box.height * scaleY

    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 2
    ctx.strokeRect(dx, dy, dw, dh)

    // Label
    ctx.fillStyle = '#4ade80'
    ctx.font = '12px monospace'
    ctx.fillText('Face detected', dx, dy - 6)
  }, [])

  // Expose detection functions to session polling via window (simple bridge)
  useEffect(() => {
    window.__persona = {
      captureFrame,
      classifyScene: async (imgData) => {
        // classifyScene expects an image element; create one from canvas
        const canvas = document.createElement('canvas')
        canvas.width = imgData.width
        canvas.height = imgData.height
        canvas.getContext('2d').putImageData(imgData, 0, 0)
        const result = await classifyScene(canvas)
        return result.label
      },
      detectFood: async (imgData) => {
        const canvas = document.createElement('canvas')
        canvas.width = imgData.width
        canvas.height = imgData.height
        canvas.getContext('2d').putImageData(imgData, 0, 0)
        const result = await detectFoodPresence(canvas)
        return { detected: result.isFoodPresent, labels: result.topLabels, confidence: result.confidence }
      },
      detectFaces: async (imgData) => {
        const canvas = document.createElement('canvas')
        canvas.width = imgData.width
        canvas.height = imgData.height
        canvas.getContext('2d').putImageData(imgData, 0, 0)
        const result = await detectFace(canvas)
        const thumbnailBase64 = result.detected ? cropFaceThumbnail(canvas, result.box) : null
        return { count: result.detected ? 1 : 0, thumbnailBase64, ...result }
      },
      onFaceDetected: drawFaceBox,
      speechActive,
      transcript,
      startTranscription,
      stopTranscription,
    }
  }, [captureFrame, drawFaceBox, speechActive, transcript, startTranscription, stopTranscription])

  const isRunning = state === SessionState.RUNNING
  const isStopped = state === SessionState.STOPPED

  const tabs = [
    { id: 'people', Icon: Users, label: 'People' },
    { id: 'metrics', Icon: BarChart2, label: 'Metrics' },
    { id: 'meals', Icon: UtensilsCrossed, label: 'Meals' },
  ]

  return (
    <div style={{ maxWidth: '480px', margin: '0 auto', minHeight: '100vh', position: 'relative' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', backgroundColor: 'var(--surface-card)',
        boxShadow: '0 1px 0 rgba(197,200,190,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isRunning ? (
            <span className="badge badge-running" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#f87171', display: 'inline-block',
                animation: 'pulse 1.5s infinite',
              }} />
              Recording
            </span>
          ) : isStopped ? (
            <span className="badge badge-stopped">Stopped</span>
          ) : (
            <span className="badge badge-idle">Idle</span>
          )}
        </div>

        <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, fontFamily: 'Manrope, sans-serif', color: 'var(--primary)' }}>Persona</h1>

        <div>
          {isRunning ? (
            <button className="btn-danger" style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 9999 }} onClick={handleStopSession}>
              End
            </button>
          ) : (
            <button className="btn-primary" style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 9999 }} onClick={handleStartSession}>
              Start
            </button>
          )}
        </div>
      </header>

      {/* Camera preview */}
      <div style={{
        width: '100%', aspectRatio: '16 / 9', background: 'var(--surface-nest)',
        position: 'relative', overflow: 'hidden',
      }}>
        <video
          ref={previewRef}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={overlayCanvasRef}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            pointerEvents: 'none',
          }}
        />
        {!cameraReady && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', fontSize: '14px',
          }}>
            Camera initializing...
          </div>
        )}
      </div>

      {/* Model loading overlay */}
      {modelsLoading && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(248,250,243,0.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', zIndex: 50, gap: '16px',
        }}>
          <div style={{
            width: 40, height: 40, border: '3px solid var(--surface-nest)',
            borderTopColor: 'var(--primary)', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ color: 'var(--on-surface-variant)', fontSize: '14px', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Loading Persona intelligence models…
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Tab content */}
      <div style={{ padding: '0', paddingBottom: '80px', overflowY: 'auto', background: 'var(--surface)' }}>
        {activeTab === 'people' && <PeopleTab />}
        {activeTab === 'metrics' && <MetricsTab />}
        {activeTab === 'meals' && <MealsTab />}
      </div>

      {/* Prompt card overlay */}
      {activePrompt && (
        <PromptCard
          trigger={activePrompt.type}
          contextData={activePrompt}
          onPrimary={dismissPrompt}
          onDismiss={dismissPrompt}
          timeoutSeconds={15}
        />
      )}

      {/* Bottom navigation */}
      <nav style={{
        position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
        maxWidth: 480, width: '100%', height: 64, display: 'flex',
        background: 'var(--surface-card)',
        boxShadow: '0 -1px 0 rgba(197,200,190,0.5)',
        zIndex: 100,
      }}>
        {tabs.map(({ id, Icon, label }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 3, background: 'none', border: 'none',
                color: active ? 'var(--primary)' : 'var(--on-surface-variant)',
                fontSize: '10px', cursor: 'pointer',
                fontWeight: active ? 700 : 500,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                letterSpacing: '0.02em',
                transition: 'color 400ms ease-in-out',
                position: 'relative',
                paddingBottom: 10,
              }}
            >
              <Icon
                size={22}
                strokeWidth={active ? 2 : 1.5}
                style={{ transition: 'stroke-width 400ms ease-in-out' }}
              />
              {label}
              {active && (
                <span style={{
                  position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
                  width: 4, height: 4, borderRadius: '50%', background: 'var(--primary)',
                }} />
              )}
            </button>
          )
        })}
      </nav>

      {/* Pulse animation */}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

export default function App() {
  const [consentGiven, setConsentGiven] = useState(null) // null = loading

  useEffect(() => {
    getConsent().then((c) => setConsentGiven(!!c))
  }, [])

  if (consentGiven === null) return null // loading consent check

  if (!consentGiven) {
    return <ConsentScreen onConsent={() => setConsentGiven(true)} />
  }

  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  )
}
