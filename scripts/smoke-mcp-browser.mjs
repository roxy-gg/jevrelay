import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const web = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>MCP Browser Smoke</title><h1>MCP browser works</h1>')
})
await new Promise((resolve, reject) => {
  web.once('error', reject)
  web.listen(0, '127.0.0.1', resolve)
})

const address = web.address()
if (!address || typeof address === 'string') throw new Error('Could not resolve smoke port')
const origin = `http://127.0.0.1:${address.port}`
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js'],
  stderr: 'pipe'
})
const client = new Client({ name: 'jevrelay-browser-smoke', version: '0.1.0' })

try {
  await client.connect(transport)
  const result = await client.callTool({
    name: 'jevrelay_run',
    arguments: {
      script: {
        version: 1,
        name: 'mcp-browser-smoke',
        permissions: { origins: [origin] },
        steps: [
          { action: 'browser.goto', url: origin },
          {
            action: 'browser.extract',
            target: { role: 'heading', name: 'MCP browser works' },
            fields: ['text'],
            saveAs: 'heading'
          }
        ]
      }
    }
  })
  const output = result.structuredContent
  if (result.isError || output?.status !== 'completed') {
    throw new Error(`MCP browser smoke failed: ${JSON.stringify(result)}`)
  }
  if (output.output?.heading?.[0]?.text !== 'MCP browser works') {
    throw new Error(`Unexpected MCP extraction: ${JSON.stringify(output)}`)
  }
  process.stdout.write('MCP browser smoke passed\n')
} finally {
  await client.close()
  await new Promise((resolve) => web.close(resolve))
}
