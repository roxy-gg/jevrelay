import { describe, expect, it, vi } from 'vitest'
import type { ActionAdapter } from '../src/browser.js'
import { RunManager } from '../src/runtime.js'
import type { BrowserActionStep, DecisionProvider, JsonValue, JevScript } from '../src/types.js'

class FakeAdapter implements ActionAdapter {
  readonly steps: BrowserActionStep[] = []
  closed = false

  async execute(step: BrowserActionStep, signal: AbortSignal): Promise<JsonValue | undefined> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    this.steps.push(step)
    if (step.action === 'browser.extract') {
      return [
        { href: 'https://example.com/a', text: 'A' },
        { href: 'https://example.com/b', text: 'B' }
      ]
    }
    return undefined
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function script(): JevScript {
  return {
    version: 1,
    name: 'test',
    permissions: { origins: ['https://example.com'] },
    inputs: { query: 'default' },
    steps: [
      { action: 'browser.goto', url: 'https://example.com' },
      {
        action: 'browser.extract',
        target: { selector: 'a' },
        fields: ['href', 'text'],
        saveAs: 'links'
      },
      {
        decide: {
          state: '${vars.links}',
          question: 'Choose a link',
          optionsFrom: 'links.href',
          minimumConfidence: 0.7,
          saveAs: 'link'
        }
      },
      { action: 'browser.goto', url: '${vars.link}' }
    ]
  }
}

describe('RunManager', () => {
  it('runs local actions and a bounded decision', async () => {
    const adapter = new FakeAdapter()
    const provider: DecisionProvider = {
      name: 'fake',
      decide: vi.fn().mockResolvedValue({
        choice: 'https://example.com/b',
        confidence: 0.9,
        usage: { inputTokens: 4, outputTokens: 1 }
      })
    }
    const manager = new RunManager(provider, () => adapter)

    const started = await manager.start(script())
    const result = await manager.wait(started.runId)

    expect(result.status).toBe('completed')
    expect(result.output?.link).toBe('https://example.com/b')
    expect(result.usage).toMatchObject({ localActions: 3, decisions: 1, inputTokens: 4 })
    expect(adapter.steps.at(-1)).toEqual({
      action: 'browser.goto',
      url: 'https://example.com/b'
    })
    expect(adapter.closed).toBe(true)
  })

  it('stops before acting on a low-confidence decision', async () => {
    const adapter = new FakeAdapter()
    const provider: DecisionProvider = {
      name: 'fake',
      decide: vi.fn().mockResolvedValue({
        choice: 'https://example.com/a',
        confidence: 0.2
      })
    }
    const manager = new RunManager(provider, () => adapter)

    const started = await manager.start(script())
    const result = await manager.wait(started.runId)

    expect(result.status).toBe('needs_input')
    expect(result.error?.code).toBe('low_confidence')
    expect(adapter.steps).toHaveLength(2)
  })

  it('runs scripts without decisions and without a provider', async () => {
    const adapter = new FakeAdapter()
    const manager = new RunManager(undefined, () => adapter)
    const localScript: JevScript = {
      version: 1,
      name: 'local',
      permissions: { origins: ['https://example.com'] },
      steps: [{ action: 'browser.goto', url: 'https://example.com' }]
    }

    const started = await manager.start(localScript)
    await expect(manager.wait(started.runId)).resolves.toMatchObject({ status: 'completed' })
  })

  it('cancels a background run', async () => {
    let release: (() => void) | undefined
    const adapter: ActionAdapter = {
      execute: vi.fn(async (_step, signal) => {
        await new Promise<void>((resolve, reject) => {
          release = resolve
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
        })
        return undefined
      }),
      close: vi.fn(async () => undefined)
    }
    const manager = new RunManager(undefined, () => adapter)
    const localScript: JevScript = {
      version: 1,
      name: 'cancel',
      permissions: { origins: ['https://example.com'] },
      steps: [{ action: 'browser.goto', url: 'https://example.com' }]
    }

    const started = await manager.start(localScript)
    manager.stop(started.runId)
    const result = await manager.wait(started.runId)
    release?.()

    expect(result.status).toBe('stopped')
    expect(result.error?.code).toBe('stopped')
  })
})
