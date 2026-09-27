import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProvider, OpenRouterProvider, TypeSafeProvider } from '../src/providers.js'

const request = {
  state: { items: ['a', 'b'] },
  question: 'Choose one',
  options: { a: null, b: null }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('providers', () => {
  it('maps a TypeSafe choice response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'jev-test',
          answers: {
            decision: {
              choice: 'b',
              confidence: 0.9,
              probabilities: { a: 0.1, b: 0.9 }
            }
          },
          usage: { input_tokens: 12, output_tokens: 3 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new TypeSafeProvider('secret').decide(request)
    expect(result).toMatchObject({
      choice: 'b',
      confidence: 0.9,
      usage: { inputTokens: 12, outputTokens: 3 }
    })
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret'
    })
  })

  it('uses strict structured output with OpenRouter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'test/model',
          choices: [{ message: { content: JSON.stringify({ choice: 'a', confidence: 0.8 }) } }],
          usage: { prompt_tokens: 9, completion_tokens: 2, cost: 0.001 }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await new OpenRouterProvider('secret', 'test/model').decide(request)
    expect(result.choice).toBe('a')

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema.properties.choice.enum).toEqual(['a', 'b'])
  })

  it('requires only the selected provider key', () => {
    expect(createProvider({})).toBeUndefined()
    expect(() => createProvider({ JEVRELAY_PROVIDER: 'typesafe' })).toThrow('TYPESAFE_API_KEY')
    expect(
      createProvider({ JEVRELAY_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'key' })?.name
    ).toBe('openrouter')
  })
})
