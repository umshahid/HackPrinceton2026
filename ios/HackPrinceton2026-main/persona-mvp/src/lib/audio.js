import { useState, useRef, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Speech Activity Detection
// ---------------------------------------------------------------------------

/**
 * Hook that monitors microphone audio energy to detect speech activity.
 * Returns { speechActive, startAudioMonitoring, stopAudioMonitoring }
 */
export function useSpeechActivity(threshold = 0.02) {
  const [speechActive, setSpeechActive] = useState(false)
  const ctxRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  const startAudioMonitoring = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    const audioCtx = new AudioContext()
    ctxRef.current = audioCtx

    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const dataArray = new Float32Array(analyser.fftSize)

    const sample = () => {
      analyser.getFloatTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i]
      }
      const rms = Math.sqrt(sum / dataArray.length)
      setSpeechActive(rms > threshold)
      timerRef.current = setTimeout(sample, 500)
    }

    sample()
  }, [threshold])

  const stopAudioMonitoring = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close()
      ctxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setSpeechActive(false)
  }, [])

  return { speechActive, startAudioMonitoring, stopAudioMonitoring }
}

// ---------------------------------------------------------------------------
// Transcription via Web Speech API
// ---------------------------------------------------------------------------

const SpeechRecognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

/**
 * Hook that uses the browser's SpeechRecognition API for live transcription.
 * Returns { transcript, startTranscription, stopTranscription, isListening }
 */
export function useTranscription() {
  const [transcript, setTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef(null)

  const startTranscription = useCallback(() => {
    if (!SpeechRecognition) {
      console.warn('SpeechRecognition not supported in this browser')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    let finalTranscript = ''

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' '
        } else {
          interim += result[0].transcript
        }
      }
      setTranscript(finalTranscript + interim)
    }

    recognition.onerror = (event) => {
      console.error('SpeechRecognition error:', event.error)
      if (event.error !== 'no-speech') {
        setIsListening(false)
      }
    }

    recognition.onend = () => {
      // Restart if still supposed to be listening (browser may auto-stop)
      if (recognitionRef.current) {
        try {
          recognition.start()
        } catch {
          // already started
        }
      }
    }

    recognition.start()
    setIsListening(true)
    setTranscript('')
  }, [])

  const stopTranscription = useCallback(() => {
    if (recognitionRef.current) {
      const rec = recognitionRef.current
      recognitionRef.current = null
      rec.stop()
    }
    setIsListening(false)
    // Return current transcript value — callers can also read transcript from state
    return transcript
  }, [transcript])

  return { transcript, startTranscription, stopTranscription, isListening }
}
