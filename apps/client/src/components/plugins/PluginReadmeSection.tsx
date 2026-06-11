import { Alert, Select, Skeleton, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'

import { MarkdownContent } from '#~/components/MarkdownContent'
import { MaterialSymbol } from '#~/components/icons/MaterialSymbol'
import { buildPluginReadmeAssetUrl } from '#~/plugins/api'
import type { PluginReadme } from '#~/plugins/api'

import { resolvePluginReadmeAssetPath } from './plugin-readme-links'

interface PluginReadmeSectionProps {
  emptyText: string
  error?: string
  loading: boolean
  preferredLanguage?: string
  pluginScope: string
  readme?: PluginReadme
  readmes?: PluginReadme[]
  showTitle?: boolean
  title: string
}

const normalizeLanguage = (value: string | undefined) => value?.replace(/_/g, '-').toLowerCase()

const chooseReadmePath = (readmes: PluginReadme[], preferredLanguage: string | undefined) => {
  if (readmes.length === 0) return undefined
  const preferred = normalizeLanguage(preferredLanguage)
  if (preferred != null) {
    const exact = readmes.find(readme => normalizeLanguage(readme.language) === preferred)
    if (exact != null) return exact.path

    const baseLanguage = preferred.split('-')[0]
    const baseMatch = readmes.find(readme => normalizeLanguage(readme.language)?.split('-')[0] === baseLanguage)
    if (baseMatch != null) return baseMatch.path
  }
  return readmes[0].path
}

export function PluginReadmeSection({
  emptyText,
  error,
  loading,
  preferredLanguage,
  pluginScope,
  readme,
  readmes = readme == null ? [] : [readme],
  showTitle = true,
  title
}: PluginReadmeSectionProps) {
  const [selectedPath, setSelectedPath] = useState<string | undefined>(() =>
    chooseReadmePath(readmes, preferredLanguage)
  )
  const selectedReadme = useMemo(
    () => readmes.find(item => item.path === selectedPath) ?? readme,
    [readme, readmes, selectedPath]
  )
  const readmeOptions = useMemo(
    () =>
      readmes.map(item => ({
        label: item.language == null ? item.path : `${item.language} (${item.path})`,
        value: item.path
      })),
    [readmes]
  )

  useEffect(() => {
    setSelectedPath(chooseReadmePath(readmes, preferredLanguage))
  }, [preferredLanguage, readmes])

  const getReadmeAssetUrl = (href: string) => {
    if (selectedReadme == null) return undefined
    const assetPath = resolvePluginReadmeAssetPath(selectedReadme.path, href)
    return assetPath == null ? undefined : buildPluginReadmeAssetUrl(pluginScope, assetPath)
  }
  const renderImage = ({ alt, src, title: imageTitle }: { alt?: string; src: string; title?: string }) => {
    const resolvedSrc = getReadmeAssetUrl(src) ?? src
    return (
      <img
        src={resolvedSrc}
        alt={alt ?? ''}
        title={imageTitle}
        loading='lazy'
        decoding='async'
        referrerPolicy='no-referrer'
      />
    )
  }
  const handleLinkClick = (href: string, event: MouseEvent<HTMLAnchorElement>) => {
    const assetUrl = getReadmeAssetUrl(href)
    if (assetUrl == null) return
    event.preventDefault()
    window.open(assetUrl, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className='plugin-detail-route__readme'>
      {showTitle && (
        <div className='plugin-detail-route__title-row'>
          <div className='plugin-detail-route__title-main'>
            <MaterialSymbol name='article' />
            <h2>{title}</h2>
          </div>
          {selectedReadme != null && <Tag>{selectedReadme.path}</Tag>}
        </div>
      )}
      {readmeOptions.length > 1 && (
        <div className='plugin-detail-route__readme-toolbar'>
          <Select
            aria-label={title}
            options={readmeOptions}
            popupMatchSelectWidth={false}
            size='small'
            value={selectedPath}
            onChange={setSelectedPath}
          />
        </div>
      )}
      {loading
        ? <Skeleton active paragraph={{ rows: 5 }} title={false} />
        : error != null
        ? <Alert type='warning' showIcon message={error} />
        : selectedReadme == null
        ? <p className='plugin-detail-route__empty'>{emptyText}</p>
        : (
          <div className='plugin-detail-route__readme-content'>
            <MarkdownContent
              content={selectedReadme.content}
              openLinksInNewTab
              renderImage={renderImage}
              onLinkClick={handleLinkClick}
            />
          </div>
        )}
    </section>
  )
}
