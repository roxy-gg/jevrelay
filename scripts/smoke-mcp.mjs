import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/cli.js'],
  stderr: 'pipe'
})
const client = new Client({ name: 'jevrelay-smoke', version: '0.1.0' })

try {
  await client.connect(transport)
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name).sort()
  const expected = ['jevrelay_run', 'jevrelay_status', 'jevrelay_stop', 'jevrelay_validate']
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Unexpected tools: ${names.join(', ')}`)
  }

  const result = await client.callTool({
    name: 'jevrelay_validate',
    arguments: {
      script: {
        version: 1,
        name: 'smoke',
        permissions: { origins: ['https://example.com'] },
        steps: [{ action: 'browser.goto', url: 'https://example.com' }]
      }
    }
  })
  if (result.isError) throw new Error('Validation tool returned an error')
  process.stdout.write('MCP smoke passed\n')
} finally {
  await client.close()
}
