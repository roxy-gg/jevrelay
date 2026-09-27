import { z } from 'zod'
import type { DecisionProvider, DecisionRequest, DecisionResponse, JsonValue } from './types.js'

interface ProviderEnvironment {
  [key: string]: string | undefined
}

const typeSafeResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.object({
    decision: z.object({
      choice: z.string(),
      confidence: z.number(),
      probabilities: z.record(z.string(), z.number()).optional()
    })
  }),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional()
    })
    .optional()
})

const openRouterResponseSchema = z.object({
  model: z.string().optional(),
  choices: z.array(
    z.object({
      message: z.object({ content: z.string().nullable() })
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      cost: z.number().optional()
    })
    .optional()
})

const structuredDecisionSchema = z.object({
  choice: z.string(),
  confidence: z.number()
})

const jevRelayResponseSchema = structuredDecisionSchema.extend({
  probabilities: z.record(z.string(), z.number()).optional(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cost: z.number().optional()
    })
    .optional(),
  model: z.string().optional()
})

function assertRequestSize(request: DecisionRequest): void {
  const bytes = Buffer.byteLength(JSON.stringify(request), 'utf8')
  if (bytes > 256 * 1024) {
    throw new Error(`Decision request is too large: ${bytes} bytes (maximum 262144)`)
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text()
  if (!text) return `${response.status} ${response.statusText}`

  try {
    const value = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return value.error?.message ?? value.message ?? text
  } catch {
    return text
  }
}

function ensureChoice(choice: unknown, options: Record<string, string | null>): string {
  if (typeof choice !== 'string' || !(choice in options)) {
    throw new Error(`Provider returned an unknown choice: ${String(choice)}`)
  }
  return choice
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

export class TypeSafeProvider implements DecisionProvider {
  readonly name = 'typesafe'

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://api.typesafe.ai/v1/systemone'
  ) {}

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    assertRequestSize(request)
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: request.state,
        model: 'jev-latest',
        questions: {
          decision: {
            type: 'choice',
            instructions: request.question,
            criteria: request.options
          }
        }
      }),
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      throw new Error(`TypeSafe request failed: ${await readError(response)}`)
    }

    const body = typeSafeResponseSchema.parse(await response.json())
    const answer = body.answers.decision
    const choice = ensureChoice(answer.choice, request.options)

    return {
      choice,
      confidence: clampConfidence(answer?.confidence),
      ...(answer?.probabilities ? { probabilities: answer.probabilities } : {}),
      ...(body.model ? { model: body.model } : {}),
      usage: {
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0
      }
    }
  }
}

export class OpenRouterProvider implements DecisionProvider {
  readonly name = 'openrouter'

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  ) {}

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    assertRequestSize(request)
    const choices = Object.keys(request.options)
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jevrelay.com',
        'X-OpenRouter-Title': 'JevRelay'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'Make one bounded decision. Return only the requested structured result. Confidence must be between 0 and 1.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              state: request.state,
              question: request.question,
              options: request.options
            })
          }
        ],
        temperature: 0,
        provider: { require_parameters: true },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'jevrelay_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['choice', 'confidence'],
              properties: {
                choice: { type: 'string', enum: choices },
                confidence: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        }
      }),
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${await readError(response)}`)
    }

    const body = openRouterResponseSchema.parse(await response.json())
    const content = body.choices[0]?.message.content
    if (!content) throw new Error('OpenRouter returned no decision content')

    const decision = structuredDecisionSchema.parse(JSON.parse(content))
    return {
      choice: ensureChoice(decision.choice, request.options),
      confidence: clampConfidence(decision.confidence),
      ...(body.model ? { model: body.model } : {}),
      usage: {
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        cost: body.usage?.cost ?? 0
      }
    }
  }
}

export class JevRelayProvider implements DecisionProvider {
  readonly name = 'jevrelay'

  constructor(
    private readonly apiKey: string,
    private readonly endpoint = 'https://api.jevrelay.com/v1/decide'
  ) {}

  async decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse> {
    assertRequestSize(request)
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      ...(signal ? { signal } : {})
    })

    if (!response.ok) {
      throw new Error(`JevRelay request failed: ${await readError(response)}`)
    }

    const body = jevRelayResponseSchema.parse(await response.json())

    return {
      choice: ensureChoice(body.choice, request.options),
      confidence: clampConfidence(body.confidence),
      ...(body.probabilities ? { probabilities: body.probabilities } : {}),
      ...(body.usage
        ? {
            usage: {
              inputTokens: body.usage.inputTokens ?? 0,
              outputTokens: body.usage.outputTokens ?? 0,
              cost: body.usage.cost ?? 0
            }
          }
        : {}),
      ...(body.model ? { model: body.model } : {})
    }
  }
}

function requireKey(env: ProviderEnvironment, name: string): string {
  const value = env[name]
  if (!value) {
    throw new Error(`${name} is required for the selected inference provider`)
  }
  return value
}

export function createProvider(
  env: ProviderEnvironment = process.env
): DecisionProvider | undefined {
  const provider = env.JEVRELAY_PROVIDER?.toLowerCase()
  if (!provider) return undefined

  if (provider === 'typesafe') {
    return new TypeSafeProvider(
      requireKey(env, 'TYPESAFE_API_KEY'),
      env.TYPESAFE_API_URL ?? 'https://api.typesafe.ai/v1/systemone'
    )
  }

  if (provider === 'openrouter') {
    return new OpenRouterProvider(
      requireKey(env, 'OPENROUTER_API_KEY'),
      env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
      env.OPENROUTER_API_URL ?? 'https://openrouter.ai/api/v1/chat/completions'
    )
  }

  if (provider === 'jevrelay') {
    return new JevRelayProvider(
      requireKey(env, 'JEVRELAY_API_KEY'),
      env.JEVRELAY_API_URL ?? 'https://api.jevrelay.com/v1/decide'
    )
  }

  throw new Error(`Unknown JEVRELAY_PROVIDER: ${provider}`)
}

export function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}
