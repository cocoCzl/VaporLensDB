import { Toaster as Sonner, type ToasterProps } from "sonner"
// Release CSP adds a nonce to inline styles. Sonner's runtime style injection
// has no nonce, so ship its positioning/layout CSS as a normal bundled asset.
import 'sonner/dist/styles.css'
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useUiStore } from '@/stores/uiStore'

const Toaster = ({ ...props }: ToasterProps) => {
  const resolvedTheme = useUiStore((state) => state.resolvedTheme)

  return (
    <Sonner
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-right"
      offset={{ bottom: 48, right: 20, left: 20 }}
      visibleToasts={3}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast max-w-[calc(100vw-2.5rem)]",
          content: "min-w-0 [overflow-wrap:anywhere]",
          actionButton: "shrink-0",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
