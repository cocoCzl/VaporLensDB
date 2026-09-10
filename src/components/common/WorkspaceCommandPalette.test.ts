import { describe, expect, it } from 'vitest'
import { databaseObjectSearchText, dedupePaletteQueryHistory, rankPaletteItems, type PaletteSearchItem } from '@/lib/commandPaletteRanking'
import type { QueryHistoryEntry } from '@/types/queryHistory'

function item(label: string, searchText = label): PaletteSearchItem {
  return {
    id: label,
    label,
    searchText,
  }
}

function historyEntry(overrides: Partial<QueryHistoryEntry>): QueryHistoryEntry {
  return {
    id: crypto.randomUUID(),
    connectionId: 'oracle-1',
    connectionNameSnapshot: 'Local Oracle',
    driverType: 'oracle',
    database: 'CDB',
    schema: 'DEVELOP',
    sql: 'SELECT * FROM DEVELOP.META_DATA',
    status: 'success',
    startedAt: '2026-09-10T08:00:00.000Z',
    ...overrides,
  }
}

describe('WorkspaceCommandPalette ranking', () => {
  it('prefers exact, prefix, word-prefix, then contains matches', () => {
    const results = rankPaletteItems([
      item('audit_user_log'),
      item('user_account'),
      item('user'),
      item('app_users'),
    ], 'user', null)

    expect(results.map((result) => result.label)).toEqual([
      'user',
      'user_account',
      'audit_user_log',
      'app_users',
    ])
  })

  it('gives an otherwise equal current-connection result a small preference', () => {
    const local = { ...item('users', 'users local'), id: 'local', currentConnection: true }
    const remote = { ...item('users', 'users remote'), id: 'remote' }

    expect(rankPaletteItems([remote, local], 'users', 'connection-1').map((result) => result.id)).toEqual([
      'local',
      'remote',
    ])
  })

  it('matches cached objects by their own name or qualified path, never their connection name', () => {
    const objects = [
      item('ORACLE_OCM', databaseObjectSearchText({ name: 'ORACLE_OCM', schema: 'SYS' })),
      item('ORACLE_TEST', databaseObjectSearchText({ name: 'ORACLE_TEST', schema: 'DEVELOP' })),
      item('DATE_USE_ORACLE_FORMAT', databaseObjectSearchText({ name: 'DATE_USE_ORACLE_FORMAT', schema: 'DEVELOP' })),
      item('CDB$ROOT', databaseObjectSearchText({ name: 'CDB$ROOT' })),
      item('DEVELOP', databaseObjectSearchText({ name: 'DEVELOP' })),
      item('ANONYMOUS', databaseObjectSearchText({ name: 'ANONYMOUS' })),
      item('APPQOSSYS', databaseObjectSearchText({ name: 'APPQOSSYS' })),
      item('ORDERS', databaseObjectSearchText({ name: 'ORDERS', database: 'CDB', schema: 'ORACLE_APP' })),
    ]

    expect(rankPaletteItems(objects, 'oracle', null).map((result) => result.label)).toEqual([
      'ORACLE_OCM',
      'ORACLE_TEST',
      'DATE_USE_ORACLE_FORMAT',
      'ORDERS',
    ])
  })

  it('keeps cached META object-name matches when searching META', () => {
    const metaDataObject = item('META_DATA', databaseObjectSearchText({ name: 'META_DATA', database: 'CDB', schema: 'DEVELOP' }))
    const metaData4 = item('META_DATA4', databaseObjectSearchText({ name: 'META_DATA4', schema: 'DEVELOP' }))
    const metaDataGdb = item('META_DATA_GDB', databaseObjectSearchText({ name: 'META_DATA_GDB', schema: 'DEVELOP' }))
    const connectionMeta = item('AJDBC_CONNECTION_META_TEST', databaseObjectSearchText({ name: 'AJDBC_CONNECTION_META_TEST', schema: 'DEVELOP' }))
    const history = item('SELECT * FROM DEVELOP.META_DATA', 'SELECT * FROM DEVELOP.META_DATA Local Oracle DEVELOP')

    expect(rankPaletteItems([metaDataObject, metaData4, metaDataGdb, connectionMeta, history], 'META', null).map((result) => result.label)).toEqual([
      'META_DATA',
      'META_DATA4',
      'META_DATA_GDB',
      'AJDBC_CONNECTION_META_TEST',
      'SELECT * FROM DEVELOP.META_DATA',
    ])
  })

  it('keeps datasource and history matches that explicitly mention Oracle', () => {
    const localOracle = item('Local Oracle', 'Local Oracle oracle 192.168.0.35')
    const history = item('SELECT * FROM DEVELOP.META_DATA', 'SELECT * FROM DEVELOP.META_DATA Local Oracle DEVELOP')

    expect(rankPaletteItems([history, localOracle], 'oracle', null).map((result) => result.label)).toEqual([
      'Local Oracle',
      'SELECT * FROM DEVELOP.META_DATA',
    ])
  })

  it('shows only the newest duplicate history entry without altering the original history list', () => {
    const older = historyEntry({ id: 'older', startedAt: '2026-09-10T08:00:00.000Z' })
    const newest = historyEntry({
      id: 'newest',
      sql: 'SELECT * FROM DEVELOP.META_DATA;',
      startedAt: '2026-09-10T09:00:00.000Z',
    })
    const entries = [older, newest]
    const originalEntries = [...entries]

    expect(dedupePaletteQueryHistory(entries).map((entry) => entry.id)).toEqual(['newest'])
    expect(entries).toEqual(originalEntries)
  })

  it('keeps identical SQL separate when its connection context differs', () => {
    const oracle = historyEntry({ id: 'oracle', connectionId: 'oracle-1', database: 'CDB', schema: 'DEVELOP' })
    const mysql = historyEntry({
      id: 'mysql',
      connectionId: 'mysql-1',
      connectionNameSnapshot: 'Local Mysql',
      driverType: 'mysql',
      database: 'ops_dev',
      schema: 'ops_dev',
    })

    expect(dedupePaletteQueryHistory([oracle, mysql]).map((entry) => entry.id)).toEqual(['oracle', 'mysql'])
  })
})
