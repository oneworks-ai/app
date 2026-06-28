/* eslint-disable max-lines -- video preview keeps desktop IPC and server websocket stream lifecycles together. */
import { useEffect, useRef } from 'react'

import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer
} from '@yume-chan/scrcpy-decoder-webcodecs'

import { getServerWsPath } from '#~/runtime-config'

export type MobileDeviceVideoPreviewStatus = 'active' | 'starting' | 'unavailable'

export interface MobileDeviceVideoPreviewSize {
  height: number
  width: number
}

const createRenderer = (canvas: HTMLCanvasElement) => {
  try {
    if (WebGLVideoFrameRenderer.isSupported) return new WebGLVideoFrameRenderer(canvas)
  } catch {
    // Fall back to bitmaprenderer below.
  }
  return new BitmapVideoFrameRenderer(canvas)
}

const toMediaStreamPacket = (event: DesktopMobileDeviceVideoFrameEvent): ScrcpyMediaStreamPacket => {
  const data = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data)
  if (event.type === 'configuration') return { data, type: 'configuration' }
  return {
    data,
    keyframe: event.keyframe,
    type: 'data'
  }
}

const decodeServerVideoFramePacket = (value: ArrayBuffer): DesktopMobileDeviceVideoFrameEvent | undefined => {
  const headerSize = 10
  if (value.byteLength < headerSize) return undefined
  const view = new DataView(value)
  if (view.getUint8(0) !== 1) return undefined
  const packetKind = view.getUint8(1)
  const width = view.getUint32(2)
  const height = view.getUint32(6)
  const data = new Uint8Array(value.slice(headerSize))
  return {
    data,
    deviceId: '',
    height: height > 0 ? height : undefined,
    keyframe: packetKind === 2,
    receivedAt: Date.now(),
    streamId: 'server',
    type: packetKind === 0 ? 'configuration' : 'data',
    width: width > 0 ? width : undefined
  }
}

const createDecoder = (canvas: HTMLCanvasElement) => {
  const decoder = new WebCodecsVideoDecoder({
    codec: ScrcpyVideoCodecId.H264,
    renderer: createRenderer(canvas)
  })
  return {
    decoder,
    writer: decoder.writable.getWriter()
  }
}

const createMobileDebugVideoSocketUrl = (deviceId: string) => {
  const url = new URL(getServerWsPath(), window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('channel', 'mobile-debug-video')
  url.searchParams.set('deviceId', deviceId)
  return url.toString()
}

const videoStreamStartupTimeoutMs = 10000

export function InteractionPanelMobileDeviceVideoCanvas({
  deviceId,
  onError,
  onSizeChange,
  onStatusChange
}: {
  deviceId: string
  onError: (message: string) => void
  onSizeChange: (size: MobileDeviceVideoPreviewSize) => void
  onStatusChange: (status: MobileDeviceVideoPreviewStatus) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const desktopApi = window.oneworksDesktop
    if (canvas == null || !WebCodecsVideoDecoder.isSupported) {
      onStatusChange('unavailable')
      return
    }
    const startMobileDeviceVideoStream = desktopApi?.startMobileDeviceVideoStream
    const stopMobileDeviceVideoStream = desktopApi?.stopMobileDeviceVideoStream
    const onMobileDeviceVideoFrame = desktopApi?.onMobileDeviceVideoFrame
    const onMobileDeviceVideoStreamStatus = desktopApi?.onMobileDeviceVideoStreamStatus

    let isDisposed = false
    let streamId: string | undefined
    let decoder: WebCodecsVideoDecoder | undefined
    let writer: ReturnType<WebCodecsVideoDecoder['writable']['getWriter']> | undefined
    let serverSocket: WebSocket | undefined
    let startupTimer: number | undefined

    const clearStartupTimer = () => {
      if (startupTimer == null) return
      window.clearTimeout(startupTimer)
      startupTimer = undefined
    }

    const fail = (message: string) => {
      if (isDisposed) return
      clearStartupTimer()
      onError(message)
      onStatusChange('unavailable')
    }

    try {
      const nextDecoder = createDecoder(canvas)
      decoder = nextDecoder.decoder
      writer = nextDecoder.writer
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return
    }

    const removeSizeListener = decoder.sizeChanged(size => {
      onSizeChange(size)
      onStatusChange('active')
    })

    if (
      startMobileDeviceVideoStream == null ||
      stopMobileDeviceVideoStream == null ||
      onMobileDeviceVideoFrame == null ||
      onMobileDeviceVideoStreamStatus == null
    ) {
      onStatusChange('starting')
      const ws = new WebSocket(createMobileDebugVideoSocketUrl(deviceId))
      serverSocket = ws
      ws.binaryType = 'arraybuffer'
      startupTimer = window.setTimeout(() => {
        fail('Mobile debug video stream timed out.')
      }, videoStreamStartupTimeoutMs)
      ws.addEventListener('message', event => {
        if (isDisposed || writer == null) return
        if (typeof event.data === 'string') {
          try {
            const message = JSON.parse(event.data) as {
              data?: DesktopMobileDeviceVideoStreamStartResponse | DesktopMobileDeviceVideoStreamStatusEvent
              type?: string
            }
            if (message.type === 'mobile-debug-video-started') {
              const result = message.data as DesktopMobileDeviceVideoStreamStartResponse | undefined
              streamId = result?.streamId
              if (result?.width != null && result.height != null) {
                onSizeChange({ height: result.height, width: result.width })
              }
            } else if (message.type === 'mobile-debug-video-status') {
              const status = message.data as DesktopMobileDeviceVideoStreamStatusEvent | undefined
              if (status?.status === 'error') fail(status.message ?? '')
              else fail('')
            }
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error))
          }
          return
        }

        const writeFrame = (buffer: ArrayBuffer) => {
          const frame = decodeServerVideoFramePacket(buffer)
          if (frame == null || writer == null) return
          if (frame.width != null && frame.height != null) {
            onSizeChange({ height: frame.height, width: frame.width })
          }
          writer.write(toMediaStreamPacket(frame))
            .then(() => {
              if (!isDisposed) {
                clearStartupTimer()
                onStatusChange('active')
              }
            })
            .catch(error => fail(error instanceof Error ? error.message : String(error)))
        }

        if (event.data instanceof ArrayBuffer) {
          writeFrame(event.data)
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(writeFrame).catch(error => {
            fail(error instanceof Error ? error.message : String(error))
          })
        }
      })
      ws.addEventListener('error', () => fail(''))
      ws.addEventListener('close', event => {
        if (!isDisposed && event.code !== 1000) fail(event.reason)
      })

      return () => {
        isDisposed = true
        clearStartupTimer()
        removeSizeListener()
        serverSocket?.close()
        void writer?.close().catch(() => undefined)
        decoder?.dispose()
      }
    }

    const unsubscribeFrame = onMobileDeviceVideoFrame(event => {
      if (isDisposed || event.streamId !== streamId || writer == null) return
      if (event.width != null && event.height != null) {
        onSizeChange({ height: event.height, width: event.width })
      }
      writer.write(toMediaStreamPacket(event))
        .then(() => {
          if (!isDisposed) onStatusChange('active')
        })
        .catch(error => fail(error instanceof Error ? error.message : String(error)))
    })

    const unsubscribeStatus = onMobileDeviceVideoStreamStatus(event => {
      if (event.streamId !== streamId || isDisposed) return
      if (event.status === 'error') {
        fail(event.message ?? '')
      } else {
        fail('')
      }
    })

    onStatusChange('starting')
    startMobileDeviceVideoStream(deviceId)
      .then(result => {
        if (isDisposed) {
          void stopMobileDeviceVideoStream(result.streamId).catch(() => undefined)
          return
        }
        streamId = result.streamId
        if (result.width != null && result.height != null) {
          onSizeChange({ height: result.height, width: result.width })
        }
      })
      .catch(error => fail(error instanceof Error ? error.message : String(error)))

    return () => {
      isDisposed = true
      unsubscribeFrame()
      unsubscribeStatus()
      removeSizeListener()
      const currentStreamId = streamId
      if (currentStreamId != null) {
        void stopMobileDeviceVideoStream(currentStreamId).catch(() => undefined)
      }
      void writer?.close().catch(() => undefined)
      decoder?.dispose()
    }
  }, [deviceId, onError, onSizeChange, onStatusChange])

  return (
    <canvas
      ref={canvasRef}
      className='chat-interaction-panel-mobile-debug__video-canvas'
      aria-hidden='true'
    />
  )
}
