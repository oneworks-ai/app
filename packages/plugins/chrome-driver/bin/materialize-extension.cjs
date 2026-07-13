#!/usr/bin/env node
const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { basename, join, resolve } = require('node:path')
const process = require('node:process')
const { createOneWorksCursorSvg } = require('@oneworks/cursor')

const { materializedManifest, packageManifest, pluginRoot } = require('./extension-release.cjs')

const flavor = process.argv.includes('--e2e') ? 'e2e' : process.argv.includes('--minimal') ? 'base' : 'privileged'
const outputIndex = process.argv.indexOf('--output')
const output = resolve(outputIndex >= 0 ? process.argv[outputIndex + 1] : join(pluginRoot, 'dist-extension', flavor))
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })
for (
  const name of [
    'background.js',
    'content-script.js',
    'cursor-runtime.js',
    'operations',
    'popup.css',
    'popup.html',
    'popup.js'
  ]
) {
  cpSync(join(pluginRoot, 'extension', name), join(output, basename(name)), { recursive: true })
}
const manifestName = flavor === 'e2e'
  ? 'manifest.e2e.json'
  : flavor === 'privileged'
  ? 'manifest.privileged.json'
  : 'manifest.json'
const manifestTemplate = JSON.parse(readFileSync(join(pluginRoot, 'extension', manifestName), 'utf8'))
const manifest = materializedManifest(manifestTemplate, packageManifest.version)
writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(output, 'agent-cursor.svg'), createOneWorksCursorSvg({ color: '#625BF6', size: 64 }))
cpSync(join(pluginRoot, 'extension', 'default-tab-favicon.svg'), join(output, 'default-tab-favicon.svg'))
cpSync(join(pluginRoot, 'extension', 'icons'), join(output, 'icons'), { recursive: true })
process.stdout.write(`${
  JSON.stringify({
    flavor,
    manifest_version: manifest.version,
    output,
    package_version: packageManifest.version
  })
}\n`)
