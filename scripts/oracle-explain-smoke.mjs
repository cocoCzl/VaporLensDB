import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

function assert(condition, message) {
  if (!condition) failures.push(message)
}

const jdbc = readFileSync(resolve(root, 'src-tauri/src/drivers/jdbc.rs'), 'utf8')
assert(jdbc.includes('self.driver_type != DriverType::Oracle'), 'generic JDBC must reject explain requests')
assert(jdbc.includes('EXPLAIN PLAN SET STATEMENT_ID'), 'Oracle explain must create a session plan')
assert(jdbc.includes('DBMS_XPLAN.DISPLAY'), 'Oracle explain must read formatted plan output')
assert(jdbc.includes("DELETE FROM PLAN_TABLE WHERE STATEMENT_ID"), 'Oracle explain must clean up its plan rows')
assert(jdbc.includes('clarify_oracle_explain_error'), 'Oracle explain must clarify plan permission errors')

const mainPanel = readFileSync(resolve(root, 'src/components/layout/MainPanel.tsx'), 'utf8')
assert(mainPanel.includes("case 'oracle':") && mainPanel.includes('canExplain: true'), 'Oracle UI must enable explain')

const oracleTest = readFileSync(resolve(root, 'src-tauri/tests/oracle_jdbc_driver.rs'), 'utf8')
assert(oracleTest.includes('explains_oracle_query_with_tabular_plan'), 'Oracle integration coverage is missing')

if (failures.length > 0) {
  console.error('Oracle explain smoke failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Oracle explain smoke passed.')
