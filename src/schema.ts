import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import type { Ajv2020 as Ajv2020Type } from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js'
import type { JevScript } from './types.js'

const require = createRequire(import.meta.url)
const Ajv2020 = require('ajv/dist/2020').default as typeof Ajv2020Type

let validatorPromise: Promise<ValidateFunction<JevScript>> | undefined

async function loadValidator(): Promise<ValidateFunction<JevScript>> {
  if (!validatorPromise) {
    validatorPromise = (async () => {
      const schemaUrl = new URL('../schema/jev-script-v1.schema.json', import.meta.url)
      const schema = JSON.parse(await readFile(fileURLToPath(schemaUrl), 'utf8')) as object
      const ajv = new Ajv2020({ allErrors: true, strict: true })
      return ajv.compile<JevScript>(schema)
    })()
  }

  return validatorPromise
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || '/'
    return `${path} ${error.message ?? 'is invalid'}`
  })
}

export async function validateScript(
  value: unknown
): Promise<{ valid: true; script: JevScript } | { valid: false; errors: string[] }> {
  const validator = await loadValidator()
  if (validator(value)) {
    return { valid: true, script: value }
  }

  return { valid: false, errors: formatErrors(validator.errors) }
}

export async function parseScript(value: unknown): Promise<JevScript> {
  const result = await validateScript(value)
  if (!result.valid) {
    throw new ScriptValidationError(result.errors)
  }

  return result.script
}

export class ScriptValidationError extends Error {
  readonly errors: string[]

  constructor(errors: string[]) {
    super(`Invalid Jev Script: ${errors.join('; ')}`)
    this.name = 'ScriptValidationError'
    this.errors = errors
  }
}
