export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type BrowserTarget =
  | { selector: string }
  | { role: string; name?: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { id: string }

export type BrowserActionStep =
  | { action: 'browser.goto'; url: string }
  | { action: 'browser.fill'; target: BrowserTarget; value: string }
  | { action: 'browser.press'; target: BrowserTarget; key: string }
  | { action: 'browser.click'; target: BrowserTarget }
  | {
      action: 'browser.wait'
      target?: BrowserTarget
      state?: 'visible' | 'hidden' | 'attached' | 'detached'
      milliseconds?: number
      timeout?: number
    }
  | {
      action: 'browser.extract'
      target: BrowserTarget
      fields: string[]
      limit?: number
      saveAs: string
    }
  | {
      action: 'browser.assert'
      target: BrowserTarget
      state: 'visible' | 'hidden' | 'attached' | 'playing'
      timeout?: number
    }

export interface DecisionStep {
  decide: {
    state: JsonValue
    question: string
    options?: Record<string, string | null>
    optionsFrom?: string
    minimumConfidence?: number
    saveAs: string
  }
}

export type JevStep = BrowserActionStep | DecisionStep

export interface JevScript {
  version: 1
  name: string
  permissions: {
    origins: string[]
  }
  inputs?: Record<string, JsonValue>
  steps: JevStep[]
}

export interface DecisionRequest {
  state: JsonValue
  question: string
  options: Record<string, string | null>
}

export interface DecisionResponse {
  choice: string
  confidence: number
  probabilities?: Record<string, number>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    cost?: number
  }
  model?: string
}

export interface DecisionProvider {
  readonly name: string
  decide(request: DecisionRequest, signal?: AbortSignal): Promise<DecisionResponse>
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'needs_input'

export interface RunUsage {
  localActions: number
  decisions: number
  inputTokens: number
  outputTokens: number
  cost: number
}

export interface RunResult {
  runId: string
  script: string
  status: RunStatus
  startedAt: string
  finishedAt?: string
  currentStep: number
  totalSteps: number
  output?: Record<string, JsonValue>
  error?: {
    step: number
    code: string
    message: string
  }
  usage: RunUsage
}
