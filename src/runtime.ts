import { randomUUID } from 'node:crypto'
import { PlaywrightAdapter, type ActionAdapter } from './browser.js'
import { getPath, interpolate, type RuntimeValues } from './interpolate.js'
import { asJsonValue } from './providers.js'
import { parseScript } from './schema.js'
import type {
  BrowserActionStep,
  DecisionProvider,
  DecisionRequest,
  JevScript,
  JsonValue,
  RunResult,
  RunUsage
} from './types.js'

interface StartOptions {
  inputs?: Record<string, JsonValue>
  headless?: boolean
}

interface ManagedRun {
  result: RunResult
  controller: AbortController
  promise: Promise<RunResult>
}

export type AdapterFactory = (origins: string[], headless: boolean) => ActionAdapter

function newUsage(): RunUsage {
  return { localActions: 0, decisions: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
}

function copyResult(result: RunResult): RunResult {
  return structuredClone(result)
}

function decisionOptions(
  direct: Record<string, string | null> | undefined,
  optionsFrom: string | undefined,
  vars: Record<string, JsonValue>
): Record<string, string | null> {
  if (direct) return direct
  if (!optionsFrom) throw new Error('Decision requires options or optionsFrom')

  const [rootKey, ...itemPath] = optionsFrom.split('.')
  const source = vars[rootKey!]
  if (!Array.isArray(source)) {
    throw new Error(`optionsFrom must reference an array: ${optionsFrom}`)
  }

  const options: Record<string, string | null> = {}
  for (const item of source) {
    const value = itemPath.length === 0 ? item : getPath(item, itemPath.join('.'))
    if (typeof value !== 'string' && typeof value !== 'number') continue

    let description: string | null = null
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const record = item as Record<string, JsonValue>
      const candidate = record.title ?? record.text ?? record.name
      if (typeof candidate === 'string') description = candidate
    }
    options[String(value)] = description
  }

  if (Object.keys(options).length < 2) {
    throw new Error(`optionsFrom produced fewer than two choices: ${optionsFrom}`)
  }
  return options
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'stopped'
  if (error instanceof Error && error.message.includes('confidence')) return 'low_confidence'
  return 'run_failed'
}

export class RunManager {
  private readonly runs = new Map<string, ManagedRun>()

  constructor(
    private readonly provider: DecisionProvider | undefined,
    private readonly adapterFactory: AdapterFactory = (origins, headless) =>
      new PlaywrightAdapter(origins, headless),
    private readonly maxRuns = 100
  ) {}

  async start(scriptValue: unknown, options: StartOptions = {}): Promise<RunResult> {
    this.pruneRuns()
    if (this.runs.size >= this.maxRuns) {
      throw new Error(`Too many active runs; maximum is ${this.maxRuns}`)
    }

    const script = await parseScript(scriptValue)
    const runId = randomUUID()
    const controller = new AbortController()
    const result: RunResult = {
      runId,
      script: script.name,
      status: 'running',
      startedAt: new Date().toISOString(),
      currentStep: 0,
      totalSteps: script.steps.length,
      usage: newUsage()
    }

    const managed = {} as ManagedRun
    managed.result = result
    managed.controller = controller
    managed.promise = this.execute(script, result, controller.signal, options)
    this.runs.set(runId, managed)
    void managed.promise.catch(() => undefined)

    return copyResult(result)
  }

  async wait(runId: string): Promise<RunResult> {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    return copyResult(await run.promise)
  }

  status(runId: string): RunResult {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    return copyResult(run.result)
  }

  stop(runId: string): RunResult {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`Unknown run: ${runId}`)
    if (run.result.status === 'running') run.controller.abort()
    return copyResult(run.result)
  }

  private pruneRuns(): void {
    for (const [runId, run] of this.runs) {
      if (this.runs.size < this.maxRuns) break
      if (run.result.status !== 'running') this.runs.delete(runId)
    }
  }

  private async execute(
    script: JevScript,
    result: RunResult,
    signal: AbortSignal,
    options: StartOptions
  ): Promise<RunResult> {
    const adapter = this.adapterFactory(script.permissions.origins, options.headless ?? true)
    const closeOnAbort = (): void => {
      void adapter.close()
    }
    signal.addEventListener('abort', closeOnAbort, { once: true })

    const scope: RuntimeValues = {
      input: { ...(script.inputs ?? {}), ...(options.inputs ?? {}) },
      vars: {}
    }

    try {
      for (let index = 0; index < script.steps.length; index += 1) {
        if (signal.aborted) {
          const error = new Error('Run stopped')
          error.name = 'AbortError'
          throw error
        }

        result.currentStep = index + 1
        const step = interpolate(script.steps[index]!, scope)

        if ('decide' in step) {
          if (!this.provider) {
            throw new Error(
              'This script requires inference. Set JEVRELAY_PROVIDER and the provider API key.'
            )
          }

          const optionsMap = decisionOptions(
            step.decide.options,
            step.decide.optionsFrom,
            scope.vars
          )
          const request: DecisionRequest = {
            state: asJsonValue(step.decide.state),
            question: step.decide.question,
            options: optionsMap
          }
          const decision = await this.provider.decide(request, signal)
          result.usage.decisions += 1
          result.usage.inputTokens += decision.usage?.inputTokens ?? 0
          result.usage.outputTokens += decision.usage?.outputTokens ?? 0
          result.usage.cost += decision.usage?.cost ?? 0

          if (decision.confidence < (step.decide.minimumConfidence ?? 0)) {
            result.status = 'needs_input'
            result.error = {
              step: index + 1,
              code: 'low_confidence',
              message: `Decision confidence ${decision.confidence.toFixed(3)} is below the required threshold ${(step.decide.minimumConfidence ?? 0).toFixed(3)}`
            }
            break
          }

          scope.vars[step.decide.saveAs] = decision.choice
          continue
        }

        const action = step as BrowserActionStep
        const value = await adapter.execute(action, signal)
        result.usage.localActions += 1
        if ('saveAs' in action && action.saveAs && value !== undefined) {
          scope.vars[action.saveAs] = value
        }
      }

      if (result.status === 'running') {
        result.status = 'completed'
      }
      result.output = scope.vars
    } catch (error) {
      result.status = signal.aborted ? 'stopped' : 'failed'
      result.error = {
        step: result.currentStep,
        code: errorCode(error),
        message: error instanceof Error ? error.message : String(error)
      }
      result.output = scope.vars
    } finally {
      signal.removeEventListener('abort', closeOnAbort)
      await adapter.close()
      result.finishedAt = new Date().toISOString()
    }

    return result
  }
}
