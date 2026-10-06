import { invokeCommand } from './client'
import { COMMANDS } from './contracts'
export interface SqlFileDocument {
  token: string
  path: string
  name: string
  text: string
  fingerprint: string
  bom: boolean
  eol: 'lf' | 'crlf'
  conflict: boolean
}
export function sqlFile(input: { action: 'open' | 'select' | 'read' | 'write'; token?: string; suggested?: string; text?: string; fingerprint?: string; bom?: boolean; eol?: string }) {
  return invokeCommand<SqlFileDocument | null>(COMMANDS.sqlFile, { input })
}
