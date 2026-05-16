export interface QueryResult {
  columns: string[]
  rows: unknown[][]
  rowCount: number
  elapsed: number
}