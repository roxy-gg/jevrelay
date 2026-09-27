import { createServer } from 'node:http'
import { RunManager } from '../dist/runtime.js'

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><title>JevRelay Smoke</title><h1>JevRelay works</h1>')
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not resolve smoke port')
  const origin = `http://127.0.0.1:${address.port}`
  const manager = new RunManager()
  const started = await manager.start({
    version: 1,
    name: 'browser-smoke',
    permissions: { origins: [origin] },
    steps: [
      { action: 'browser.goto', url: origin },
      {
        action: 'browser.assert',
        target: { role: 'heading', name: 'JevRelay works' },
        state: 'visible'
      },
      {
        action: 'browser.extract',
        target: { role: 'heading', name: 'JevRelay works' },
        fields: ['text'],
        saveAs: 'heading'
      }
    ]
  })
  const result = await manager.wait(started.runId)
  if (result.status !== 'completed') {
    throw new Error(`Browser smoke failed: ${JSON.stringify(result)}`)
  }
  if (result.output?.heading?.[0]?.text !== 'JevRelay works') {
    throw new Error(`Unexpected extraction: ${JSON.stringify(result.output)}`)
  }
  process.stdout.write('Browser smoke passed\n')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
