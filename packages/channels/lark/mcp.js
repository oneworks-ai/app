#!/usr/bin/env node

require('@oneworks/cli-helper/entry').runCliPackageEntrypoint({
  packageDir: __dirname,
  sourceEntry: './src/mcp/cli',
  distEntry: './dist/mcp/cli.js'
})
