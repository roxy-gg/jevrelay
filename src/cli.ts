#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import { createProvider } from './providers.js'
import { startStdioServer } from './server.js'

const require = createRequire(import.meta.url)

function help(): void {
  process.stdout.write(
    `JevRelay MCP\n\nUsage:\n  jevrelay-mcp\n  jevrelay-mcp doctor\n  jevrelay-mcp install-browser\n\nEnvironment:\n  JEVRELAY_PROVIDER=typesafe|openrouter|jevrelay\n  TYPESAFE_API_KEY=...\n  OPENROUTER_API_KEY=...\n  OPENROUTER_MODEL=openai/gpt-4o-mini\n  JEVRELAY_API_KEY=...\n`
  )
}

async function doctor(): Promise<void> {
  const provider = createProvider(process.env)
  let browser = 'missing'
  try {
    const instance = await chromium.launch({ headless: true })
    await instance.close()
    browser = 'ready'
  } catch {
    browser = 'missing; run jevrelay-mcp install-browser'
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        node: process.version,
        browser,
        provider: provider?.name ?? 'none (scripts without decide steps still work)'
      },
      null,
      2
    )}\n`
  )
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === '--help' || command === '-h' || command === 'help') {
    help()
    return
  }
  if (command === 'doctor') {
    await doctor()
    return
  }
  if (command === 'install-browser') {
    const cli = require.resolve('playwright/cli')
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' })
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (value) => resolve(value ?? 1))
    })
    if (code !== 0) process.exitCode = code
    return
  }
  if (command) {
    throw new Error(`Unknown command: ${command}`)
  }

  await startStdioServer()
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
