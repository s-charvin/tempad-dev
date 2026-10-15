import { describe, expect, it } from 'vitest'

import {
  clearPinIds,
  mergePinIds,
  parseWorkingSetSnapshot,
  prunePinIds,
  removePinId,
  resolveFileKey,
  serializeWorkingSetSnapshot,
  workingSetStorageKey
} from '@/ui/working-set'

describe('ui/working-set', () => {
  it('builds storage keys and resolves file keys', () => {
    expect(workingSetStorageKey('abc')).toBe('tempad-dev:working-set:abc')
    expect(resolveFileKey({ fileKey: ' from-api ' })).toBe('from-api')
    expect(resolveFileKey({ pathname: '/design/FILEKEY/Demo' })).toBe('FILEKEY')
    expect(resolveFileKey({ pathname: '/file/XYZ123/name' })).toBe('XYZ123')
    expect(resolveFileKey({ pathname: '/other' })).toBeNull()
  })

  it('round-trips snapshots and rejects invalid payloads', () => {
    const raw = serializeWorkingSetSnapshot({
      version: 1,
      pinIds: ['a', 'b'],
      activeFocusId: 'b'
    })
    expect(parseWorkingSetSnapshot(raw)).toEqual({
      version: 1,
      pinIds: ['a', 'b'],
      activeFocusId: 'b'
    })
    expect(parseWorkingSetSnapshot(null)).toBeNull()
    expect(parseWorkingSetSnapshot('{')).toBeNull()
    expect(parseWorkingSetSnapshot(JSON.stringify({ version: 2, pinIds: [] }))).toBeNull()
  })

  it('merges pins with dedupe and order', () => {
    expect(mergePinIds(['a'], 'a', [])).toMatchObject({ ok: false, reason: 'empty' })
    expect(mergePinIds(['a'], 'a', ['a'])).toMatchObject({ ok: false, reason: 'empty' })

    const merged = mergePinIds(['a'], null, ['b', 'a', 'c'])
    expect(merged).toEqual({
      ok: true,
      pinIds: ['a', 'b', 'c'],
      added: ['b', 'c'],
      activeFocusId: 'b'
    })
  })

  it('pins more than 50 layers and preserves them across storage round-trips', () => {
    const existing = Array.from({ length: 50 }, (_, index) => `id-${index}`)
    const candidates = Array.from({ length: 100 }, (_, index) => `id-${index}`)
    const merged = mergePinIds(existing, 'id-49', candidates)

    expect(merged).toEqual({
      ok: true,
      pinIds: candidates,
      added: candidates.slice(50),
      activeFocusId: 'id-49'
    })
    expect(
      parseWorkingSetSnapshot(
        serializeWorkingSetSnapshot({
          version: 1,
          pinIds: merged.pinIds,
          activeFocusId: merged.activeFocusId
        })
      )
    ).toEqual({ version: 1, pinIds: candidates, activeFocusId: 'id-49' })
  })

  it('removes, clears, and prunes with focus fallback', () => {
    expect(removePinId(['a', 'b', 'c'], 'b', 'b')).toEqual({
      pinIds: ['a', 'c'],
      activeFocusId: 'a'
    })
    expect(removePinId(['a', 'b'], 'a', 'b')).toEqual({
      pinIds: ['a'],
      activeFocusId: 'a'
    })
    expect(clearPinIds()).toEqual({ pinIds: [], activeFocusId: null })

    const pruned = prunePinIds(['a', 'b', 'c'], 'b', new Set(['a', 'c']))
    expect(pruned).toEqual({
      pinIds: ['a', 'c'],
      activeFocusId: 'a',
      removed: ['b']
    })
  })
})
