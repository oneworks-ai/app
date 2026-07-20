import { Switch } from 'antd'

export function ProjectThemeSwitch({
  checked,
  description,
  disabled,
  label,
  onChange
}: {
  checked: boolean
  description: string
  disabled: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <div className='config-view__project-theme-switch'>
      <span className='config-view__project-theme-switch-text'>
        <span className='config-view__project-theme-switch-title'>{label}</span>
        <span className='config-view__project-theme-switch-desc'>{description}</span>
      </span>
      <Switch aria-label={label} size='small' checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}
