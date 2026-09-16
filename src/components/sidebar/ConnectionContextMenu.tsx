import type { TFunction } from 'i18next'
import { ContextMenu, type ContextMenuAction } from '@/components/explorer/ContextMenu'
import type { ConnectionConfig, ConnectionRuntimeStatus } from '@/types/connection'

interface ConnectionContextMenuProps {
  context: { connection: ConnectionConfig; x: number; y: number } | null
  status: ConnectionRuntimeStatus
  busy: boolean
  favorite: boolean
  t: TFunction
  onClose: () => void
  onConnect: (connection: ConnectionConfig) => void
  onDisconnect: (connection: ConnectionConfig) => void
  onNewQuery: (connection: ConnectionConfig) => void
  onRefresh: (connection: ConnectionConfig) => void
  onEdit: (connection: ConnectionConfig) => void
  onRename: (connection: ConnectionConfig) => void
  onDuplicate: (connection: ConnectionConfig) => void
  onMove: (connection: ConnectionConfig) => void
  onToggleFavorite: (connection: ConnectionConfig) => void
  onDelete: (connection: ConnectionConfig) => void
}

export function ConnectionContextMenu({
  context,
  status,
  busy,
  favorite,
  t,
  onClose,
  onConnect,
  onDisconnect,
  onNewQuery,
  onRefresh,
  onEdit,
  onRename,
  onDuplicate,
  onMove,
  onToggleFavorite,
  onDelete,
}: ConnectionContextMenuProps) {
  if (!context) return null
  const { connection, x, y } = context
  const connected = status === 'connected'
  const actions: ContextMenuAction[] = [
    {
      id: connected ? 'disconnect' : 'connect',
      label: connected ? t('connection.disconnect') : t('connection.connect'),
      icon: connected ? 'disconnect' : 'connect',
      disabled: busy,
      onSelect: () => connected ? onDisconnect(connection) : onConnect(connection),
    },
    { id: 'new-query', label: t('workbench.newSql'), icon: 'data', onSelect: () => onNewQuery(connection) },
    { id: 'refresh', label: t('common.refresh'), icon: 'refresh', onSelect: () => onRefresh(connection) },
    { id: 'edit', label: t('connection.edit'), icon: 'edit', separatorBefore: true, onSelect: () => onEdit(connection) },
    { id: 'rename', label: t('connection.rename'), icon: 'rename', onSelect: () => onRename(connection) },
    { id: 'duplicate', label: t('common.copy'), icon: 'duplicate', onSelect: () => onDuplicate(connection) },
    { id: 'move', label: t('connection.moveToGroup'), icon: 'move', onSelect: () => onMove(connection) },
    {
      id: 'favorite',
      label: favorite ? t('connection.unfavorite') : t('connection.favorite'),
      icon: 'favorite',
      onSelect: () => onToggleFavorite(connection),
    },
    {
      id: 'delete',
      label: t('common.delete'),
      icon: 'delete',
      tone: 'danger',
      separatorBefore: true,
      onSelect: () => onDelete(connection),
    },
  ]

  return <ContextMenu x={x} y={y} actions={actions} onClose={onClose} />
}
