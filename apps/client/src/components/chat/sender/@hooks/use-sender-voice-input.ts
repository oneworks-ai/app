/* eslint-disable max-lines -- Voice input coordinates recorder, waveform, transcription retry, and service selection state. */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import { getApiErrorMessage, getConfig, listSpeechToTextServices, transcribeSpeechToText, updateConfig } from '#~/api'
import type { SpeechToTextServiceSummary } from '@oneworks/types'
import type { SenderEditorHandle, SenderEditorSelection } from '../@types/sender-editor'
import type { SenderVoiceInputController } from '../@types/sender-voice-input'
import {
  BROWSER_WEB_SPEECH_SERVICE_ID,
  createBrowserSpeechRecognition,
  getClientSpeechToTextServices,
  isBrowserWebSpeechRecognitionAvailable,
  isClientSpeechToTextService,
  toServerSpeechToTextService
} from '../@utils/client-speech-to-text'
import type {
  BrowserSpeechRecognition,
  BrowserSpeechRecognitionErrorEvent,
  BrowserSpeechRecognitionResultEvent,
  SenderSpeechToTextServiceSummary
} from '../@utils/client-speech-to-text'

const DEFAULT_WAVEFORM_BAR_COUNT = 36
const MIN_WAVEFORM_BAR_COUNT = 16
const MAX_WAVEFORM_BAR_COUNT = 160
const createDefaultWaveformLevels = (count = DEFAULT_WAVEFORM_BAR_COUNT) => Array.from({ length: count }, () => .14)
const DEFAULT_WAVEFORM_LEVELS = createDefaultWaveformLevels()
const WAVEFORM_SAMPLE_INTERVAL_MS = 72

const getMediaRecorderMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ]
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate))
}

const hasAudioCaptureSupport = () => (
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function'
)

const hasRecordingSupport = () => (
  hasAudioCaptureSupport() &&
  typeof MediaRecorder !== 'undefined'
)

const hasAnySpeechInputSupport = () =>
  hasRecordingSupport() || (
    hasAudioCaptureSupport() &&
    isBrowserWebSpeechRecognitionAvailable()
  )

const getBrowserSpeechLanguage = () => (
  document.documentElement.lang.trim() ||
  navigator.language ||
  'en-US'
)

const getBrowserSpeechErrorMessageKey = (error: BrowserSpeechRecognitionErrorEvent['error']) => {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'chat.voiceInput.permissionDenied'
    case 'audio-capture':
      return 'chat.voiceInput.recordingFailed'
    case 'language-not-supported':
      return 'chat.voiceInput.browserLanguageUnsupported'
    case 'network':
      return 'chat.voiceInput.browserRecognitionNetwork'
    case 'no-speech':
      return 'chat.voiceInput.emptyRecording'
    default:
      return 'chat.voiceInput.transcribeFailed'
  }
}

const createAudioContext = () => {
  const AudioContextConstructor = window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioContextConstructor == null ? undefined : new AudioContextConstructor()
}

const clampSelection = (selection: SenderEditorSelection, value: string): SenderEditorSelection => {
  const start = Math.max(0, Math.min(selection.start, value.length))
  const end = Math.max(start, Math.min(selection.end, value.length))
  return { start, end }
}

const isWordLike = (value: string) => /[\p{L}\p{N}_]/u.test(value)

const formatTranscriptForInsertion = (
  transcript: string,
  value: string,
  selection: SenderEditorSelection
) => {
  const text = transcript.trim()
  if (text === '') return ''

  const before = selection.start > 0 ? value[selection.start - 1] : ''
  const after = selection.end < value.length ? value[selection.end] : ''
  const shouldPrefixSpace = before !== '' && !/\s/.test(before) && isWordLike(before) && isWordLike(text[0] ?? '')
  const shouldSuffixSpace = after !== '' && !/\s/.test(after) && isWordLike(after) &&
    isWordLike(text[text.length - 1] ?? '')
  return `${shouldPrefixSpace ? ' ' : ''}${text}${shouldSuffixSpace ? ' ' : ''}`
}

export const useSenderVoiceInput = ({
  canSendAfterTranscription,
  canStartRecording,
  editorRef,
  enabled,
  input,
  notifyError,
  notifySuccess,
  notifyWarning,
  onInputChange,
  onSendAfterTranscription,
  setInput
}: {
  canSendAfterTranscription: boolean
  canStartRecording: boolean
  editorRef: MutableRefObject<SenderEditorHandle | null>
  enabled: boolean
  input: string
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  notifyWarning: (message: string) => void
  onInputChange?: (value: string) => void
  onSendAfterTranscription: () => void
  setInput: Dispatch<SetStateAction<string>>
}): SenderVoiceInputController | undefined => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const servicesCacheKey = enabled ? '/api/voice/speech-to-text/services' : null
  const {
    data: servicesData,
    isLoading: loadingServices,
    mutate: mutateServices
  } = useSWR(servicesCacheKey, listSpeechToTextServices, {
    revalidateOnFocus: false
  })
  const configCacheKey = enabled ? '/api/config' : null
  const {
    data: configData,
    mutate: mutateConfig
  } = useSWR(configCacheKey, getConfig, {
    revalidateOnFocus: false
  })
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [setupOpen, setSetupOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [errorCanOpenConfig, setErrorCanOpenConfig] = useState(true)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [selectedServiceId, setSelectedServiceId] = useState<string | undefined>()
  const [settingDefaultServiceId, setSettingDefaultServiceId] = useState<string | undefined>()
  const [waveformLevels, setWaveformLevels] = useState(DEFAULT_WAVEFORM_LEVELS)
  const waveformCapacityRef = useRef(DEFAULT_WAVEFORM_BAR_COUNT)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const waveformFrameRef = useRef<number | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef(0)
  const chunksRef = useRef<BlobPart[]>([])
  const browserSpeechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const browserSpeechTranscriptRef = useRef('')
  const browserSpeechErrorRef = useRef<BrowserSpeechRecognitionErrorEvent['error'] | null>(null)
  const browserSpeechCanceledRef = useRef(false)
  const selectionRef = useRef<SenderEditorSelection | null>(null)
  const retryBlobRef = useRef<Blob | null>(null)
  const retryFilenameRef = useRef('recording.webm')
  const retrySendAfterTranscriptionRef = useRef(false)
  const sendAfterStopRef = useRef(false)
  const transcriptionAbortControllerRef = useRef<AbortController | null>(null)
  const transcriptionCanceledRef = useRef(false)
  const inputRef = useRef(input)
  const selectedServiceIdRef = useRef(selectedServiceId)

  inputRef.current = input
  selectedServiceIdRef.current = selectedServiceId

  const configuredDefaultServiceId = configData?.sources?.merged?.voice?.speechToText?.defaultServiceId
  const mergeSpeechToTextServices = useCallback((serverServiceSummaries: SpeechToTextServiceSummary[]) => {
    const serverServices = serverServiceSummaries.map(toServerSpeechToTextService)
    const hasServerDefault = serverServices.some(service => service.enabled && service.default)
    const browserWebSpeechIsDefault = configuredDefaultServiceId === BROWSER_WEB_SPEECH_SERVICE_ID ||
      (configuredDefaultServiceId == null && !hasServerDefault)
    return [
      ...serverServices,
      ...getClientSpeechToTextServices({
        isDefault: browserWebSpeechIsDefault,
        label: t('chat.voiceInput.browserWebSpeechService')
      })
    ]
  }, [configuredDefaultServiceId, t])
  const services = useMemo<SenderSpeechToTextServiceSummary[]>(
    () => mergeSpeechToTextServices(servicesData?.services ?? []),
    [mergeSpeechToTextServices, servicesData?.services]
  )
  const enabledServices = useMemo(() => services.filter(service => service.enabled), [services])
  const hasClientServices = useMemo(() => enabledServices.some(isClientSpeechToTextService), [enabledServices])
  const defaultService = useMemo(() => (
    enabledServices.find(service => service.default) ?? enabledServices[0]
  ), [enabledServices])
  const selectedService = useMemo(() => (
    enabledServices.find(service => service.id === selectedServiceId) ?? defaultService
  ), [defaultService, enabledServices, selectedServiceId])

  useEffect(() => {
    if (selectedServiceId == null) return
    if (enabledServices.some(service => service.id === selectedServiceId)) return
    setSelectedServiceId(undefined)
  }, [enabledServices, selectedServiceId])

  useEffect(() => {
    if (phase !== 'recording') return undefined
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)))
    }, 250)
    return () => window.clearInterval(timer)
  }, [phase])

  const cleanupWaveform = useCallback(() => {
    if (waveformFrameRef.current != null) {
      window.cancelAnimationFrame(waveformFrameRef.current)
      waveformFrameRef.current = null
    }
    const audioContext = audioContextRef.current
    audioContextRef.current = null
    if (audioContext != null && audioContext.state !== 'closed') {
      void audioContext.close()
    }
  }, [])

  const cleanupRecordingTimeout = useCallback(() => {
    if (recordingTimeoutRef.current != null) {
      window.clearTimeout(recordingTimeoutRef.current)
      recordingTimeoutRef.current = null
    }
  }, [])

  const cleanupBrowserSpeechRecognition = useCallback((options: { abort?: boolean } = {}) => {
    const recognition = browserSpeechRecognitionRef.current
    browserSpeechRecognitionRef.current = null
    if (recognition == null) return

    recognition.onend = null
    recognition.onerror = null
    recognition.onresult = null
    if (options.abort === true) {
      try {
        recognition.abort()
      } catch {}
    }
  }, [])

  const cleanupRecordingResources = useCallback(() => {
    cleanupRecordingTimeout()
    cleanupWaveform()
    cleanupBrowserSpeechRecognition({ abort: true })
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
    recordingStreamRef.current = null
    recorderRef.current = null
  }, [cleanupBrowserSpeechRecognition, cleanupRecordingTimeout, cleanupWaveform])

  useEffect(() => () => cleanupRecordingResources(), [cleanupRecordingResources])

  const resetWaveformLevels = useCallback(() => {
    setWaveformLevels(createDefaultWaveformLevels(waveformCapacityRef.current))
  }, [])

  const startWaveform = useCallback((stream: MediaStream) => {
    cleanupWaveform()
    try {
      const audioContext = createAudioContext()
      if (audioContext == null) return
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      const source = audioContext.createMediaStreamSource(stream)
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      audioContextRef.current = audioContext
      let lastSampleAt = 0
      const render = () => {
        analyser.getByteTimeDomainData(data)
        const now = Date.now()
        if (now - lastSampleAt >= WAVEFORM_SAMPLE_INTERVAL_MS) {
          let peak = 0
          for (const item of data) {
            peak = Math.max(peak, Math.abs(item - 128) / 128)
          }
          const nextLevel = Math.max(.08, Math.min(1, peak * 1.9))
          setWaveformLevels(previousLevels => {
            const capacity = waveformCapacityRef.current
            return [...previousLevels, nextLevel].slice(-capacity)
          })
          lastSampleAt = now
        }
        waveformFrameRef.current = window.requestAnimationFrame(render)
      }
      render()
    } catch {
      resetWaveformLevels()
    }
  }, [cleanupWaveform, resetWaveformLevels])

  const setVoiceError = useCallback((message: string, options: { canOpenConfig?: boolean } = {}) => {
    setErrorCanOpenConfig(options.canOpenConfig !== false)
    setErrorMessage(message)
    notifyError(message)
  }, [notifyError])

  const clearRetryAudio = useCallback(() => {
    retryBlobRef.current = null
    retryFilenameRef.current = 'recording.webm'
    retrySendAfterTranscriptionRef.current = false
  }, [])

  const setWaveformCapacity = useCallback((capacity: number) => {
    const nextCapacity = Math.max(
      MIN_WAVEFORM_BAR_COUNT,
      Math.min(MAX_WAVEFORM_BAR_COUNT, Math.round(capacity))
    )
    if (waveformCapacityRef.current === nextCapacity) return

    waveformCapacityRef.current = nextCapacity
    setWaveformLevels(previousLevels => {
      if (previousLevels.length === nextCapacity) return previousLevels
      if (previousLevels.length > nextCapacity) return previousLevels.slice(previousLevels.length - nextCapacity)
      return [
        ...createDefaultWaveformLevels(nextCapacity - previousLevels.length),
        ...previousLevels
      ]
    })
  }, [])

  const insertTranscript = useCallback((text: string) => {
    const editor = editorRef.current
    const currentValue = editor?.getValue() ?? inputRef.current
    const selection = clampSelection(
      selectionRef.current ?? {
        start: currentValue.length,
        end: currentValue.length
      },
      currentValue
    )
    const insertion = formatTranscriptForInsertion(text, currentValue, selection)
    if (insertion === '') return currentValue

    const nextValue = `${currentValue.slice(0, selection.start)}${insertion}${currentValue.slice(selection.end)}`
    const nextSelection = {
      end: selection.start + insertion.length,
      start: selection.start + insertion.length
    }

    setInput(nextValue)
    onInputChange?.(nextValue)

    if (editor != null) {
      if (editor.isDisabled()) {
        editor.setValue(nextValue, nextSelection)
      } else {
        editor.replaceSelection(insertion, selection)
        if (editor.getValue() !== nextValue) {
          editor.setValue(nextValue, nextSelection)
        }
      }
      return nextValue
    }

    return nextValue
  }, [editorRef, onInputChange, setInput])

  const completeTranscription = useCallback((text: string, sendAfterTranscription: boolean) => {
    insertTranscript(text)
    clearRetryAudio()
    setErrorMessage(undefined)
    setSetupOpen(false)
    setPhase('idle')
    setElapsedSeconds(0)
    resetWaveformLevels()
    if (sendAfterTranscription) {
      window.requestAnimationFrame(() => onSendAfterTranscription())
    }
  }, [clearRetryAudio, insertTranscript, onSendAfterTranscription])

  const submitAudioForTranscription = useCallback(async ({
    blob,
    filename,
    sendAfterTranscription
  }: {
    blob: Blob
    filename: string
    sendAfterTranscription: boolean
  }) => {
    setPhase('transcribing')
    if (transcriptionCanceledRef.current) {
      transcriptionCanceledRef.current = false
      clearRetryAudio()
      setErrorMessage(undefined)
      setPhase('idle')
      setElapsedSeconds(0)
      resetWaveformLevels()
      editorRef.current?.focus()
      return
    }
    transcriptionCanceledRef.current = false

    if (blob.size === 0) {
      setPhase('idle')
      clearRetryAudio()
      setVoiceError(t('chat.voiceInput.emptyRecording'))
      return
    }

    try {
      retryBlobRef.current = blob
      retryFilenameRef.current = filename
      retrySendAfterTranscriptionRef.current = sendAfterTranscription
      const abortController = new AbortController()
      transcriptionAbortControllerRef.current = abortController
      const response = await transcribeSpeechToText({
        audio: blob,
        filename,
        signal: abortController.signal,
        serviceId: selectedServiceIdRef.current
      })
      completeTranscription(response.result.text, sendAfterTranscription)
    } catch (error) {
      if (transcriptionCanceledRef.current) {
        transcriptionCanceledRef.current = false
        clearRetryAudio()
        setErrorMessage(undefined)
        setPhase('idle')
        setElapsedSeconds(0)
        resetWaveformLevels()
        editorRef.current?.focus()
        return
      }
      setPhase('idle')
      retryBlobRef.current = blob
      retryFilenameRef.current = filename
      retrySendAfterTranscriptionRef.current = sendAfterTranscription
      setVoiceError(getApiErrorMessage(error, t('chat.voiceInput.transcribeFailed')))
    } finally {
      transcriptionAbortControllerRef.current = null
    }
  }, [clearRetryAudio, completeTranscription, editorRef, setVoiceError, t])

  const finishRecording = useCallback(async (recorderMimeType: string) => {
    const sendAfterTranscription = sendAfterStopRef.current
    sendAfterStopRef.current = false
    cleanupRecordingResources()

    const blob = new Blob(chunksRef.current, {
      type: recorderMimeType || 'audio/webm'
    })
    chunksRef.current = []
    const filename = recorderMimeType.includes('mp4') ? 'recording.mp4' : 'recording.webm'

    await submitAudioForTranscription({ blob, filename, sendAfterTranscription })
  }, [cleanupRecordingResources, submitAudioForTranscription])

  const finishBrowserSpeechRecognition = useCallback(() => {
    const sendAfterTranscription = sendAfterStopRef.current
    const transcript = browserSpeechTranscriptRef.current.trim()
    const error = browserSpeechErrorRef.current
    const wasCanceled = browserSpeechCanceledRef.current
    sendAfterStopRef.current = false
    browserSpeechTranscriptRef.current = ''
    browserSpeechErrorRef.current = null
    browserSpeechCanceledRef.current = false
    browserSpeechRecognitionRef.current = null
    cleanupRecordingResources()

    if (wasCanceled) {
      clearRetryAudio()
      setErrorMessage(undefined)
      setPhase('idle')
      setElapsedSeconds(0)
      resetWaveformLevels()
      editorRef.current?.focus()
      return
    }

    if (transcript !== '') {
      completeTranscription(transcript, sendAfterTranscription)
      return
    }

    setPhase('idle')
    clearRetryAudio()
    setVoiceError(t(error == null ? 'chat.voiceInput.emptyRecording' : getBrowserSpeechErrorMessageKey(error)), {
      canOpenConfig: false
    })
  }, [cleanupRecordingResources, clearRetryAudio, completeTranscription, editorRef, setVoiceError, t])

  const startBrowserSpeechRecognition = useCallback(async () => {
    const recognition = createBrowserSpeechRecognition()
    if (recognition == null) {
      setVoiceError(t('chat.voiceInput.unsupported'))
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      browserSpeechTranscriptRef.current = ''
      browserSpeechErrorRef.current = null
      browserSpeechCanceledRef.current = false
      recordingStreamRef.current = stream
      recordingStartedAtRef.current = Date.now()
      setElapsedSeconds(0)
      resetWaveformLevels()
      startWaveform(stream)

      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = getBrowserSpeechLanguage()
      recognition.onresult = (event: BrowserSpeechRecognitionResultEvent) => {
        let transcript = ''
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0]?.transcript ?? ''
        }
        browserSpeechTranscriptRef.current = transcript
      }
      recognition.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
        browserSpeechErrorRef.current = event.error
      }
      recognition.onend = finishBrowserSpeechRecognition
      browserSpeechRecognitionRef.current = recognition
      recognition.start()
      setPhase('recording')
      setSetupOpen(false)
    } catch (error) {
      cleanupRecordingResources()
      setPhase('idle')
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setVoiceError(t('chat.voiceInput.permissionDenied'), { canOpenConfig: false })
        return
      }
      setVoiceError(t('chat.voiceInput.recordingFailed'), { canOpenConfig: false })
    }
  }, [cleanupRecordingResources, finishBrowserSpeechRecognition, setVoiceError, startWaveform, t])

  const startRecording = useCallback(async () => {
    if (!enabled || phase !== 'idle') return
    setErrorCanOpenConfig(true)
    setErrorMessage(undefined)
    clearRetryAudio()

    if (!hasAnySpeechInputSupport()) {
      setVoiceError(t('chat.voiceInput.unsupported'))
      return
    }

    if (!canStartRecording) {
      notifyWarning(t('chat.voiceInput.unavailable'))
      return
    }

    let response = servicesData
    try {
      response ??= await mutateServices()
    } catch (error) {
      if (!isBrowserWebSpeechRecognitionAvailable()) {
        setVoiceError(getApiErrorMessage(error, t('chat.voiceInput.loadServicesFailed')))
        return
      }
    }
    const availableServices = mergeSpeechToTextServices(response?.services ?? [])
      .filter(service => service.enabled)
    if (availableServices.length === 0) {
      setSetupOpen(true)
      return
    }
    const activeService = availableServices.find(service => service.id === selectedServiceIdRef.current) ??
      availableServices.find(service => service.default) ??
      availableServices[0]

    selectionRef.current = editorRef.current?.getSelection() ?? {
      start: inputRef.current.length,
      end: inputRef.current.length
    }

    if (isClientSpeechToTextService(activeService)) {
      await startBrowserSpeechRecognition()
      return
    }

    if (!hasRecordingSupport()) {
      setVoiceError(t('chat.voiceInput.unsupported'))
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getMediaRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType == null ? undefined : { mimeType })
      chunksRef.current = []
      recordingStreamRef.current = stream
      recorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()
      setElapsedSeconds(0)
      resetWaveformLevels()
      startWaveform(stream)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }
      recorder.onerror = () => {
        recorder.onstop = null
        chunksRef.current = []
        sendAfterStopRef.current = false
        cleanupRecordingResources()
        setPhase('idle')
        setVoiceError(t('chat.voiceInput.recordingFailed'))
      }
      recorder.onstop = () => {
        void finishRecording(recorder.mimeType)
      }
      recorder.start()
      if (activeService?.maxDurationSeconds != null && activeService.maxDurationSeconds > 0) {
        recordingTimeoutRef.current = window.setTimeout(() => {
          const activeRecorder = recorderRef.current
          if (activeRecorder == null || activeRecorder.state === 'inactive') return
          sendAfterStopRef.current = false
          setPhase('transcribing')
          try {
            activeRecorder.requestData()
            activeRecorder.stop()
          } catch {
            void finishRecording(activeRecorder.mimeType)
          }
        }, activeService.maxDurationSeconds * 1000)
      }
      setPhase('recording')
      setSetupOpen(false)
    } catch (error) {
      cleanupRecordingResources()
      setPhase('idle')
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setVoiceError(t('chat.voiceInput.permissionDenied'), { canOpenConfig: false })
        return
      }
      setVoiceError(t('chat.voiceInput.recordingFailed'))
    }
  }, [
    canStartRecording,
    clearRetryAudio,
    cleanupRecordingResources,
    editorRef,
    enabled,
    finishRecording,
    mergeSpeechToTextServices,
    mutateServices,
    notifyWarning,
    phase,
    servicesData,
    setVoiceError,
    startBrowserSpeechRecognition,
    startWaveform,
    t
  ])

  const cancelRecording = useCallback(() => {
    if (phase !== 'recording') return
    sendAfterStopRef.current = false
    chunksRef.current = []
    const recognition = browserSpeechRecognitionRef.current
    if (recognition != null) {
      browserSpeechCanceledRef.current = true
      cleanupRecordingResources()
      clearRetryAudio()
      setPhase('idle')
      setElapsedSeconds(0)
      resetWaveformLevels()
      editorRef.current?.focus()
      return
    }
    const recorder = recorderRef.current
    recorder?.stream.getTracks().forEach(track => track.stop())
    if (recorder != null && recorder.state !== 'inactive') {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {}
    }
    cleanupRecordingResources()
    clearRetryAudio()
    setPhase('idle')
    setElapsedSeconds(0)
    resetWaveformLevels()
    editorRef.current?.focus()
  }, [clearRetryAudio, cleanupRecordingResources, editorRef, phase])

  useEffect(() => {
    if (phase !== 'recording') return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelRecording()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [cancelRecording, phase])

  const stopRecording = useCallback((options?: { sendAfterTranscription?: boolean }) => {
    if (phase !== 'recording') return
    const recognition = browserSpeechRecognitionRef.current
    if (recognition != null) {
      sendAfterStopRef.current = options?.sendAfterTranscription === true && canSendAfterTranscription
      setPhase('transcribing')
      try {
        recognition.stop()
      } catch {
        finishBrowserSpeechRecognition()
      }
      return
    }
    const recorder = recorderRef.current
    sendAfterStopRef.current = options?.sendAfterTranscription === true && canSendAfterTranscription
    setPhase('transcribing')
    if (recorder == null || recorder.state === 'inactive') {
      void finishRecording('audio/webm')
      return
    }
    try {
      recorder.requestData()
      recorder.stop()
    } catch {
      void finishRecording(recorder.mimeType)
    }
  }, [canSendAfterTranscription, finishBrowserSpeechRecognition, finishRecording, phase])

  const retryTranscription = useCallback(() => {
    if (phase !== 'idle') return
    const blob = retryBlobRef.current
    if (blob == null) return
    void submitAudioForTranscription({
      blob,
      filename: retryFilenameRef.current,
      sendAfterTranscription: retrySendAfterTranscriptionRef.current
    })
  }, [phase, submitAudioForTranscription])

  const cancelTranscription = useCallback(() => {
    if (phase !== 'transcribing') return
    const recognition = browserSpeechRecognitionRef.current
    if (recognition != null) {
      browserSpeechCanceledRef.current = true
      cleanupRecordingResources()
    }
    transcriptionCanceledRef.current = true
    transcriptionAbortControllerRef.current?.abort()
    setPhase('idle')
    setElapsedSeconds(0)
    resetWaveformLevels()
    editorRef.current?.focus()
  }, [cleanupRecordingResources, editorRef, phase])

  const setDefaultService = useCallback((serviceId: string) => {
    if (serviceId.trim() === '') return
    setSettingDefaultServiceId(serviceId)
    void (async () => {
      try {
        const config = await getConfig()
        const currentVoice = config.sources?.user?.voice ?? {}
        await updateConfig('user', 'voice', {
          ...currentVoice,
          speechToText: {
            ...(currentVoice.speechToText ?? {}),
            defaultServiceId: serviceId
          }
        })
        setSelectedServiceId(serviceId)
        await Promise.all([
          mutateConfig(),
          mutateServices()
        ])
        notifySuccess(t('chat.voiceInput.defaultSaved'))
      } catch (error) {
        setVoiceError(getApiErrorMessage(error, t('chat.voiceInput.defaultSaveFailed')))
      } finally {
        setSettingDefaultServiceId(undefined)
      }
    })()
  }, [mutateConfig, mutateServices, notifySuccess, setVoiceError, t])

  const openConfig = useCallback(() => {
    void navigate('/config?section=voice.speechToText')
  }, [navigate])

  const controller = useMemo<SenderVoiceInputController>(() => ({
    handlers: {
      cancelRecording,
      cancelTranscription,
      dismissNotice: () => {
        setSetupOpen(false)
        setErrorCanOpenConfig(true)
        setErrorMessage(undefined)
      },
      openConfig,
      retryTranscription,
      selectService: (serviceId?: string) => {
        setSelectedServiceId(serviceId)
        setErrorCanOpenConfig(true)
        setErrorMessage(undefined)
      },
      setDefaultService,
      startRecording,
      setWaveformCapacity,
      stopRecording
    },
    state: {
      canRetry: retryBlobRef.current != null,
      canStartRecording,
      canSendAfterTranscription,
      elapsedSeconds,
      enabled,
      errorCanOpenConfig,
      errorMessage,
      loadingServices: loadingServices && !hasClientServices,
      phase,
      selectedServiceId,
      selectedServiceLabel: selectedService?.label,
      settingDefaultServiceId,
      services,
      setupOpen,
      unsupported: !hasAnySpeechInputSupport(),
      waveformLevels
    }
  }), [
    cancelRecording,
    cancelTranscription,
    canSendAfterTranscription,
    canStartRecording,
    elapsedSeconds,
    enabled,
    errorCanOpenConfig,
    errorMessage,
    hasClientServices,
    loadingServices,
    openConfig,
    phase,
    retryTranscription,
    selectedService?.label,
    selectedServiceId,
    setDefaultService,
    setWaveformCapacity,
    settingDefaultServiceId,
    services,
    setupOpen,
    startRecording,
    stopRecording,
    waveformLevels
  ])

  return enabled ? controller : undefined
}
