/* eslint-disable max-lines -- code block rendering keeps highlighting, copy actions, and preview affordances together. */
import './CodeBlock.scss'

import { useAtomValue } from 'jotai'
import React, { useEffect, useState } from 'react'

import { themeAtom } from '#~/store/index.js'

let deviconStylesPromise: Promise<unknown> | null = null
const highlightedCodeCache = new Map<string, string>()
const highlightedCodePromiseCache = new Map<string, Promise<string>>()
const HIGHLIGHTED_CODE_CACHE_LIMIT = 200

const loadDeviconStyles = () => {
  deviconStylesPromise ??= import('devicon/devicon.min.css')
  return deviconStylesPromise
}

const resolveCodeBlockIsDark = (themeMode: string) => {
  if (themeMode === 'dark') return true
  if (themeMode !== 'system') return false

  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
}

const getHighlightedCodeCacheKey = ({
  code,
  isDark,
  lang,
  showLineNumbers
}: {
  code: string
  isDark: boolean
  lang: string
  showLineNumbers: boolean
}) =>
  JSON.stringify({
    code,
    lang,
    showLineNumbers,
    theme: isDark ? 'github-dark' : 'github-light'
  })

const rememberHighlightedCode = (key: string, html: string) => {
  if (highlightedCodeCache.has(key)) {
    highlightedCodeCache.delete(key)
  }
  highlightedCodeCache.set(key, html)

  while (highlightedCodeCache.size > HIGHLIGHTED_CODE_CACHE_LIMIT) {
    const oldestKey = highlightedCodeCache.keys().next().value
    if (oldestKey == null) break
    highlightedCodeCache.delete(oldestKey)
  }
}

const getHighlightedCode = async ({
  code,
  isDark,
  key,
  lang,
  showLineNumbers
}: {
  code: string
  isDark: boolean
  key: string
  lang: string
  showLineNumbers: boolean
}) => {
  const cachedHtml = highlightedCodeCache.get(key)
  if (cachedHtml != null) return cachedHtml

  const pendingHtml = highlightedCodePromiseCache.get(key)
  if (pendingHtml != null) return pendingHtml

  const promise = (async () => {
    const { codeToHtml } = await import('shiki')
    const html = await codeToHtml(code, {
      lang,
      theme: isDark ? 'github-dark' : 'github-light',
      transformers: showLineNumbers
        ? [
          {
            name: 'line-numbers',
            line(node, line) {
              node.children.unshift({
                type: 'element',
                tagName: 'span',
                properties: {
                  class: 'line-number',
                  style:
                    'display: inline-block; width: 2rem; margin-right: 1rem; text-align: right; color: #9ca3af; user-select: none;'
                },
                children: [{ type: 'text', value: String(line) }]
              })
            }
          }
        ]
        : []
    })

    rememberHighlightedCode(key, html)
    return html
  })()

  highlightedCodePromiseCache.set(key, promise)

  try {
    return await promise
  } finally {
    highlightedCodePromiseCache.delete(key)
  }
}

export function CodeBlock({
  code,
  lang = 'json',
  showLineNumbers = false,
  hideHeader = false
}: {
  code: string
  lang?: string
  showLineNumbers?: boolean
  hideHeader?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const themeMode = useAtomValue(themeAtom)
  const isDark = resolveCodeBlockIsDark(themeMode)
  const highlightCacheKey = getHighlightedCodeCacheKey({
    code,
    isDark,
    lang,
    showLineNumbers
  })
  const [html, setHtml] = useState<string>(() => highlightedCodeCache.get(highlightCacheKey) ?? '')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  const getLangIcon = (language: string) => {
    const lang = language.toLowerCase()
    const iconMap: Record<string, string> = {
      js: 'javascript-plain',
      javascript: 'javascript-plain',
      ts: 'typescript-plain',
      typescript: 'typescript-plain',
      html: 'html5-plain',
      css: 'css3-plain',
      python: 'python-plain',
      py: 'python-plain',
      java: 'java-plain',
      cpp: 'cplusplus-plain',
      c: 'c-plain',
      csharp: 'csharp-plain',
      cs: 'csharp-plain',
      go: 'go-original-wordmark',
      rust: 'rust-original',
      rs: 'rust-original',
      php: 'php-plain',
      ruby: 'ruby-plain',
      rb: 'ruby-plain',
      swift: 'swift-plain',
      kotlin: 'kotlin-plain',
      kt: 'kotlin-plain',
      scala: 'scala-plain',
      shell: 'bash-plain',
      sh: 'bash-plain',
      bash: 'bash-plain',
      sql: 'sqlline-plain',
      json: 'json-plain',
      yaml: 'yaml-plain',
      yml: 'yaml-plain',
      markdown: 'markdown-original',
      md: 'markdown-original',
      docker: 'docker-plain',
      dockerfile: 'docker-plain',
      react: 'react-original',
      jsx: 'react-original',
      tsx: 'react-original',
      vue: 'vuejs-plain',
      angular: 'angularjs-plain',
      sass: 'sass-original',
      scss: 'sass-original',
      less: 'less-plain-wordmark',
      stylus: 'stylus-plain',
      mongodb: 'mongodb-plain',
      mysql: 'mysql-plain',
      postgresql: 'postgresql-plain',
      redis: 'redis-plain',
      git: 'git-plain',
      npm: 'npm-original-wordmark',
      yarn: 'yarn-plain',
      nginx: 'nginx-original',
      bash_profile: 'bash-plain'
    }

    const iconClass = iconMap[lang] || 'code-plain'
    return <i className={`devicon-${iconClass} colored`} style={{ fontSize: '14px' }} />
  }

  useEffect(() => {
    void loadDeviconStyles()
  }, [])

  useEffect(() => {
    let isMounted = true

    const highlight = async () => {
      const cachedHtml = highlightedCodeCache.get(highlightCacheKey)
      if (cachedHtml != null) {
        if (isMounted) setHtml(cachedHtml)
        return
      }

      if (isMounted) setHtml('')

      const nextHtml = await getHighlightedCode({
        code,
        isDark,
        key: highlightCacheKey,
        lang,
        showLineNumbers
      })

      if (isMounted) setHtml(nextHtml)
    }

    highlight().catch((err) => {
      console.error('Failed to highlight code block:', err)
    })

    return () => {
      isMounted = false
    }
  }, [code, highlightCacheKey, isDark, lang, showLineNumbers])

  if (html === '') {
    return (
      <div className='code-block-wrapper'>
        {!hideHeader && (
          <div className='code-block-header'>
            <div className='code-lang-container'>
              {getLangIcon(lang)}
              <span className='code-lang'>{lang}</span>
            </div>
            <button
              className='copy-button'
              onClick={() => {
                void handleCopy()
              }}
            >
              <span className='material-symbols-rounded'>
                {copied ? 'check' : 'content_copy'}
              </span>
            </button>
          </div>
        )}
        <pre style={{ margin: 0, padding: 12, fontSize: 12, color: '#4b5563', overflowX: 'auto' }}>
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  return (
    <div className='code-block-wrapper'>
      {!hideHeader && (<div className='code-block-header'>
        <div className='code-lang-container'>
          {getLangIcon(lang)}
          <span className='code-lang'>{lang}</span>
        </div>
        <button
          className='copy-button'
          onClick={() => {
            void handleCopy()
          }}
        >
          <span className='material-symbols-rounded'>
            {copied ? 'check' : 'content_copy'}
          </span>
        </button>
      </div>)}
      <div
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
