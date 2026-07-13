import { describe, expect, it, vi } from 'vitest'

import { resetSkillRegistryModal } from '#~/components/knowledge-base/components/use-skill-registry-modal'

describe('skill registry modal lifecycle', () => {
  it('clears unsaved values before opening and after closing', () => {
    const resetFields = vi.fn()
    const setOpen = vi.fn()

    resetSkillRegistryModal({ resetFields }, setOpen, true)
    resetSkillRegistryModal({ resetFields }, setOpen, false)

    expect(resetFields).toHaveBeenCalledTimes(2)
    expect(setOpen.mock.calls).toEqual([[true], [false]])
  })
})
