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
  ...props
}: AppSelectProps) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue ?? '')} disabled={disabled}>
      <SelectTrigger id={id} className={cn('w-full min-w-0 bg-card text-xs', className)} {...props}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={cn('max-w-[min(28rem,var(--available-width))]', contentClassName)} align="start">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
