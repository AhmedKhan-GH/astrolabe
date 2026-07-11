// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ThoughtBlock } from './ThoughtBlock'

afterEach(cleanup)

describe('ThoughtBlock', () => {
  it('is collapsed by default (text hidden) and shows a "thinking" affordance', () => {
    render(<ThoughtBlock entry={{ kind: 'thought', text: 'weighing the options' }} />)
    expect(screen.getByText(/thinking/i)).toBeTruthy()
    expect(screen.queryByText('weighing the options')).toBeNull()
  })

  it('expands to reveal the thought text on click', () => {
    render(<ThoughtBlock entry={{ kind: 'thought', text: 'weighing the options' }} />)
    fireEvent.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getByText('weighing the options')).toBeTruthy()
  })
})
