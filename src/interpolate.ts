import type { JsonValue } from './types.js'

const EXACT_REFERENCE = /^\$\{(input|vars)\.([^}]+)\}$/
const REFERENCE = /\$\{(input|vars)\.([^}]+)\}/g

export interface RuntimeValues {
  input: Record<string, JsonValue>
  vars: Record<string, JsonValue>
}

export function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, part) => {
    if (Array.isArray(value) && /^\d+$/.test(part)) {
      return value[Number(part)]
    }
    if (value && typeof value === 'object') {
      return (value as Record<string, unknown>)[part]
    }
    return undefined
  }, root)
}

function resolveReference(scope: RuntimeValues, namespace: string, path: string): unknown {
  return getPath(scope[namespace as keyof RuntimeValues], path)
}

export function interpolate<T>(value: T, scope: RuntimeValues): T {
  if (typeof value === 'string') {
    const exact = value.match(EXACT_REFERENCE)
    if (exact) {
      const resolved = resolveReference(scope, exact[1]!, exact[2]!)
      if (resolved === undefined) {
        throw new Error(`Unknown reference: ${value}`)
      }
      return resolved as T
    }

    return value.replace(REFERENCE, (reference, namespace: string, path: string) => {
      const resolved = resolveReference(scope, namespace, path)
      if (resolved === undefined) {
        throw new Error(`Unknown reference: ${reference}`)
      }
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved)
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, scope)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, scope)])
    ) as T
  }

  return value
}
