import type { QueryResult } from '@/types/query'

/** Capture before filesystem/dialog awaits: streaming appends to rows in place.
 * A result snapshot contains neither executable SQL nor an execution target.
 */
export function captureResultExport(result: QueryResult): QueryResult {
  return structuredClone(result)
}
