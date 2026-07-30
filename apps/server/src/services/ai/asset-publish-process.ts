import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { lstat } from 'node:fs/promises'
import process from 'node:process'

import { badRequest, internalServerError, isHttpError } from '#~/utils/http.js'
import type { PublishOperations, PublishOutcome } from './asset-create-filesystem.js'
import type { PublishProcessControl, PublishStage } from './asset-publish-protocol.js'
import { parseWorkerResult } from './asset-publish-protocol.js'
import { AssetPublishSettlement } from './asset-publish-settlement.js'

const spawnFailure = (error: unknown) =>
  internalServerError('Asset publisher process failed before visibility', {
    cause: error,
    code: 'asset_publish_failed',
    details: { committed: false }
  })

export const runAssetPublishProcess = async (params: {
  args: string[]
  content: string
  control?: PublishProcessControl
  directory: string
  expectedParent: { dev: string; ino: string }
  operations: PublishOperations
  workspaceRoot: string
}): Promise<PublishOutcome> =>
  new Promise<PublishOutcome>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(process.execPath, params.args, {
        cwd: params.workspaceRoot,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      })
    } catch (error) {
      reject(spawnFailure(error))
      return
    }

    const settlement = new AssetPublishSettlement({
      child,
      control: params.control,
      reject,
      resolve
    })
    const send = params.control?.send ??
      ((target: ChildProcess, message: object, callback: (error: Error | null) => void) => {
        target.send(message, callback)
      })
    let stdout = ''
    const runControl = (token: number, callback: () => unknown, next: () => void) => {
      settlement.armControl(token)
      Promise.resolve()
        .then(callback)
        .then(
          () => {
            if (!settlement.isCurrent(token)) return
            try {
              next()
            } catch {
              settlement.terminate()
            }
          },
          (error) => {
            if (!settlement.isCurrent(token)) return
            if (isHttpError(error) && !settlement.protocol.visibilityPossible) {
              settlement.failPreCommit(error)
            } else settlement.terminate()
          }
        )
    }
    const sendContinue = (stage: PublishStage, controlId: number, token: number) => {
      if (!settlement.isCurrent(token)) return
      if (!child.connected) return settlement.terminate()
      if (stage === 'publishing' && !settlement.protocol.authorizeVisibility(token)) return
      try {
        send(child, { type: 'asset-publish-continue', stage, controlId }, error => {
          if (!settlement.isCurrent(token)) return
          if (error != null) settlement.terminate()
          else settlement.armControl(token)
        })
      } catch {
        if (settlement.isCurrent(token)) settlement.terminate()
      }
    }
    const handleStage = (message: unknown) => {
      if (!settlement.running) return
      try {
        const control = settlement.protocol.beginStage(message)
        if (control == null) return settlement.terminate()
        if (control.stage === 'staged') settlement.markStagingRetained()
        const callback = control.stage === 'staged'
          ? () =>
            params.operations.afterTempSync?.({
              stagingName: typeof (message as { stagingName?: unknown }).stagingName === 'string'
                ? (message as { stagingName: string }).stagingName
                : undefined
            })
          : control.stage === 'target-absent'
          ? params.operations.afterTargetAbsent
          : control.stage === 'visible'
          ? params.operations.afterVisible
          : control.stage === 'target-probed'
          ? params.operations.afterTargetProbe
          : undefined
        runControl(
          control.token,
          () => callback?.(),
          () => sendContinue(control.stage, control.controlId, control.token)
        )
      } catch {
        settlement.terminate()
      }
    }
    const handleReady = () => {
      if (!settlement.running) return
      const token = settlement.protocol.beginReady()
      if (token == null) return settlement.terminate()
      runControl(token, async () => {
        await params.operations.afterAuthorityClaim?.()
        const current = await lstat(params.directory, { bigint: true }).catch(() => undefined)
        if (
          current == null ||
          current.isSymbolicLink() ||
          !current.isDirectory() ||
          String(current.dev) !== params.expectedParent.dev ||
          String(current.ino) !== params.expectedParent.ino
        ) {
          throw badRequest(
            'Asset destination changed during publishing',
            { committed: false },
            'asset_destination_changed'
          )
        }
      }, () => {
        child.stdin?.end(params.content)
        settlement.armControl(token)
      })
    }
    const handleResult = (line: string) => {
      let parsed
      try {
        parsed = parseWorkerResult(JSON.parse(line.slice(7)))
      } catch {}
      if (parsed == null) {
        if (settlement.running) settlement.terminate()
      } else {
        settlement.acceptResult(parsed)
      }
    }

    child.stderr?.setEncoding('utf8')
    child.stdout?.setEncoding('utf8')
    child.stderr?.on('data', chunk => settlement.addStderr(chunk))
    child.on('message', handleStage)
    child.stdout?.on('data', chunk => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        if (line === 'READY') handleReady()
        else if (line.startsWith('RESULT ')) handleResult(line)
      }
    })
    child.stdin?.on('error', () => settlement.terminate())
    child.once('disconnect', () => settlement.terminate())
    child.once('error', () => settlement.terminate())
    child.once('close', () => settlement.finishClosed())
  })
