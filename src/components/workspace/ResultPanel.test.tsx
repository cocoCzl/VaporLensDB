import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultPanel } from '@/components/workspace/ResultPanel'

function renderPanel({ collapsed, fillAvailableSpace = false }: { collapsed: boolean; fillAvailableSpace?: boolean }) {
  return render(
    <ResultPanel
      title="Results"
      source="Connection A · db-A / schema-A · Previous result"
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
    const source = screen.getByText('Connection A · db-A / schema-A · Previous result')
    expect(source).toBeVisible()
    expect(source).not.toHaveClass('hidden')
    expect(source).toHaveAttribute('title', source.textContent)
    expect(screen.queryByText('value header')).not.toBeInTheDocument()
    expect(screen.queryByText('row value 1')).not.toBeInTheDocument()
  })

  it('renders result headers and rows in results-only view even with a persisted collapsed preference', () => {
    renderPanel({ collapsed: true, fillAvailableSpace: true })

    expect(screen.getByText('value header')).toBeInTheDocument()
    expect(screen.getByText('row value 1')).toBeInTheDocument()
  })
})
