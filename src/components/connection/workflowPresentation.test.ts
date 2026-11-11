import { expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { workflowErrorSummary } from './workflowPresentation'
const t = ((key: string) => key) as TFunction
it.each(['ORA-01005: null password given; logon denied', 'ORA-01017: invalid username/password', 'authentication failed'])('keeps java.sql authentication failures in connection classification: %s', message => {
  expect(workflowErrorSummary({ code: 'CONNECTION_FAILED', message: `java.sql.SQLException: ${message}` }, t)).toBe('driverWorkflow.errors.connection')
})
it.each(['Java runtime was not found', 'java executable is missing', 'JDK is required', 'JDBC bridge requires Java 21 or newer; selected PATH runtime is older'])('retains missing Java classification: %s', message => {
  expect(workflowErrorSummary({ code: 'CONFIG_ERROR', message }, t)).toBe('driverWorkflow.errors.java')
})
it.each(['java.lang.ClassNotFoundException: oracle.jdbc.OracleDriver', 'JDBC driver class or JAR is not usable', 'JDBC driver class or bridge class is missing from the classpath'])('keeps JAR/class failures distinct from runtime availability: %s', message => {
  expect(workflowErrorSummary({ code: 'CONNECTION_FAILED', message }, t)).toBe('driverWorkflow.errors.driver')
})
