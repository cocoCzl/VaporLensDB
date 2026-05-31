interface StatusBarProps {
  backendStatus: string
}

export function StatusBar({ backendStatus }: StatusBarProps) {
  return (
    <footer className="h-6 border-t bg-muted text-muted-foreground text-xs px-2 flex items-center">
      Backend: {backendStatus}
    </footer>
  )
}
