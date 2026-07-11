const { readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

function normalizeStateText(value) {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\s]/g, '')
    .replace(/[×✕✖]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
}

function verifyExpectedStateText(turnDirectories, requestedScreenshot, expectedStateText) {
  if (expectedStateText == null) return []
  if (!Array.isArray(expectedStateText) || expectedStateText.some(item => typeof item !== 'string')) {
    throw new Error('expected_state_text must be an array of strings.')
  }
  const expectations = expectedStateText.map(normalizeStateText).filter(Boolean)
  if (expectations.length === 0) return []

  const requestedPath = resolve(requestedScreenshot)
  const matchingTurn = turnDirectories.find(
    turnDirectory => resolve(join(turnDirectory, 'screenshot.png')) === requestedPath
  )
  const stateTurn = matchingTurn ?? turnDirectories.at(-1)
  const statePath = join(stateTurn, 'app_state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const semanticState = normalizeStateText(state.tree_markdown ?? JSON.stringify(state))
  const missing = expectations.filter(expected => !semanticState.includes(expected))
  if (missing.length > 0) {
    throw new Error(`Final app state does not contain expected text: ${missing.join(', ')}`)
  }
  return expectations
}

module.exports = { normalizeStateText, verifyExpectedStateText }
