import { describe, expect, it } from 'vitest'

import type { ChatMessage, ChatMessageContent } from '@oneworks/core'
import type { DesktopFirstActionMilestone } from '@oneworks/types'

import {
  createDesktopFirstActionId,
  createDesktopFirstActionReporter,
  isDisplayableAssistantResponse
} from '#~/diagnostics/desktop-first-action'

const ACTION_ID = 'client-action-00000000-0000-4000-8000-000000000001'
const OTHER_ACTION_ID = 'client-action-00000000-0000-4000-8000-000000000002'

const message = (
  id: string,
  role: ChatMessage['role'],
  content: ChatMessage['content'],
  createdAt = 101
): ChatMessage => ({ content, createdAt, id, role })

const assistantMessage = (content: ChatMessage['content'], createdAt = 101): ChatMessage => (
  message('assistant-1', 'assistant', content, createdAt)
)

const actionMessage = (createdAt = 101): ChatMessage => message(ACTION_ID, 'user', 'Do it.', createdAt)

describe('desktop first-action diagnostics', () => {
  it('creates a content-free client action correlation ID', () => {
    expect(createDesktopFirstActionId()).toMatch(/^client-action-[A-Za-z0-9-]{16,96}$/)
  })

  it('reports one content-free lifecycle from the same action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.accepted('session-before-submit', ACTION_ID)
    reporter.submitted('session-1', ACTION_ID)
    reporter.submitted('session-1', ACTION_ID)
    reporter.accepted('session-2', ACTION_ID)
    reporter.accepted('session-1', OTHER_ACTION_ID)
    reporter.accepted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())
    reporter.messageObserved('session-1', assistantMessage('Ready.'))
    reporter.messageObserved('session-1', assistantMessage('Duplicate response.'))
    reporter.succeeded('session-2')
    reporter.succeeded('session-1')

    expect(milestones).toEqual([
      'first.submit',
      'submit.accepted',
      'first.response.received',
      'first.success'
    ])
  })

  it('does not let a later session or retry replace the first submitted action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-a', ACTION_ID)
    reporter.accepted('session-a', ACTION_ID)
    reporter.submitted('session-b', OTHER_ACTION_ID)
    reporter.messageObserved('session-b', message(OTHER_ACTION_ID, 'user', 'retry'))
    reporter.messageObserved('session-b', assistantMessage('early response'))
    reporter.succeeded('session-b')
    reporter.accepted('session-b', OTHER_ACTION_ID)
    expect(milestones).toEqual(['first.submit', 'submit.accepted'])

    reporter.messageObserved('session-a', actionMessage())
    reporter.messageObserved('session-a', assistantMessage('first action response'))
    reporter.succeeded('session-a')
    expect(milestones).toEqual([
      'first.submit',
      'submit.accepted',
      'first.response.received',
      'first.success'
    ])
  })

  it('records an output-free completion after observing the exact user action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.accepted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())
    reporter.succeeded('session-1')

    expect(milestones).toEqual(['first.submit', 'submit.accepted', 'first.success'])
  })

  it('does not mistake stale messages or completion for the new action across clock skew', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', message(OTHER_ACTION_ID, 'user', 'old', Number.MAX_SAFE_INTEGER))
    reporter.messageObserved('session-1', assistantMessage('old response', Number.MAX_SAFE_INTEGER))
    reporter.succeeded('session-1')
    reporter.accepted('session-1', ACTION_ID)
    expect(milestones).toEqual(['first.submit', 'submit.accepted'])

    reporter.messageObserved('session-1', actionMessage(-1))
    reporter.messageObserved('session-1', assistantMessage('real response', -1))
    reporter.succeeded('session-1')
    expect(milestones).toEqual([
      'first.submit',
      'submit.accepted',
      'first.response.received',
      'first.success'
    ])
  })

  it('keeps success independent of a lost or late HTTP acceptance', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())
    reporter.succeeded('session-1')
    reporter.accepted('session-1', ACTION_ID)

    expect(milestones).toEqual(['first.submit', 'first.success', 'submit.accepted'])
  })

  it('requires each live source to observe the exact action before it can complete it', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'client-events')
    reporter.succeeded('session-1', 'session-live')
    expect(milestones).toEqual(['first.submit'])

    reporter.messageObserved('session-1', actionMessage(), 'session-live')
    reporter.succeeded('session-1', 'session-live')
    expect(milestones).toEqual(['first.submit', 'first.success'])
  })

  it('does not let a later turn complete the first action on a live source', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())
    reporter.messageObserved('session-1', message(OTHER_ACTION_ID, 'user', 'retry'))
    reporter.messageObserved('session-1', assistantMessage('retry response'))
    reporter.succeeded('session-1')

    expect(milestones).toEqual(['first.submit'])
  })

  it('keeps a superseded first action closed across source reconnects', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'client-events')
    reporter.restore('session-1', [
      actionMessage(),
      message(OTHER_ACTION_ID, 'user', 'retry')
    ], 'running')
    reporter.resetSource('client-events')
    reporter.succeeded('session-1', 'client-events')

    expect(milestones).toEqual(['first.submit'])
  })

  it('requires a reconnected source to observe the exact action again', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'client-events')
    reporter.resetSource('client-events')
    reporter.succeeded('session-1', 'client-events')

    expect(milestones).toEqual(['first.submit'])
  })

  it('does not carry session-live evidence across a subscriber observation gap', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'session-live')
    reporter.resetSource('session-live', 'session-1')
    reporter.succeeded('session-1', 'session-live')

    expect(milestones).toEqual(['first.submit'])
  })

  it('does not reset the tracked session when another panel reconnects', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'session-live')
    reporter.resetSource('session-live', 'session-other')
    reporter.succeeded('session-1', 'session-live')

    expect(milestones).toEqual(['first.submit', 'first.success'])
  })

  it('reports failed and terminated first-action outcomes without treating them as success', () => {
    const failedMilestones: DesktopFirstActionMilestone[] = []
    const failed = createDesktopFirstActionReporter(milestone => failedMilestones.push(milestone))
    failed.submitted('session-failed', ACTION_ID)
    failed.messageObserved('session-failed', actionMessage())
    failed.statusObserved('session-failed', 'failed')
    expect(failedMilestones).toEqual(['first.submit', 'first.failed'])

    const terminatedMilestones: DesktopFirstActionMilestone[] = []
    const terminated = createDesktopFirstActionReporter(milestone => terminatedMilestones.push(milestone))
    terminated.submitted('session-terminated', ACTION_ID)
    terminated.messageObserved('session-terminated', actionMessage())
    terminated.statusObserved('session-terminated', 'terminated')
    expect(terminatedMilestones).toEqual(['first.submit', 'first.terminated'])
  })

  it('terminates a queued first action only when the exact accepted item is deleted', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.terminated('session-1', OTHER_ACTION_ID)
    expect(milestones).toEqual(['first.submit'])

    reporter.terminated('session-1', ACTION_ID)
    expect(milestones).toEqual(['first.submit', 'first.terminated'])
  })

  it('reports uncertainty and refreshes its durable deadline on retry', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.uncertain('session-1', ACTION_ID)
    reporter.submitted('session-1', ACTION_ID)
    reporter.uncertain('session-1', ACTION_ID)

    expect(milestones).toEqual([
      'first.submit',
      'submit.uncertain',
      'submit.retrying'
    ])
  })

  it('reports causal observation after a retry so main can clear the refreshed deadline', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.uncertain('session-1', ACTION_ID)
    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())

    expect(milestones).toEqual([
      'first.submit',
      'submit.uncertain',
      'submit.retrying',
      'submit.observed'
    ])
  })

  it('cancels uncertainty after transport or causal runtime acknowledgement', () => {
    const acceptedMilestones: DesktopFirstActionMilestone[] = []
    const accepted = createDesktopFirstActionReporter(milestone => acceptedMilestones.push(milestone))
    accepted.submitted('session-accepted', ACTION_ID)
    accepted.uncertain('session-accepted', ACTION_ID)
    accepted.accepted('session-accepted', ACTION_ID)

    const observedMilestones: DesktopFirstActionMilestone[] = []
    const observed = createDesktopFirstActionReporter(milestone => observedMilestones.push(milestone))
    observed.submitted('session-observed', ACTION_ID)
    observed.uncertain('session-observed', ACTION_ID)
    observed.messageObserved('session-observed', actionMessage())
    observed.succeeded('session-observed')

    expect(acceptedMilestones).toEqual(['first.submit', 'submit.uncertain', 'submit.accepted'])
    expect(observedMilestones).toEqual([
      'first.submit',
      'submit.uncertain',
      'submit.observed',
      'first.success'
    ])
  })

  it('does not let late transport uncertainty override an observed action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage())
    reporter.uncertain('session-1', ACTION_ID)
    reporter.succeeded('session-1')

    expect(milestones).toEqual(['first.submit', 'first.success'])

    const acceptedMilestones: DesktopFirstActionMilestone[] = []
    const accepted = createDesktopFirstActionReporter(milestone => acceptedMilestones.push(milestone))
    accepted.submitted('session-accepted', ACTION_ID)
    accepted.accepted('session-accepted', ACTION_ID)
    accepted.uncertain('session-accepted', ACTION_ID)
    expect(acceptedMilestones).toEqual(['first.submit', 'submit.accepted'])
  })

  it('hands off safely to the session stream when client events disconnect mid-action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'client-events')
    reporter.messageObserved('session-1', actionMessage(), 'session-live')
    reporter.messageObserved('session-1', assistantMessage('response'), 'session-live')
    reporter.succeeded('session-1', 'session-live')

    expect(milestones).toEqual(['first.submit', 'first.response.received', 'first.success'])
  })

  it('restores only a snapshot containing the exact action and ignores stale late history', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.messageObserved('session-1', actionMessage(), 'session-live')
    reporter.restore('session-1', [
      message(OTHER_ACTION_ID, 'user', 'old', Number.MAX_SAFE_INTEGER),
      assistantMessage('old response', Number.MAX_SAFE_INTEGER)
    ], 'completed')
    reporter.accepted('session-1', ACTION_ID)
    expect(milestones).toEqual(['first.submit', 'submit.accepted'])

    reporter.restore('session-1', [
      actionMessage(-1),
      assistantMessage('new response', -1)
    ], 'completed')
    expect(milestones).toEqual([
      'first.submit',
      'submit.accepted',
      'first.response.received',
      'first.success'
    ])
  })

  it('does not attribute a later history turn to the first action', () => {
    const milestones: DesktopFirstActionMilestone[] = []
    const reporter = createDesktopFirstActionReporter(milestone => milestones.push(milestone))

    reporter.submitted('session-1', ACTION_ID)
    reporter.restore('session-1', [
      actionMessage(),
      message(OTHER_ACTION_ID, 'user', 'retry'),
      assistantMessage('retry response')
    ], 'completed')

    expect(milestones).toEqual(['first.submit'])
  })

  it('matches response diagnostics to the actual renderability contract', () => {
    const browserScreenshot: ChatMessageContent = {
      type: 'image',
      url: 'local-preview',
      name: 'browser-comment-screenshot-1.png'
    }

    expect(isDisplayableAssistantResponse(undefined)).toBe(false)
    expect(isDisplayableAssistantResponse(message('user-1', 'user', 'input'))).toBe(false)
    expect(isDisplayableAssistantResponse(assistantMessage('  '))).toBe(false)
    expect(isDisplayableAssistantResponse(assistantMessage([]))).toBe(false)
    expect(isDisplayableAssistantResponse(assistantMessage([{ type: 'text', text: '  ' }]))).toBe(false)
    expect(isDisplayableAssistantResponse(assistantMessage([{ type: 'text', text: 'Visible.' }]))).toBe(true)
    expect(isDisplayableAssistantResponse(assistantMessage([{ type: 'image', url: 'local-preview' }]))).toBe(true)
    expect(isDisplayableAssistantResponse(assistantMessage([{ type: 'file', path: '/tmp/a.txt' }]))).toBe(true)
    expect(isDisplayableAssistantResponse(assistantMessage([{
      type: 'tool_use',
      id: 'tool-1',
      name: 'read_file',
      input: {}
    }]))).toBe(true)
    expect(isDisplayableAssistantResponse(assistantMessage([{
      type: 'tool_result',
      tool_use_id: 'tool-1',
      content: 'result'
    }]))).toBe(false)
    expect(isDisplayableAssistantResponse(assistantMessage([browserScreenshot]))).toBe(false)
    expect(isDisplayableAssistantResponse({
      ...assistantMessage(''),
      toolCall: { args: {}, name: 'read_file', status: 'pending' }
    })).toBe(false)
    expect(isDisplayableAssistantResponse({
      ...assistantMessage([]),
      toolCall: { args: {}, name: 'read_file', status: 'pending' }
    })).toBe(true)
  })
})
