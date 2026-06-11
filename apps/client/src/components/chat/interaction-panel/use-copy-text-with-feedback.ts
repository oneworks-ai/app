import { useCallback } from 'react'

import { copyTextWithFeedback } from '#~/utils/copy'

export const useCopyTextWithFeedback = (
  failureMessage: string,
  messageApi: Parameters<typeof copyTextWithFeedback>[0]['messageApi']
) =>
  useCallback((text: string, successMessage: string) => {
    void copyTextWithFeedback({ failureMessage, messageApi, successMessage, text })
  }, [failureMessage, messageApi])
