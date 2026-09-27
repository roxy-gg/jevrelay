import { createServer } from 'node:http'
import { RunManager } from '../dist/runtime.js'

const target = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end('<h1>This origin is not allowed</h1>')
})
await new Promise((resolve, reject) => {
  target.once('error', reject)
  target.listen(0, '127.0.0.1', resolve)
})
const targetAddress = target.address()
if (!targetAddress || typeof targetAddress === 'string') throw new Error('Missing target port')

const source = createServer((_request, response) => {
  response.writeHead(302, {
    Location: `http://127.0.0.1:${targetAddress.port}`
  })
  response.end()
})
await new Promise((resolve, reject) => {
  source.once('error', reject)
  source.listen(0, '127.0.0.1', resolve)
})
const sourceAddress = source.address()
if (!sourceAddress || typeof sourceAddress === 'string') throw new Error('Missing source port')
const sourceOrigin = `http://127.0.0.1:${sourceAddress.port}`

try {
  const manager = new RunManager()
  const started = await manager.start({
    version: 1,
    name: 'blocked-redirect',
    permissions: { origins: [sourceOrigin] },
    steps: [{ action: 'browser.goto', url: sourceOrigin }]
  })
  const result = await manager.wait(started.runId)
  if (result.status !== 'failed') {
    throw new Error(`Undeclared redirect was not blocked: ${JSON.stringify(result)}`)
  }
  process.stdout.write('Origin redirect smoke passed\n')
} finally {
  await new Promise((resolve) => source.close(resolve))
  await new Promise((resolve) => target.close(resolve))
}
