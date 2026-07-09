import { RouteContainerHeaderBreadcrumbContent } from '@oneworks/components/route-layout'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('route container header breadcrumb order', () => {
  it('renders outer ancestors before the direct parent and current page', () => {
    const markup = renderToStaticMarkup(
      <RouteContainerHeaderBreadcrumbContent
        backLabel='返回'
        currentTitle='Base Profile 项目规则'
        titleText='Base Profile 项目规则'
        breadcrumb={{
          ancestors: [
            { title: '账号' },
            { title: 'Owner Local' },
            { title: '团队' },
            { title: 'Local' }
          ],
          currentTitle: 'Base Profile 项目规则',
          onBack: () => undefined,
          parentTitle: '项目规则'
        }}
      />
    )

    const labels = ['账号', 'Owner Local', '团队', 'Local', '项目规则', 'Base Profile 项目规则']
    const positions = labels.map(label => markup.indexOf(`>${label}<`))

    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })
})
