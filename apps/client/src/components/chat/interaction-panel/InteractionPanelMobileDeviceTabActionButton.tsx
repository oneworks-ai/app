import { Button } from 'antd'

export function MobileDeviceTabActionButton({
  active,
  icon,
  label,
  onClick
}: {
  active?: boolean
  icon: string
  label: string
  onClick?: () => void
}) {
  return (
    <Button
      type='text'
      size='small'
      className={`chat-interaction-panel-mobile-debug__tab-action ${active ? 'is-active' : ''}`}
      icon={<span className='material-symbols-rounded' aria-hidden='true'>{icon}</span>}
      title={label}
      aria-label={label}
      aria-pressed={active == null ? undefined : active}
      onClick={event => {
        if (onClick == null) return
        event.preventDefault()
        onClick()
      }}
    />
  )
}
