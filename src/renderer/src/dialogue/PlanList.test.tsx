// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PlanList } from './PlanList'

afterEach(cleanup)

describe('PlanList', () => {
  it('renders a checklist row per entry with a status mark', () => {
    render(
      <PlanList
        entries={[
          { content: 'gather sources', status: 'completed' },
          { content: 'draft answer', status: 'in_progress' },
          { content: 'cite', status: 'pending' },
        ]}
      />,
    )
    expect(screen.getByText('gather sources')).toBeTruthy()
    expect(screen.getByLabelText('completed')).toBeTruthy()
    expect(screen.getByLabelText('in_progress')).toBeTruthy()
    expect(screen.getByLabelText('pending')).toBeTruthy()
  })

  it('renders nothing for an empty plan', () => {
    const { container } = render(<PlanList entries={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
