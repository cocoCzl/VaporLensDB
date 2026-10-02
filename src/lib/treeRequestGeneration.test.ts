import { describe, expect, it } from 'vitest'
import { TreeRequestGeneration } from '@/lib/treeRequestGeneration'

describe('tree request generation', () => {
  it('rejects an old connection root after a view switch', () => {
    const generation = new TreeRequestGeneration()
    const oldRequest = generation.begin('root', 'connection-a')
    generation.invalidateView()
    const newRequest = generation.begin('root', 'connection-b')
    expect(generation.isCurrent(newRequest, 'connection-b')).toBe(true)
    expect(generation.isCurrent(oldRequest, 'connection-a')).toBe(false)
  })

  it('keeps different nodes concurrent but makes same-node refresh latest-wins', () => {
    const generation = new TreeRequestGeneration()
    const firstSchema = generation.begin('schema-a', 'connection-a')
    const secondSchema = generation.begin('schema-b', 'connection-a')
    const refreshedSchema = generation.begin('schema-a', 'connection-a')
    expect(generation.isCurrent(firstSchema, 'connection-a')).toBe(false)
    expect(generation.isCurrent(secondSchema, 'connection-a')).toBe(true)
    expect(generation.isCurrent(refreshedSchema, 'connection-a')).toBe(true)
  })

  it('rejects a request belonging to a different connection identity', () => {
    const generation = new TreeRequestGeneration()
    const request = generation.begin('schema-a', 'connection-a')
    expect(generation.isCurrent(request, 'connection-b')).toBe(false)
  })

  it('rejects a child response after root refresh', () => {
    const generation = new TreeRequestGeneration()
    const child = generation.begin('schema-a', 'connection-a')
    generation.invalidateView()
    expect(generation.isCurrent(child, 'connection-a')).toBe(false)
  })
})
