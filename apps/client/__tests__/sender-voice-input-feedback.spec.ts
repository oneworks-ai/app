import * as React from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cancelAnnotationVoiceInput } from '#~/components/chat/interaction-panel/annotation-voice-input'
import { useSenderVoiceInput } from '#~/components/chat/sender/@hooks/use-sender-voice-input'
import type { SenderVoiceInputController } from '#~/components/chat/sender/@types/sender-voice-input'
import { getRecordingStartErrorMessageKey } from '#~/components/chat/sender/@utils/recording-support'

const mocks = vi.hoisted(() => ({
  mutateConfig: vi.fn(),
  mutateServices: vi.fn(),
  notifyError: vi.fn(),
  notifyWarning: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn()
}))

vi.mock('swr', () => ({
  default: (key: string) => {
    if (key === '/api/voice/speech-to-text/services') {
      return {
        data: servicesResponse,
        isLoading: false,
        mutate: mocks.mutateServices
      }
    }
    return {
      data: undefined,
      isLoading: false,
      mutate: mocks.mutateConfig
    }
  }
}))

vi.mock('#~/api', () => ({
  getApiErrorMessage: (_error: unknown, fallback: string) => fallback,
  getConfig: vi.fn(),
  listSpeechToTextServices: vi.fn(),
  transcribeSpeechToText: vi.fn(),
  updateConfig: vi.fn()
}))

const servicesResponse = {
  services: [{
    capabilities: {
      streaming: false
    },
    default: true,
    enabled: true,
    id: 'test-service',
    label: 'Test service',
    provider: 'custom-http'
  }]
}

interface FakeEventTarget {
  addEventListener: () => void
  removeEventListener: () => void
}

interface FakeDocument extends FakeEventTarget {
  activeElement: FakeElement
  body: FakeElement
  defaultView: FakeWindow
  documentElement: FakeElement & { lang: string }
  nodeType: 9
}

interface FakeElement extends FakeEventTarget {
  firstChild: null
  lastChild: null
  namespaceURI: string
  nodeName: string
  nodeType: 1
  ownerDocument: FakeDocument
  tagName: string
  textContent: string
}

interface FakeWindow extends FakeEventTarget {
  AudioContext?: typeof AudioContext
  HTMLIFrameElement: typeof FakeHtmlIFrameElement
  cancelAnimationFrame: typeof globalThis.clearTimeout
  clearInterval: typeof globalThis.clearInterval
  clearTimeout: typeof globalThis.clearTimeout
  document: FakeDocument
  event?: Event
  requestAnimationFrame: (callback: FrameRequestCallback) => ReturnType<typeof globalThis.setTimeout>
  setInterval: typeof globalThis.setInterval
  setTimeout: typeof globalThis.setTimeout
}

class FakeHtmlIFrameElement {}

const createFakeEventTarget = (): FakeEventTarget => ({
  addEventListener: () => undefined,
  removeEventListener: () => undefined
})

const createFakeDom = () => {
  const eventTarget = createFakeEventTarget()
  const document = {
    ...eventTarget,
    nodeType: 9
  } as FakeDocument
  const createElement = (tagName: string): FakeElement => ({
    ...createFakeEventTarget(),
    firstChild: null,
    lastChild: null,
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument: document,
    tagName: tagName.toUpperCase(),
    textContent: ''
  })
  const window = {
    ...createFakeEventTarget(),
    HTMLIFrameElement: FakeHtmlIFrameElement,
    cancelAnimationFrame: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    document,
    requestAnimationFrame: callback => globalThis.setTimeout(() => callback(Date.now()), 0),
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout
  } satisfies FakeWindow
  const body = createElement('body')
  document.activeElement = body
  document.body = body
  document.defaultView = window
  document.documentElement = {
    ...createElement('html'),
    lang: 'en-US'
  }
  return {
    container: createElement('div'),
    document,
    window
  }
}

interface MountedVoiceInput {
  controller: SenderVoiceInputController
  setAnnotationTargetPresent: (present: boolean) => Promise<void>
  unmount: () => Promise<void>
}

const mountedRoots: Array<{ root: Root; unmounted: boolean }> = []

const mountVoiceInput = async ({ annotationConsumer = false } = {}): Promise<MountedVoiceInput> => {
  const fakeDom = createFakeDom()
  vi.stubGlobal('document', fakeDom.document)
  vi.stubGlobal('window', fakeDom.window)
  const { createRoot } = await import('react-dom/client')
  const mountedRoot = {
    root: createRoot(fakeDom.container as unknown as Element),
    unmounted: false
  }
  mountedRoots.push(mountedRoot)
  let controller: SenderVoiceInputController | undefined
  let annotationTargetPresent = true

  function Harness() {
    controller = useSenderVoiceInput({
      canSendAfterTranscription: true,
      canStartRecording: true,
      editorRef: { current: null },
      enabled: true,
      input: '',
      notifyError: mocks.notifyError,
      notifySuccess: vi.fn(),
      notifyWarning: mocks.notifyWarning,
      onSendAfterTranscription: vi.fn(),
      setInput: vi.fn()
    })
    React.useEffect(() => {
      if (!annotationConsumer || annotationTargetPresent) return
      cancelAnnotationVoiceInput(controller)
    }, [annotationConsumer, annotationTargetPresent, controller])
    return null
  }

  const renderHarness = async () =>
    React.act(async () => {
      mountedRoot.root.render(React.createElement(Harness))
    })
  await renderHarness()

  if (controller == null) {
    throw new Error('voice input controller was not created')
  }

  return {
    get controller() {
      if (controller == null) {
        throw new Error('voice input controller was not created')
      }
      return controller
    },
    setAnnotationTargetPresent: async (present) => {
      annotationTargetPresent = present
      await renderHarness()
    },
    unmount: async () => {
      if (mountedRoot.unmounted) return
      mountedRoot.unmounted = true
      await React.act(async () => mountedRoot.root.unmount())
    }
  }
}

const createDeferred = <T>() => {
  let reject!: (reason: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })
  return { promise, reject, resolve }
}

const createMediaStream = () => {
  const stop = vi.fn()
  return {
    stop,
    stream: {
      getTracks: () => [{ stop }]
    } as unknown as MediaStream
  }
}

class FakeMediaRecorder {
  static isTypeSupported = () => false

  readonly mimeType = 'audio/webm'
  readonly stream: MediaStream
  state: RecordingState = 'inactive'
  ondataavailable: ((this: MediaRecorder, event: BlobEvent) => unknown) | null = null
  onerror: ((this: MediaRecorder, event: Event) => unknown) | null = null
  onstop: ((this: MediaRecorder, event: Event) => unknown) | null = null

  constructor(stream: MediaStream) {
    this.stream = stream
  }

  requestData() {}

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
  }
}

const startRecording = async (harness: MountedVoiceInput) => {
  let request!: Promise<void>
  await React.act(async () => {
    request = harness.controller.handlers.startRecording() as unknown as Promise<void>
    await Promise.resolve()
  })
  return { request }
}

describe('sender voice input startup feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mutateServices.mockResolvedValue(servicesResponse)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  afterEach(async () => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      if (mountedRoot.unmounted) continue
      mountedRoot.unmounted = true
      await React.act(async () => mountedRoot.root.unmount())
    }
    vi.unstubAllGlobals()
  })

  it('invalidates a pending permission request on unmount and stops its late stream', async () => {
    const permission = createDeferred<MediaStream>()
    const getUserMedia = vi.fn(() => permission.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const recorderConstructor = vi.fn()
    vi.stubGlobal(
      'MediaRecorder',
      class extends FakeMediaRecorder {
        constructor(stream: MediaStream) {
          super(stream)
          recorderConstructor(stream)
        }
      }
    )
    const harness = await mountVoiceInput()
    const { request } = await startRecording(harness)

    expect(harness.controller.state.phase).toBe('requesting')
    await harness.unmount()

    const lateStream = createMediaStream()
    permission.resolve(lateStream.stream)
    await React.act(async () => request)

    expect(lateStream.stop).toHaveBeenCalledOnce()
    expect(recorderConstructor).not.toHaveBeenCalled()
  })

  it('cancels a pending annotation voice request when its target is lost', async () => {
    const permission = createDeferred<MediaStream>()
    const getUserMedia = vi.fn(() => permission.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const recorderConstructor = vi.fn()
    vi.stubGlobal(
      'MediaRecorder',
      class extends FakeMediaRecorder {
        constructor(stream: MediaStream) {
          super(stream)
          recorderConstructor(stream)
        }
      }
    )
    const harness = await mountVoiceInput({ annotationConsumer: true })
    const { request } = await startRecording(harness)

    expect(harness.controller.state.phase).toBe('requesting')
    await harness.setAnnotationTargetPresent(false)
    expect(harness.controller.state.phase).toBe('idle')

    const lateStream = createMediaStream()
    permission.resolve(lateStream.stream)
    await React.act(async () => request)

    expect(lateStream.stop).toHaveBeenCalledOnce()
    expect(recorderConstructor).not.toHaveBeenCalled()
  })

  it('lets a newer start supersede an in-flight request without orphaning either stream', async () => {
    const firstPermission = createDeferred<MediaStream>()
    const secondPermission = createDeferred<MediaStream>()
    const getUserMedia = vi.fn()
      .mockReturnValueOnce(firstPermission.promise)
      .mockReturnValueOnce(secondPermission.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const recorderConstructor = vi.fn()
    const recorderStart = vi.fn()
    vi.stubGlobal(
      'MediaRecorder',
      class extends FakeMediaRecorder {
        constructor(stream: MediaStream) {
          super(stream)
          recorderConstructor(stream)
        }

        override start() {
          super.start()
          recorderStart()
        }
      }
    )
    const harness = await mountVoiceInput()
    const start = harness.controller.handlers.startRecording
    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>
    await React.act(async () => {
      firstRequest = start() as unknown as Promise<void>
      secondRequest = start() as unknown as Promise<void>
      await Promise.resolve()
    })

    const newerStream = createMediaStream()
    secondPermission.resolve(newerStream.stream)
    await React.act(async () => secondRequest)

    expect(recorderConstructor).toHaveBeenCalledOnce()
    expect(recorderConstructor).toHaveBeenCalledWith(newerStream.stream)
    expect(recorderStart).toHaveBeenCalledOnce()
    expect(newerStream.stop).not.toHaveBeenCalled()
    expect(harness.controller.state.phase).toBe('recording')

    const staleStream = createMediaStream()
    firstPermission.resolve(staleStream.stream)
    await React.act(async () => firstRequest)

    expect(staleStream.stop).toHaveBeenCalledOnce()
    expect(recorderConstructor).toHaveBeenCalledOnce()
    expect(newerStream.stop).not.toHaveBeenCalled()

    await harness.unmount()
    expect(newerStream.stop).toHaveBeenCalledOnce()
  })

  it('stops an owned stream when the MediaRecorder constructor fails', async () => {
    const acquiredStream = createMediaStream()
    const getUserMedia = vi.fn().mockResolvedValue(acquiredStream.stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal(
      'MediaRecorder',
      class {
        static isTypeSupported = () => false

        constructor(_stream: MediaStream) {
          throw new Error('constructor failed')
        }
      }
    )
    const harness = await mountVoiceInput()
    const { request } = await startRecording(harness)

    await React.act(async () => request)

    expect(acquiredStream.stop).toHaveBeenCalledOnce()
    expect(harness.controller.state.phase).toBe('idle')
    expect(harness.controller.state.errorMessage).toBe('chat.voiceInput.recordingFailed')
    expect(mocks.notifyError).toHaveBeenCalledWith('chat.voiceInput.recordingFailed')
  })

  it('shows a requesting state while Web microphone permission is pending, then explains a denial', async () => {
    const permission = createDeferred<MediaStream>()
    const getUserMedia = vi.fn(() => permission.promise)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const harness = await mountVoiceInput()
    const { request } = await startRecording(harness)

    expect(harness.controller.state.phase).toBe('requesting')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })

    permission.reject(new DOMException('Denied', 'NotAllowedError'))
    await React.act(async () => request)

    expect(harness.controller.state.phase).toBe('idle')
    expect(harness.controller.state.errorMessage).toBe('chat.voiceInput.permissionDenied')
    expect(harness.controller.state.errorCanOpenConfig).toBe(false)
    expect(mocks.notifyError).toHaveBeenCalledWith('chat.voiceInput.permissionDenied')
  })

  it('reports unsupported Web audio capture instead of silently ignoring the action', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('MediaRecorder', undefined)
    const harness = await mountVoiceInput()

    expect(harness.controller.state.unsupported).toBe(true)
    await React.act(async () => {
      await (harness.controller.handlers.startRecording() as unknown as Promise<void>)
    })

    expect(harness.controller.state.phase).toBe('idle')
    expect(harness.controller.state.errorMessage).toBe('chat.voiceInput.unsupported')
    expect(harness.controller.state.errorCanOpenConfig).toBe(false)
    expect(mocks.notifyError).toHaveBeenCalledWith('chat.voiceInput.unsupported')
  })

  it('distinguishes a missing microphone from other startup failures', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('Missing', 'NotFoundError'))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const harness = await mountVoiceInput()
    const { request } = await startRecording(harness)

    await React.act(async () => request)

    expect(harness.controller.state.errorMessage).toBe('chat.voiceInput.noMicrophone')
    expect(mocks.notifyError).toHaveBeenCalledWith('chat.voiceInput.noMicrophone')
    expect(getRecordingStartErrorMessageKey(
      new DOMException('Busy', 'NotReadableError')
    )).toBe('chat.voiceInput.microphoneUnavailable')
  })
})
