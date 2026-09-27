import { describe, expect, it } from 'vitest'
import { interpolate } from '../src/interpolate.js'

const scope = {
  input: { query: 'Roxy', count: 3 },
  vars: { videos: [{ href: 'https://example.com/one' }] }
}

describe('interpolate', () => {
  it('preserves the type of an exact reference', () => {
    expect(interpolate('${vars.videos}', scope)).toEqual([{ href: 'https://example.com/one' }])
  })

  it('interpolates references inside strings', () => {
    expect(interpolate('Search for ${input.query} (${input.count})', scope)).toBe(
      'Search for Roxy (3)'
    )
  })

  it('fails on unknown references', () => {
    expect(() => interpolate('${vars.missing}', scope)).toThrow('Unknown reference')
  })
})
