import process from 'node:process'

import { DefinitionLoader } from '@oneworks/definition-loader'
import { openFilesystemAuthorityForTest } from '@oneworks/fs-authority-native/testing'

import { createProjectAsset } from '#~/services/ai/asset-create.js'

const workspaceRoot = process.env.ASSET_TEST_WORKSPACE
const controlRoot = process.env.ASSET_TEST_CONTROL_ROOT
const secret = process.env.ASSET_TEST_SECRET
if (workspaceRoot == null || controlRoot == null || secret == null) {
  throw new Error('Missing asset semantic worker environment')
}

const realLoader = new DefinitionLoader(workspaceRoot)
let resume: (() => void) | undefined
const resumed = new Promise<void>(resolve => {
  resume = resolve
})
process.once('message', message => {
  if (message === 'continue') resume?.()
})

const run = async () => {
  try {
    const asset = await createProjectAsset({
      input: { kind: 'spec', name: 'x' },
      loader: {
        loadDefaultSpecs: async () => {
          process.send?.({ type: 'loader-ready' })
          await resumed
          return realLoader.loadDefaultSpecs()
        }
      } as unknown as DefinitionLoader,
      openAuthority: root =>
        openFilesystemAuthorityForTest(root, {
          autoStart: false,
          controlRoot,
          secret
        }),
      workspaceRoot
    })
    process.send?.({ type: 'result', ok: true, asset })
  } catch (error) {
    process.send?.({
      type: 'result',
      ok: false,
      code: error instanceof Error && 'code' in error ? error.code : undefined,
      details: error instanceof Error && 'details' in error ? error.details : undefined,
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined
    })
  }
}

void run()
