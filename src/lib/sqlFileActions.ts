export type SqlFileAction = 'open' | 'save' | 'saveAs'
/** Menu, palette and toolbar share the same lazy workflow. */
export function dispatchSqlFileAction(action: SqlFileAction) {
  void import('./sqlFileWorkflow').then(async (workflow) => { await workflow.runSqlFileAction(action) })
}
