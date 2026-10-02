import { describe, expect, it } from 'vitest'
import { dbeaverPreviewToConnectionInput, previewDbeaverConfiguration } from './dbeaverImport'

function configFile(name: string, source: string): File {
  return Object.assign(new File([source], name), { text: async () => source })
}

describe('DBeaver target connection contract', () => {
  it.each([
    ['postgres', 'jdbc:postgresql://localhost:5432/app', 'postgres', null, 5432],
    ['mysql', 'jdbc:mysql://localhost:3306/app', 'mysql', null, 3306],
    ['mssql', 'jdbc:sqlserver://localhost:1433;encrypt=true;databaseName=app', 'mssql', null, 1433],
    ['sqlite', 'jdbc:sqlite:/tmp/example.db', 'sqlite', '/tmp/example.db', null],
    ['sqlite', 'jdbc:sqlite::memory:', 'sqlite', ':memory:', null],
    ['sqlite', 'jdbc:sqlite:file:/tmp/example.db?mode=ro', 'sqlite', 'file:/tmp/example.db?mode=ro', null],
    ['oracle', 'jdbc:oracle:thin:@//localhost:1521/app', 'oracle', 'jdbc:oracle:thin:@//localhost:1521/app', 1521],
  ])('maps %s URL %s to the actual target', async (driver, url, driverType, connectionUrl, port) => {
    const preview = await previewDbeaverConfiguration([configFile('data-sources.json', JSON.stringify({
      folders: { parent: { name: 'Work' }, child: { name: 'App', parent: 'parent' } },
      connections: { source: { name: 'Fixture', driver, folder: 'child', configuration: { url, user: 'reader', password: 'dummy-reference' } } },
    }))])
    const input = dbeaverPreviewToConnectionInput(preview.connections[0])
    expect(input).toMatchObject({ driverType, driverDefinitionId: driverType, connectionUrl, port, username: 'reader', group: 'Work / App', password: null })
    if (['postgres', 'mysql', 'mssql'].includes(driver)) expect(input).toMatchObject({ host: 'localhost', database: 'app' })
    expect(preview.connections[0].connectionUrl).toBe(connectionUrl)
    expect(preview.connections[0].passwordStatus).toBe('manualEntryRequired')
    expect(preview.passwordEntries).toBe(1)
  })

  it('uses the same native rules for XML and retains external password references', async () => {
    const preview = await previewDbeaverConfiguration([
      configFile('data-sources.xml', '<data-sources><data-source id="01234567-89ab-cdef-0123-456789abcdef" name="PG" driver="postgres" folder="Work"><connection url="jdbc:postgresql://localhost:5432/app" user="reader"/></data-source><data-source id="sqlite" driver="sqlite"><connection url="jdbc:sqlite:/tmp/example.db"/></data-source></data-sources>'),
      configFile('credentials-config.json', '{"01234567-89ab-cdef-0123-456789abcdef": {"password": "dummy-reference"}}'),
    ])
    expect(dbeaverPreviewToConnectionInput(preview.connections[0])).toMatchObject({ host: 'localhost', port: 5432, database: 'app', connectionUrl: null, username: 'reader', group: 'Work' })
    expect(preview.connections[0].passwordStatus).toBe('manualEntryRequired')
    expect(preview.connections[1].connectionUrl).toBe('/tmp/example.db')
  })

  it('extracts URL credentials without importing or persisting passwords', async () => {
    const preview = await previewDbeaverConfiguration([configFile('data-sources.json', JSON.stringify({ connections: {
      pg: { driver: 'postgres', configuration: { url: 'jdbc:postgresql://reader:dummyPassword@localhost:5432/app?password=dummyQueryPassword&sslmode=require' } },
      sql: { driver: 'mssql', configuration: { url: 'jdbc:sqlserver://localhost;databaseName=app;user=reader;password=dummyPassword;encrypt=true' } },
    } }))])
    for (const connection of preview.connections) {
      expect(dbeaverPreviewToConnectionInput(connection)).toMatchObject({ username: 'reader', password: null, connectionUrl: null })
      expect(connection.host).toBe('localhost')
      expect(connection.passwordStatus).toBe('manualEntryRequired')
    }
  })

  it('keeps JDBC-backed URLs but strips their input credentials from preview and submission', async () => {
    const preview = await previewDbeaverConfiguration([configFile('data-sources.json', JSON.stringify({ connections: {
      oracle: { driver: 'oracle', configuration: { url: 'jdbc:oracle:thin:@//localhost:1521/app?user=reader&password=dummyPassword&applicationName=fixture' } },
    } }))])
    const connection = preview.connections[0]
    expect(connection).toMatchObject({ username: 'reader', passwordStatus: 'manualEntryRequired', connectionUrl: 'jdbc:oracle:thin:@//localhost:1521/app?applicationName=fixture' })
    expect(dbeaverPreviewToConnectionInput(connection)).toMatchObject({ driverDefinitionId: 'oracle', password: null, connectionUrl: connection.connectionUrl })
  })
})
