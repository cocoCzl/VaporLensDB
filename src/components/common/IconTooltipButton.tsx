import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface IconTooltipButtonProps extends Omit<ComponentProps<typeof Button>, 'children'> {
  label: string
  children: ReactNode
}

export function IconTooltipButton({ label, children, size = 'icon-sm', ...props }: IconTooltipButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button type="button" size={size} aria-label={label} {...props}>
            {children}
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
