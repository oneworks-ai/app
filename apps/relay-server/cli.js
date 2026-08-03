#!/usr/bin/env node

require('@oneworks/cli-helper/entry').runCliPackageEntrypoint({
  packageDir: __dirname,
  sourceEntry: './dist/cli.js',
  distEntry: './dist/cli.js'
})
