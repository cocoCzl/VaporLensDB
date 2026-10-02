import { create } from 'zustand'
import i18n from '@/i18n'
import { getTableDdl } from '@/ipc/metadata'
import { normalizeAppError } from '@/ipc/client'
import { useMetadataStore } from '@/stores/metadataStore'
import { useUiStore } from '@/stores/uiStore'
import type { ColumnInfo, ForeignKeyInfo, IndexInfo } from '@/types/metadata'

export interface ObjectInspection {
  connectionId: string
  schema: string
  table: string
  kind: 'table' | 'view' | 'materializedView'
  columns: ColumnInfo[]
  indexes: IndexInfo[]
  foreignKeys: ForeignKeyInfo[]
  ddl: string | null
  loading: boolean
  error?: string | null
}

interface ObjectInspectorState {
  selected: ObjectInspection | null
  inspectTable: (
    connectionId: string,
    schema: string,
    table: string,
    kind: 'table' | 'view' | 'materializedView',
  ) => Promise<void>
  clear: () => void
}

export const useObjectInspectorStore = create<ObjectInspectorState>((set) => ({
  selected: null,
  inspectTable: async (connectionId, schema, table, kind) => {
    const requestToken = ++latestInspectionToken
    set({
      selected: {
        connectionId,
        schema,
        table,
        kind,
        columns: [],
        indexes: [],
        foreignKeys: [],
        ddl: null,
        loading: true,
      },
    })

    try {
      const metadata = useMetadataStore.getState()
      const [columns, indexes, foreignKeys, ddl] = await Promise.all([
        metadata.loadColumns(connectionId, schema, table),
        metadata.loadIndexes(connectionId, schema, table),
        metadata.loadForeignKeys(connectionId, schema, table),
        getTableDdl(connectionId, schema, table),
      ])
      if (!isCurrentInspection(requestToken, connectionId, schema, table, kind)) return
      set({
        selected: {
          connectionId,
          schema,
          table,
          kind,
          columns,
          indexes,
          foreignKeys,
          ddl,
          loading: false,
        },
      })
    } catch (error) {
      if (!isCurrentInspection(requestToken, connectionId, schema, table, kind)) return
      const appError = normalizeAppError(error)
      useUiStore.getState().notifyError(appError, i18n.t('notifications.loadObjectStructureFailed'))
      set((state) => ({
        selected: state.selected
          ? { ...state.selected, loading: false, error: appError.message }
          : null,
      }))
    }
  },
  clear: () => {
    latestInspectionToken += 1
    set({ selected: null })
  },
}))

let latestInspectionToken = 0

function isCurrentInspection(
  token: number,
  connectionId: string,
  schema: string,
  table: string,
  kind: ObjectInspection['kind'],
) {
  const selected = useObjectInspectorStore.getState().selected
  return latestInspectionToken === token
    && selected?.connectionId === connectionId
    && selected.schema === schema
    && selected.table === table
    && selected.kind === kind
}
