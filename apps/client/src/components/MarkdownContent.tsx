/* eslint-disable max-lines -- central markdown renderer keeps node overrides and source-position attributes consistent. */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { CodeBlock } from '#~/components/CodeBlock'
import { getMarkdownLinkIconMeta } from '#~/utils/link-icons'
import { isExternalUrl, isLikelyImageUrl } from '#~/utils/link-targets'
import type { WorkspaceFileLinkTarget } from '#~/utils/link-targets'

import { MarkdownLinkContextMenu } from './MarkdownLinkContextMenu'
import { createPlainWorkspaceFileLinkPlugin } from './markdown-content-plugins'

export interface MarkdownImageRenderProps {
  alt?: string
  src: string
  title?: string
}

interface MarkdownContentProps {
  content: string
  enableLinkContextMenu?: boolean
  linkPlainWorkspaceFiles?: boolean
  openLinksInNewTab?: boolean
  renderImage?: (props: MarkdownImageRenderProps) => React.ReactNode
  renderImageLinks?: boolean
  workspaceRootPath?: string
  onLinkClick?: (href: string, event: React.MouseEvent<HTMLAnchorElement>) => void
  onOpenUrlInAppBrowser?: (url: string, title?: string) => void
  onOpenWorkspaceFileLink?: (target: WorkspaceFileLinkTarget) => void
}

interface MarkdownNodePosition {
  end?: {
    column?: number
    line?: number
  }
  start?: {
    column?: number
    line?: number
  }
}

const getSourcePositionProps = (node: unknown) => {
  const position = (node as { position?: MarkdownNodePosition } | undefined)?.position
  const startLine = position?.start?.line
  const endLine = position?.end?.line
  if (startLine == null || endLine == null) return {}

  return {
    'data-source-end-column': position?.end?.column ?? 1,
    'data-source-end-line': endLine,
    'data-source-start-column': position?.start?.column ?? 1,
    'data-source-start-line': startLine
  }
}

const getNodeText = (node: React.ReactNode): string => {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(getNodeText).join('')
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getNodeText(node.props.children)
  }
  return ''
}

export function MarkdownContent({
  content,
  enableLinkContextMenu = false,
  linkPlainWorkspaceFiles = false,
  onLinkClick,
  onOpenUrlInAppBrowser,
  onOpenWorkspaceFileLink,
  openLinksInNewTab = false,
  renderImage,
  renderImageLinks = false,
  workspaceRootPath
}: MarkdownContentProps) {
  const remarkPlugins = React.useMemo(() => {
    const plugins: any[] = [remarkGfm]
    if (linkPlainWorkspaceFiles) {
      plugins.push(createPlainWorkspaceFileLinkPlugin)
    }
    return plugins
  }, [linkPlainWorkspaceFiles])

  return (
    <div className='markdown-body'>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={{
          blockquote({ node, ...props }: any) {
            return <blockquote {...props} {...getSourcePositionProps(node)} />
          },
          a({ href, children, node: _node, ...props }: any) {
            const linkHref = typeof href === 'string' ? href : ''
            const linkText = getNodeText(children).trim()
            if (renderImageLinks && linkHref !== '' && isLikelyImageUrl(linkHref)) {
              const title = linkText !== '' && linkText !== linkHref ? linkText : undefined
              if (renderImage != null) {
                return renderImage({
                  alt: linkText !== '' ? linkText : linkHref,
                  src: linkHref,
                  title
                })
              }
            }

            const shouldOpenInNewTab = openLinksInNewTab && linkHref !== '' && isExternalUrl(linkHref)
            const iconMeta = linkHref !== '' ? getMarkdownLinkIconMeta(linkHref) : null
            const linkClassName = [
              props.className,
              iconMeta != null ? 'markdown-link' : undefined,
              iconMeta != null ? `markdown-link--${iconMeta.kind}` : undefined
            ].filter(Boolean).join(' ')
            const linkElement = (
              <a
                {...props}
                className={linkClassName === '' ? undefined : linkClassName}
                href={href}
                target={shouldOpenInNewTab ? '_blank' : undefined}
                rel={shouldOpenInNewTab ? 'noreferrer' : undefined}
                onClick={(event) => {
                  if (linkHref !== '') onLinkClick?.(linkHref, event)
                }}
              >
                {iconMeta != null && (iconMeta.imageUrl != null
                  ? (
                    <img
                      className={`markdown-link__icon markdown-link__icon--image is-${iconMeta.tone}`}
                      src={iconMeta.imageUrl}
                      alt=''
                      aria-hidden='true'
                      loading='lazy'
                      decoding='async'
                      referrerPolicy='no-referrer'
                    />
                  )
                  : (
                    <span
                      className={`material-symbols-rounded markdown-link__icon is-${iconMeta.tone}`}
                      aria-hidden='true'
                    >
                      {iconMeta.icon}
                    </span>
                  ))}
                {children}
              </a>
            )

            return enableLinkContextMenu && linkHref !== ''
              ? (
                <MarkdownLinkContextMenu
                  href={linkHref}
                  label={linkText}
                  onOpenUrlInAppBrowser={onOpenUrlInAppBrowser}
                  onOpenWorkspaceFile={onOpenWorkspaceFileLink}
                  workspaceRootPath={workspaceRootPath}
                >
                  {linkElement}
                </MarkdownLinkContextMenu>
              )
              : linkElement
          },
          img({ src, alt, title, node: _node, ...props }: any) {
            const imageSrc = typeof src === 'string' ? src : ''
            if (imageSrc !== '' && renderImage != null) {
              return renderImage({
                alt: typeof alt === 'string' ? alt : undefined,
                src: imageSrc,
                title: typeof title === 'string' ? title : undefined
              })
            }

            return (
              <img
                {...props}
                src={src}
                alt={typeof alt === 'string' ? alt : ''}
                title={typeof title === 'string' ? title : undefined}
                loading='lazy'
                decoding='async'
                referrerPolicy='no-referrer'
              />
            )
          },
          pre({ children }) {
            return <>{children}</>
          },
          h1({ node, ...props }: any) {
            return <h1 {...props} {...getSourcePositionProps(node)} />
          },
          h2({ node, ...props }: any) {
            return <h2 {...props} {...getSourcePositionProps(node)} />
          },
          h3({ node, ...props }: any) {
            return <h3 {...props} {...getSourcePositionProps(node)} />
          },
          h4({ node, ...props }: any) {
            return <h4 {...props} {...getSourcePositionProps(node)} />
          },
          h5({ node, ...props }: any) {
            return <h5 {...props} {...getSourcePositionProps(node)} />
          },
          h6({ node, ...props }: any) {
            return <h6 {...props} {...getSourcePositionProps(node)} />
          },
          li({ node, ...props }: any) {
            return <li {...props} {...getSourcePositionProps(node)} />
          },
          ol({ node, ...props }: any) {
            return <ol {...props} {...getSourcePositionProps(node)} />
          },
          p({ node, ...props }: any) {
            return <p {...props} {...getSourcePositionProps(node)} />
          },
          table({ children, node, ...props }: any) {
            return (
              <div className='markdown-table-wrapper' {...getSourcePositionProps(node)}>
                <table {...props}>{children}</table>
              </div>
            )
          },
          td({ node, ...props }: any) {
            return <td {...props} {...getSourcePositionProps(node)} />
          },
          th({ node, ...props }: any) {
            return <th {...props} {...getSourcePositionProps(node)} />
          },
          tr({ node, ...props }: any) {
            return <tr {...props} {...getSourcePositionProps(node)} />
          },
          ul({ node, ...props }: any) {
            return <ul {...props} {...getSourcePositionProps(node)} />
          },
          code({ inline, className, children, node, ...props }: any) {
            const langClass = typeof className === 'string' ? className : ''
            const match = /language-(\w+)/.exec(langClass)
            const isInline = inline === true
            const codeContent = String(children).replace(/\n$/, '')
            return !isInline && match != null
              ? (
                <div {...getSourcePositionProps(node)}>
                  <CodeBlock code={codeContent} lang={match[1]} />
                </div>
              )
              : <code className={langClass} {...props} {...getSourcePositionProps(node)}>{children}</code>
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
