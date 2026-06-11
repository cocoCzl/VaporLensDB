import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

export interface RelationEdgeData extends Record<string, unknown> {
  label: string
}

export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const relation = data as RelationEdgeData | undefined

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        className="stroke-primary/70"
        style={{ strokeWidth: 1.6 }}
      />
      {relation?.label && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute max-w-56 -translate-x-1/2 -translate-y-1/2 truncate rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm"
            style={{ left: labelX, top: labelY }}
          >
            {relation.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
