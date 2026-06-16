/* eslint-disable max-lines -- Voice input coordinates recorder, waveform, transcription retry, and service selection state. */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

import { getApiErrorMessage, getConfig, listSpeechToTextServices, transcribeSpeechToText, updateConfig } from '#~/api'
import type { SenderEditorHandle, SenderEditorSelection } from '../@types/sender-editor'
import type { SenderVoiceInputController } from '../@types/sender-voice-input'

const WAVEFORM_BAR_COUNT = 28
const DEFAULT_WAVEFORM_LEVELS = Array.from({ length: WAVEFORM_BAR_COUNT }, () => .14)

const getMediaRecorderMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4'
  ]
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate))
}

const hasRecordingSupport = () => (
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  typeof MediaRecorder !== 'undefined'
)

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
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [setupOpen, setSetupOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>()
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [selectedServiceId, setSelectedServiceId] = useState<string | undefined>()
  const [settingDefaultServiceId, setSettingDefaultServiceId] = useState<string | undefined>()
  const [waveformLevels, setWaveformLevels] = useState(DEFAULT_WAVEFORM_LEVELS)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const waveformFrameRef = useRef<number | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingStartedAtRef = useRef(0)
  const chunksRef = useRef<BlobPart[]>([])
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

  const services = useMemo(() => servicesData?.services ?? [], [servicesData?.services])
  const enabledServices = useMemo(() => services.filter(service => service.enabled), [services])
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

  const cleanupRecordingResources = useCallback(() => {
    cleanupRecordingTimeout()
    cleanupWaveform()
    recordingStreamRef.current?.getTracks().forEach(track => track.stop())
    recordingStreamRef.current = null
    recorderRef.current = null
  }, [cleanupRecordingTimeout, cleanupWaveform])

  useEffect(() => () => cleanupRecordingResources(), [cleanupRecordingResources])

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
      const render = () => {
        analyser.getByteTimeDomainData(data)
        const bucketSize = Math.max(1, Math.floor(data.length / WAVEFORM_BAR_COUNT))
        const nextLevels = Array.from({ length: WAVEFORM_BAR_COUNT }, (_, index) => {
          let peak = 0
          const start = index * bucketSize
          const end = Math.min(data.length, start + bucketSize)
          for (let itemIndex = start; itemIndex < end; itemIndex += 1) {
            peak = Math.max(peak, Math.abs(data[itemIndex] - 128) / 128)
          }
          return Math.max(.08, Math.min(1, peak * 1.8))
        })
        setWaveformLevels(nextLevels)
        waveformFrameRef.current = window.requestAnimationFrame(render)
      }
      render()
    } catch {
      setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
    }
  }, [cleanupWaveform])

  const setVoiceError = useCallback((message: string) => {
    setErrorMessage(message)
    notifyError(message)
  }, [notifyError])

  const clearRetryAudio = useCallback(() => {
    retryBlobRef.current = null
    retryFilenameRef.current = 'recording.webm'
    retrySendAfterTranscriptionRef.current = false
  }, [])

  const insertTranscript = useCallback((text: string) => {
    const editor = editorRef.current
    if (editor != null) {
      const currentValue = editor.getValue()
      const selection = clampSelection(
        selectionRef.current ?? {
          start: currentValue.length,
          end: currentValue.length
        },
        currentValue
      )
      editor.replaceSelection(formatTranscriptForInsertion(text, currentValue, selection), selection)
      return editor.getValue()
    }

    const selection = clampSelection(
      selectionRef.current ?? {
        start: inputRef.current.length,
        end: inputRef.current.length
      },
      inputRef.current
    )
    const insertion = formatTranscriptForInsertion(text, inputRef.current, selection)
    const nextValue = `${inputRef.current.slice(0, selection.start)}${insertion}${
      inputRef.current.slice(selection.end)
    }`
    setInput(nextValue)
    onInputChange?.(nextValue)
    return nextValue
  }, [editorRef, onInputChange, setInput])

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
      setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
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
      insertTranscript(response.result.text)
      clearRetryAudio()
      setErrorMessage(undefined)
      setSetupOpen(false)
      setPhase('idle')
      setElapsedSeconds(0)
      setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
      if (sendAfterTranscription) {
        window.requestAnimationFrame(() => onSendAfterTranscription())
      }
    } catch (error) {
      if (transcriptionCanceledRef.current) {
        transcriptionCanceledRef.current = false
        clearRetryAudio()
        setErrorMessage(undefined)
        setPhase('idle')
        setElapsedSeconds(0)
        setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
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
  }, [clearRetryAudio, editorRef, insertTranscript, onSendAfterTranscription, setVoiceError, t])

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

  const startRecording = useCallback(async () => {
    if (!enabled || phase !== 'idle') return
    setErrorMessage(undefined)
    clearRetryAudio()

    if (!hasRecordingSupport()) {
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
      setVoiceError(getApiErrorMessage(error, t('chat.voiceInput.loadServicesFailed')))
      return
    }
    const availableServices = response?.services.filter(service => service.enabled) ?? []
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = getMediaRecorderMimeType()
      const recorder = new MediaRecorder(stream, mimeType == null ? undefined : { mimeType })
      chunksRef.current = []
      recordingStreamRef.current = stream
      recorderRef.current = recorder
      recordingStartedAtRef.current = Date.now()
      setElapsedSeconds(0)
      setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
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
      const fallback = error instanceof DOMException && error.name === 'NotAllowedError'
        ? t('chat.voiceInput.permissionDenied')
        : t('chat.voiceInput.recordingFailed')
      setVoiceError(fallback)
    }
  }, [
    canStartRecording,
    clearRetryAudio,
    cleanupRecordingResources,
    editorRef,
    enabled,
    finishRecording,
    mutateServices,
    notifyWarning,
    phase,
    servicesData,
    setVoiceError,
    startWaveform,
    t
  ])

  const cancelRecording = useCallback(() => {
    if (phase !== 'recording') return
    sendAfterStopRef.current = false
    chunksRef.current = []
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
    setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
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
  }, [canSendAfterTranscription, finishRecording, phase])

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
    transcriptionCanceledRef.current = true
    transcriptionAbortControllerRef.current?.abort()
    setPhase('idle')
    setElapsedSeconds(0)
    setWaveformLevels(DEFAULT_WAVEFORM_LEVELS)
    editorRef.current?.focus()
  }, [editorRef, phase])

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
        await mutateServices()
        notifySuccess(t('chat.voiceInput.defaultSaved'))
      } catch (error) {
        setVoiceError(getApiErrorMessage(error, t('chat.voiceInput.defaultSaveFailed')))
      } finally {
        setSettingDefaultServiceId(undefined)
      }
    })()
  }, [mutateServices, notifySuccess, setVoiceError, t])

  const openConfig = useCallback(() => {
    void navigate('/config?section=voice.speechToText')
  }, [navigate])

  const controller = useMemo<SenderVoiceInputController>(() => ({
    handlers: {
      cancelRecording,
      cancelTranscription,
      dismissSetup: () => setSetupOpen(false),
      openConfig,
      retryTranscription,
      selectService: (serviceId?: string) => {
        setSelectedServiceId(serviceId)
        setErrorMessage(undefined)
      },
      setDefaultService,
      startRecording,
      stopRecording
    },
    state: {
      canRetry: retryBlobRef.current != null,
      canStartRecording,
      canSendAfterTranscription,
      elapsedSeconds,
      enabled,
      errorMessage,
      loadingServices,
      phase,
      selectedServiceId,
      selectedServiceLabel: selectedService?.label,
      settingDefaultServiceId,
      services,
      setupOpen,
      unsupported: !hasRecordingSupport(),
      waveformLevels
    }
  }), [
    cancelRecording,
    cancelTranscription,
    canSendAfterTranscription,
    canStartRecording,
    elapsedSeconds,
    enabled,
    errorMessage,
    loadingServices,
    openConfig,
    phase,
    retryTranscription,
    selectedService?.label,
    selectedServiceId,
    setDefaultService,
    settingDefaultServiceId,
    services,
    setupOpen,
    startRecording,
    stopRecording,
    waveformLevels
  ])

  return enabled ? controller : undefined
}
