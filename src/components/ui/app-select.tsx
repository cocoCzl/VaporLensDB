import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type AppSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

interface AppSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: AppSelectOption[]
  className?: string
  contentClassName?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
  title?: string
  /** Dedicated IDE combobox styling for compact workspace toolbars. */
  variant?: 'default' | 'toolbar' | 'ide'
}

/** A compact, keyboard-accessible application menu for every former native select. */
export function AppSelect({
  value,
  onValueChange,
  options,
  className,
  contentClassName,
  placeholder,
  disabled,
  id,
  variant = 'default',
  ...props
}: AppSelectProps) {
  const useIdeSkin = variant !== 'toolbar'
  const selectedLabel = (selectedValue: unknown) => {
    const match = options.find((option) => option.value === selectedValue)
    return match?.label ?? placeholder ?? ''
  }
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue ?? '')} disabled={disabled}>
      <SelectTrigger
        id={id}
        className={cn(
          'w-full min-w-0 text-xs shadow-none transition-[border-color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-primary/15',
          useIdeSkin
            ? `ide-combobox-trigger ${variant === 'ide' ? 'h-7' : 'h-8'} rounded-md border px-2.5 text-foreground focus-visible:border-[hsl(var(--ide-combo-focus))] focus-visible:ring-[hsl(var(--ide-combo-focus)/0.16)]`
            : variant === 'toolbar'
            ? 'h-7 rounded-sm border border-transparent bg-transparent px-2 hover:border-border hover:bg-card aria-expanded:border-border aria-expanded:bg-card focus-visible:border-primary/60'
            : 'border-border/80 bg-card hover:border-foreground/25 hover:bg-muted/35 focus-visible:border-primary/60',
          className,
        )}
        {...props}
      >
        <SelectValue placeholder={placeholder}>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className={cn(
          'max-w-[min(28rem,var(--available-width))] border-border/80 bg-popover p-1 shadow-[0_14px_30px_-18px_hsl(var(--foreground)/0.5)]',
          variant === 'ide' ? 'ide-combobox-content max-h-56 min-w-[7rem] rounded-md border p-1' : useIdeSkin ? 'ide-combobox-content max-h-56 min-w-0 rounded-md border p-1' : 'max-h-52 rounded-[2px] border-border bg-card p-0.5 shadow-[0_6px_16px_-10px_hsl(var(--overlay)/0.75)]',
          contentClassName,
        )}
        align="start"
        sideOffset={variant === 'toolbar' ? 0 : 4}
        alignItemWithTrigger={variant !== 'ide'}
      >
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled} title={option.label} className={cn('min-h-7 px-2 py-1 text-xs data-highlighted:bg-primary/10 data-highlighted:text-foreground [&_[data-slot=select-item-text]]:truncate', useIdeSkin ? 'ide-combobox-item rounded-[4px] px-2.5' : 'rounded-[1px]')}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
