import { create } from 'zustand'
interface Choice { message: string; detail?: string; choices: string[]; resolve: (choice: string) => void }
export const useSqlFileChoice = create<{ pending: Choice | null }>(() => ({ pending: null }))
export function chooseSqlFileAction(message: string, choices: string[], detail?: string): Promise<string> {
  if (useSqlFileChoice.getState().pending) return Promise.resolve('cancel')
  return new Promise((resolve) => useSqlFileChoice.setState({ pending: { message, detail, choices, resolve: (choice) => {
    useSqlFileChoice.setState({ pending: null }); resolve(choice)
  } } }))
}
