export const queueMobileDeviceTouchInput = async (
  queue: { current: Promise<void> },
  input: DesktopMobileDeviceInputEvent,
  sendInput: (input: DesktopMobileDeviceInputEvent) => Promise<void>
) => {
  if (input.kind !== 'touch') {
    await sendInput(input)
    return
  }
  queue.current = queue.current
    .catch(() => undefined)
    .then(() => sendInput(input))
  await queue.current
}
