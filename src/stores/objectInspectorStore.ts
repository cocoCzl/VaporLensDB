import { create } from 'zustand'
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
      const appError = normalizeAppError(error)
      useUiStore.getState().notifyError(appError, '加载对象结构失败')
      set((state) => ({
        selected: state.selected
          ? { ...state.selected, loading: false, error: appError.message }
          : null,
      }))
    }
  },
  clear: () => set({ selected: null }),
}))
