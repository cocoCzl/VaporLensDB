import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultPanel } from '@/components/workspace/ResultPanel'

function renderPanel({ collapsed, fillAvailableSpace = false }: { collapsed: boolean; fillAvailableSpace?: boolean }) {
  return render(
    <ResultPanel
      title="Results"
      actions={<button type="button">Action</button>}
      collapsed={collapsed}
      fillAvailableSpace={fillAvailableSpace}
      height={320}
    >
      <div>value header</div>
      <div>row value 1</div>
    </ResultPanel>,
  )
}

describe('ResultPanel visibility contract', () => {
  it('hides result content when the split-view panel is collapsed', () => {
    renderPanel({ collapsed: true })

    expect(screen.getByText('Results')).toBeInTheDocument()
    expect(screen.queryByText('value header')).not.toBeInTheDocument()
    expect(screen.queryByText('row value 1')).not.toBeInTheDocument()
  })

  it('renders result headers and rows in results-only view even with a persisted collapsed preference', () => {
    renderPanel({ collapsed: true, fillAvailableSpace: true })

    expect(screen.getByText('value header')).toBeInTheDocument()
    expect(screen.getByText('row value 1')).toBeInTheDocument()
  })
})
