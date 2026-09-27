import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { validateScript } from '../src/schema.js'

describe('Jev Script schema', () => {
  it('accepts the bundled browser example', async () => {
    const script = JSON.parse(
      await readFile(new URL('../examples/local-page.json', import.meta.url), 'utf8')
    )
    await expect(validateScript(script)).resolves.toMatchObject({ valid: true })
  })

  it('rejects unknown actions and undeclared fields', async () => {
    const result = await validateScript({
      version: 1,
      name: 'bad',
      permissions: { origins: ['https://example.com'] },
      steps: [{ action: 'shell.exec', command: 'whoami' }]
    })

    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(0)
  })

  it('requires exact origins without paths', async () => {
    const result = await validateScript({
      version: 1,
      name: 'bad-origin',
      permissions: { origins: ['https://example.com/private'] },
      steps: [{ action: 'browser.goto', url: 'https://example.com/private' }]
    })

    expect(result.valid).toBe(false)
  })
})
