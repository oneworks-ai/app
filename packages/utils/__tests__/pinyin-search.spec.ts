import { describe, expect, it } from 'vitest'

import { buildPinyinSearchText, matchesPinyinSearch } from '../src/pinyin-search'

describe('pinyin search', () => {
  it('matches full pinyin and first letters for Chinese text', () => {
    const values = ['文件搜索', 'Launcher 设置']

    expect(matchesPinyinSearch('wenjian', values)).toBe(true)
    expect(matchesPinyinSearch('wjss', values)).toBe(true)
    expect(matchesPinyinSearch('shezhi', values)).toBe(true)
    expect(matchesPinyinSearch('launcher sz', values)).toBe(true)
  })

  it('keeps plain text matching for non-Chinese text', () => {
    expect(matchesPinyinSearch('terminal', ['New Terminal', '终端'])).toBe(true)
    expect(matchesPinyinSearch('missing', ['New Terminal', '终端'])).toBe(false)
  })

  it('builds compact and spaced pinyin variants', () => {
    const searchText = buildPinyinSearchText(['开机自启'])

    expect(searchText).toContain('kai ji zi qi')
    expect(searchText).toContain('kaijiziqi')
    expect(searchText).toContain('kjzq')
  })
})
