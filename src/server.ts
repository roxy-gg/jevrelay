import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createProvider } from './providers.js'
import { RunManager } from './runtime.js'
import { validateScript } from './schema.js'
import type { JsonValue, RunResult } from './types.js'

function toolResult(value: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
    ...(isError ? { isError: true } : {})
  }
}

function failure(error: unknown) {
  return toolResult(
    {
      error: error instanceof Error ? error.message : String(error)
    },
    true
  )
}

export function createServer(env: NodeJS.ProcessEnv = process.env): McpServer {
  const provider = createProvider(env)
  const runs = new RunManager(provider)
  const server = new McpServer({ name: 'jevrelay', version: '0.1.0' })

  server.registerTool(
    'jevrelay_validate',
    {
      title: 'Validate Jev Script',
      description: 'Validate a declarative Jev Script without executing it.',
      inputSchema: {
        script: z.unknown().describe('The Jev Script JSON object to validate')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ script }) => {
      const result = await validateScript(script)
      return toolResult(result)
    }
  )

  server.registerTool(
    'jevrelay_run',
    {
      title: 'Run Jev Script',
      description:
        'Validate and execute a Jev Script locally with Playwright. Inference is used only for explicit decide steps.',
      inputSchema: {
        script: z.unknown().describe('The declarative Jev Script JSON object'),
        inputs: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Values overriding script inputs'),
        headless: z.boolean().optional().default(true).describe('Run the browser without a window'),
        wait: z.boolean().optional().default(true).describe('Wait for completion before returning')
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true }
    },
    async ({ script, inputs, headless, wait }, extra) => {
      try {
        const started = await runs.start(script, {
          ...(inputs ? { inputs: inputs as Record<string, JsonValue> } : {}),
          headless
        })
        if (!wait) return toolResult(started)

        const stopOnCancel = (): void => {
          runs.stop(started.runId)
        }
        if (extra.signal.aborted) stopOnCancel()
        extra.signal.addEventListener('abort', stopOnCancel, { once: true })
        try {
          return toolResult(await runs.wait(started.runId))
        } finally {
          extra.signal.removeEventListener('abort', stopOnCancel)
        }
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'jevrelay_status',
    {
      title: 'Get JevRelay Run Status',
      description: 'Return the current status and partial output of a JevRelay run.',
      inputSchema: { runId: z.string().uuid() },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async ({ runId }) => {
      try {
        return toolResult(runs.status(runId))
      } catch (error) {
        return failure(error)
      }
    }
  )

  server.registerTool(
    'jevrelay_stop',
    {
      title: 'Stop JevRelay Run',
      description: 'Request cancellation of a running JevRelay automation.',
      inputSchema: { runId: z.string().uuid() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
    },
    async ({ runId }) => {
      try {
        const result: RunResult = runs.stop(runId)
        return toolResult(result)
      } catch (error) {
        return failure(error)
      }
    }
  )

  return server
}

export async function startStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const server = createServer(env)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
