import { useEffect, useRef } from 'react'

import { ScrcpyVideoCodecId } from '@yume-chan/scrcpy'
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy'
import {
  BitmapVideoFrameRenderer,
  WebCodecsVideoDecoder,
  WebGLVideoFrameRenderer
} from '@yume-chan/scrcpy-decoder-webcodecs'

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
    if (
      canvas == null ||
      desktopApi?.startMobileDeviceVideoStream == null ||
      desktopApi.stopMobileDeviceVideoStream == null ||
      desktopApi.onMobileDeviceVideoFrame == null ||
      desktopApi.onMobileDeviceVideoStreamStatus == null ||
      !WebCodecsVideoDecoder.isSupported
    ) {
      onStatusChange('unavailable')
      return
    }

    let isDisposed = false
    let streamId: string | undefined
    let decoder: WebCodecsVideoDecoder | undefined
    let writer: ReturnType<WebCodecsVideoDecoder['writable']['getWriter']> | undefined

    const fail = (message: string) => {
      if (isDisposed) return
      onError(message)
      onStatusChange('unavailable')
    }

    try {
      decoder = new WebCodecsVideoDecoder({
        codec: ScrcpyVideoCodecId.H264,
        renderer: createRenderer(canvas)
      })
      writer = decoder.writable.getWriter()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
      return
    }

    const removeSizeListener = decoder.sizeChanged(size => {
      onSizeChange(size)
      onStatusChange('active')
    })

    const unsubscribeFrame = desktopApi.onMobileDeviceVideoFrame(event => {
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

    const unsubscribeStatus = desktopApi.onMobileDeviceVideoStreamStatus(event => {
      if (event.streamId !== streamId || isDisposed) return
      if (event.status === 'error') {
        fail(event.message ?? '')
      } else {
        fail('')
      }
    })

    onStatusChange('starting')
    desktopApi.startMobileDeviceVideoStream(deviceId)
      .then(result => {
        if (isDisposed) {
          void desktopApi.stopMobileDeviceVideoStream?.(result.streamId).catch(() => undefined)
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
        void desktopApi.stopMobileDeviceVideoStream(currentStreamId).catch(() => undefined)
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
