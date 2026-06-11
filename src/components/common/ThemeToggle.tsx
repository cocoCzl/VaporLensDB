import { Laptop, Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/uiStore'

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'settings.theme.system', icon: Laptop },
  { value: 'dark', labelKey: 'settings.theme.dark', icon: Moon },
  { value: 'light', labelKey: 'settings.theme.light', icon: Sun },
] as const

export function ThemeToggle() {
  const { t } = useTranslation()
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const option = THEME_OPTIONS.find((item) => item.value === theme) ?? THEME_OPTIONS[0]
  const Icon = option.icon
  const label = t(option.labelKey)

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      title={t('settings.theme.current', { label })}
      aria-label={t('settings.theme.current', { label })}
      onClick={() => {
        const index = THEME_OPTIONS.findIndex((item) => item.value === theme)
        setTheme(THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].value)
      }}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}
