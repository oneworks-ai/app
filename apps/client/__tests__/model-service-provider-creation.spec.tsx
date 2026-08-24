// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ModelServiceCollectionView } from '#~/components/config/ModelServiceCollectionView'
import { configSchema } from '#~/components/config/configSchema'

const t = (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key

describe('model service Provider creation', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('creates another Provider with a default Profile without replacing a standalone service', async () => {
    const field = configSchema.modelServices?.[0]
    if (field == null) throw new Error('Expected the model services field')
    const onChange = vi.fn()
    const onOpenDetail = vi.fn()

    await act(async () => {
      root.render(
        <ModelServiceCollectionView
          field={field}
          value={{
            deepseek: {
              provider: 'deepseek',
              apiKey: 'legacy-key'
            }
          }}
          source='project'
          onChange={onChange}
          onOpenDetail={onOpenDetail}
          t={t}
        />
      )
    })

    const deepSeekCard = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.model-service-collection__card--available button')
    ).find(button => button.textContent?.includes('DeepSeek'))
    expect(deepSeekCard).toBeDefined()

    await act(async () => {
      deepSeekCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({
      deepseek: {
        provider: 'deepseek',
        apiKey: 'legacy-key'
      },
      'deepseek-2': {
        kind: 'collection',
        title: '',
        description: '',
        provider: 'deepseek',
        profiles: {
          default: {
            extra: {}
          }
        }
      }
    })
    expect(onOpenDetail).toHaveBeenCalledWith({
      kind: 'detailCollectionItem',
      fieldPath: [],
      itemKey: 'deepseek-2'
    })
  })

  it('shows two Profile quotas and opens the Profile list when a Provider has more than three', async () => {
    const field = configSchema.modelServices?.[0]
    if (field == null) throw new Error('Expected the model services field')
    const onOpenDetail = vi.fn()

    await act(async () => {
      root.render(
        <ModelServiceCollectionView
          field={field}
          value={{
            deepseek: {
              kind: 'collection',
              provider: 'deepseek',
              profiles: {
                default: { apiKey: 'demo-key', title: 'Default' },
                personal: { apiKey: 'demo-key', title: 'Personal' },
                work: { apiKey: 'demo-key', title: 'Work' },
                backup: { apiKey: 'demo-key', title: 'Backup' }
              }
            }
          }}
          source='project'
          onChange={() => undefined}
          onOpenDetail={onOpenDetail}
          t={t}
        />
      )
    })

    expect(container.querySelectorAll('.config-view__model-service-profile-quota')).toHaveLength(2)
    const viewAllButton = container.querySelector<HTMLButtonElement>(
      '.config-view__model-service-profile-quota-more'
    )
    expect(viewAllButton?.textContent).toContain('config.modelServices.profileQuotaMore')

    await act(async () => {
      viewAllButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onOpenDetail).toHaveBeenCalledWith({
      kind: 'detailCollectionItem',
      fieldPath: [],
      itemKey: 'deepseek',
      nestedPath: ['profiles']
    })
  })
})
