import { Laptop, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiStore } from '@/stores/uiStore'

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: Laptop },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'light', label: '浅色', icon: Sun },
] as const

export function ThemeToggle() {
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const option = THEME_OPTIONS.find((item) => item.value === theme) ?? THEME_OPTIONS[0]
  const Icon = option.icon

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      title={`主题：${option.label}`}
      aria-label={`主题：${option.label}`}
      onClick={() => {
        const index = THEME_OPTIONS.findIndex((item) => item.value === theme)
        setTheme(THEME_OPTIONS[(index + 1) % THEME_OPTIONS.length].value)
      }}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}
