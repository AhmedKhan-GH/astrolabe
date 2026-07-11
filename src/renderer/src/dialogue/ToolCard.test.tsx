// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ToolCard } from './ToolCard'
import type { ToolCallEntry } from './transcript'

afterEach(cleanup)

const entry = (over: Partial<ToolCallEntry> = {}): ToolCallEntry => ({
  kind: 'tool',
  toolCallId: 'tc1',
  title: 'Edit config.ts',
  toolKind: 'edit',
  status: 'in_progress',
  ...over,
})

describe('ToolCard — status glyph', () => {
  it('completed shows a check', () => {
    render(<ToolCard entry={entry({ status: 'completed' })} onOpenHub={vi.fn()} />)
    expect(screen.getByLabelText('completed')).toBeTruthy()
  })

  it('failed shows a cross', () => {
    render(<ToolCard entry={entry({ status: 'failed' })} onOpenHub={vi.fn()} />)
    expect(screen.getByLabelText('failed')).toBeTruthy()
  })

  it('in_progress shows a spinner (status role)', () => {
    render(<ToolCard entry={entry({ status: 'in_progress' })} onOpenHub={vi.fn()} />)
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

describe('ToolCard — expansion', () => {
  it('is collapsed by default and expands the command on click', () => {
    render(<ToolCard entry={entry({ command: 'npm run build' })} onOpenHub={vi.fn()} />)
    expect(screen.queryByText('npm run build')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit config/i }))
    expect(screen.getByText('npm run build')).toBeTruthy()
  })

  it('with no body the header toggle is disabled', () => {
    render(<ToolCard entry={entry({ status: 'completed' })} onOpenHub={vi.fn()} />)
    expect((screen.getByRole('button', { name: /edit config/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ToolCard — diff rendering', () => {
  it('renders old lines red and new lines green when expanded', () => {
    render(
      <ToolCard
        entry={entry({
          content: [{ type: 'diff', path: 'a.ts', oldText: 'const a = 1', newText: 'const a = 2' }],
        })}
        onOpenHub={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /edit config/i }))
    const del = screen.getByText('const a = 1').closest('[data-diff]') as HTMLElement
    const add = screen.getByText('const a = 2').closest('[data-diff]') as HTMLElement
    expect(del.getAttribute('data-diff')).toBe('del')
    expect(del.className).toMatch(/red/)
    expect(add.getAttribute('data-diff')).toBe('add')
    expect(add.className).toMatch(/emerald|green/)
  })

  it('renders terminal output when expanded', () => {
    render(
      <ToolCard
        entry={entry({ content: [{ type: 'terminal', text: 'exit code 0' }] })}
        onOpenHub={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /edit config/i }))
    expect(screen.getByText('exit code 0')).toBeTruthy()
  })
})

describe('ToolCard — hub chip', () => {
  it('a documentId surfaces a chip that opens the hub', () => {
    const onOpenHub = vi.fn()
    render(<ToolCard entry={entry({ status: 'completed', documentId: 42 })} onOpenHub={onOpenHub} />)
    fireEvent.click(screen.getByRole('button', { name: /hub/i }))
    expect(onOpenHub).toHaveBeenCalledWith(42)
  })

  it('no documentId → no hub chip', () => {
    render(<ToolCard entry={entry({ status: 'completed' })} onOpenHub={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /hub/i })).toBeNull()
  })
})
