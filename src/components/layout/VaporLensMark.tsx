import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

/** The shared, deliberately small application mark used in shell-level chrome. */
export function VaporLensMark({ className, ...props }: ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-10 shrink-0', className)} aria-hidden="true" {...props}>
      <rect width="40" height="40" rx="9" fill="hsl(var(--primary))" />
      <ellipse cx="20" cy="11" rx="10" ry="4" fill="none" stroke="white" strokeWidth="2.2" />
      <path d="M10 11v16c0 2.2 4.5 4 10 4s10-1.8 10-4V11M10 19c0 2.2 4.5 4 10 4s10-1.8 10-4" fill="none" stroke="white" strokeWidth="2.2" />
      <circle cx="28.5" cy="28.5" r="5.5" fill="hsl(var(--surface))" stroke="hsl(var(--primary))" strokeWidth="2" />
      <path d="m32.5 32.5 3 3" stroke="hsl(var(--primary))" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
