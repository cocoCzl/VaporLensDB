export interface SqlDraft {
  id: string
  connectionId?: string | null
  connectionNameSnapshot?: string | null
  database?: string | null
  schema?: string | null
  title: string
  sql: string
  createdAt: string
  updatedAt: string
  lastOpenedAt?: string | null
  closedAt?: string | null
}

export interface UpsertSqlDraftInput {
  id?: string | null
  connectionId?: string | null
  connectionNameSnapshot?: string | null
  database?: string | null
  schema?: string | null
  title: string
  sql: string
  closed?: boolean | null
}
