import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RefLike<T> = { value: T }

const mocks = vi.hoisted(() => ({
  layoutReady: { value: false } as RefLike<boolean>,
  runtimeMode: { value: 'standard' } as RefLike<'standard' | 'unavailable'>,
  figmaSelection: { value: [] as SceneNode[] } as RefLike<readonly SceneNode[]>,
  selectionRevision: { value: 0 },
  visibility: { value: 'visible' } as RefLike<'visible' | 'hidden'>,
  focused: { value: true } as RefLike<boolean>,
  getCanvas: vi.fn(),
  getLeftPanel: vi.fn(),
  loadWorkingSetFromStorage: vi.fn(),
  rehydrateWorkingSet: vi.fn(() => ({ removed: 0 })),
  listeners: [] as Array<{ target: unknown; event: string; handler: (...args: unknown[]) => void }>,
  watchers: [] as Array<{ source: unknown; callback: (value: unknown) => void }>
}))

function resolveWatchSource(source: unknown) {
  if (typeof source === 'function') {
    return (source as () => unknown)()
  }
  if (Array.isArray(source)) {
    return source.map((entry) => {
      if (entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
        return (entry as RefLike<unknown>).value
      }
      if (typeof entry === 'function') {
        return (entry as () => unknown)()
      }
      return entry
    })
  }
  if (source && typeof source === 'object' && 'value' in (source as Record<string, unknown>)) {
    return (source as RefLike<unknown>).value
  }
  return source
}

vi.mock('vue', () => ({
  computed: (getter: () => unknown) => ({
    get value() {
      return getter()
    }
  }),
  shallowRef: <T>(value: T) => ({ value }),
  watch: (
    source: unknown,
    callback: (value: unknown) => void,
    options?: { immediate?: boolean }
  ) => {
    mocks.watchers.push({ source, callback })
    if (options?.immediate) {
      callback(resolveWatchSource(source))
    }
    return vi.fn()
  },
  onMounted: (callback: () => void) => callback(),
  onBeforeUnmount: vi.fn()
}))

vi.mock('@vueuse/core', () => ({
  useDocumentVisibility: () => mocks.visibility,
  useWindowFocus: () => mocks.focused,
  useEventListener: (target: unknown, event: string, handler: (...args: unknown[]) => void) => {
    mocks.listeners.push({ target, event, handler })
    return vi.fn()
  }
}))

vi.mock('@/ui/state', () => ({
  layoutReady: mocks.layoutReady,
  runtimeMode: mocks.runtimeMode,
  activeFocusNode: {
    get value() {
      return mocks.figmaSelection.value[0] ?? null
    }
  },
  workingNodes: { value: [] },
  figmaSelection: mocks.figmaSelection,
  selectionRevision: mocks.selectionRevision,
  loadWorkingSetFromStorage: mocks.loadWorkingSetFromStorage,
  rehydrateWorkingSet: mocks.rehydrateWorkingSet
}))

vi.mock('@/utils', () => ({
  getCanvas: mocks.getCanvas,
  getLeftPanel: mocks.getLeftPanel
}))

import { syncSelection, useSelection } from '@/composables/selection'
import { figmaSelection } from '@/ui/state'

function createSceneNode(id: string, visible = true): SceneNode {
  return {
    id,
    visible,
    type: 'FRAME',
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    children: []
  } as unknown as SceneNode
}

function setFigmaSelection(nodes: SceneNode[]) {
  const figma = {
    fileKey: 'file-a',
    currentPage: {
      selection: nodes
    }
  }
  vi.stubGlobal('window', { figma } as unknown as Window)
  vi.stubGlobal('figma', figma)
}

function findListener(event: string, index = 0) {
  return mocks.listeners.filter((entry) => entry.event === event)[index]
}

describe('composables/selection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.layoutReady.value = false
    mocks.runtimeMode.value = 'standard'
    mocks.figmaSelection.value = []
    mocks.selectionRevision.value = 0
    mocks.visibility.value = 'visible'
    mocks.focused.value = true
    mocks.getCanvas.mockReset()
    mocks.getLeftPanel.mockReset()
    mocks.loadWorkingSetFromStorage.mockReset()
    mocks.rehydrateWorkingSet.mockReset()
    mocks.rehydrateWorkingSet.mockReturnValue({ removed: 0 })
    mocks.listeners.length = 0
    mocks.watchers.length = 0
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('syncSelection clears stale figmaSelection when figma page is unavailable', () => {
    figmaSelection.value = [createSceneNode('stale')]
    vi.stubGlobal('window', {} as Window)

    syncSelection()

    expect(figmaSelection.value).toEqual([])

    syncSelection()
    expect(figmaSelection.value).toEqual([])
  })

  it('syncSelection keeps selection identity stable while invalidating mutable node content', () => {
    const sameRef = [createSceneNode('same-ref')]
    setFigmaSelection(sameRef)
    figmaSelection.value = sameRef
    syncSelection()
    expect(figmaSelection.value).toBe(sameRef)

    const current = [createSceneNode('same')]
    setFigmaSelection([createSceneNode('same')])
    figmaSelection.value = current

    syncSelection()
    expect(figmaSelection.value).toBe(current)
    expect(mocks.selectionRevision.value).toBe(2)

    const next = [createSceneNode('next')]
    setFigmaSelection(next)
    syncSelection()

    expect(figmaSelection.value).toBe(next)
  })

  it('useSelection wires listeners, hydrates working set, and keeps pins on layout teardown', () => {
    const canvas = {} as HTMLElement
    const panel = {} as HTMLElement
    mocks.layoutReady.value = true
    mocks.getCanvas.mockReturnValue(canvas)
    mocks.getLeftPanel.mockReturnValue(panel)
    setFigmaSelection([createSceneNode('initial')])

    useSelection()

    expect(figmaSelection.value[0]?.id).toBe('initial')
    expect(mocks.loadWorkingSetFromStorage).toHaveBeenCalled()
    expect(mocks.rehydrateWorkingSet).toHaveBeenCalled()
    expect(mocks.listeners.filter((entry) => entry.event === 'click')).toHaveLength(2)
    expect(mocks.listeners.filter((entry) => entry.event === 'keyup')).toHaveLength(1)

    setFigmaSelection([createSceneNode('click-sync')])
    findListener('click', 0)?.handler({})
    vi.advanceTimersByTime(100)
    expect(figmaSelection.value[0]?.id).toBe('click-sync')

    setFigmaSelection([createSceneNode('focus-sync')])
    findListener('keyup', 0)?.handler({
      target: { classList: { contains: (name: string) => name === 'focus-target' } }
    })
    vi.advanceTimersByTime(100)
    expect(figmaSelection.value[0]?.id).toBe('focus-sync')

    findListener('keyup', 0)?.handler({
      target: { classList: { contains: () => false } }
    })
    findListener('keyup', 0)?.handler({ target: null })
    vi.advanceTimersByTime(100)
    expect(figmaSelection.value[0]?.id).toBe('focus-sync')

    const layoutWatcher = mocks.watchers[0]
    const modeWatcher = mocks.watchers[1]

    if (!layoutWatcher || !modeWatcher) {
      throw new Error('Expected both watchers to be registered')
    }

    figmaSelection.value = [createSceneNode('to-clear')]
    mocks.rehydrateWorkingSet.mockClear()
    layoutWatcher.callback(false)
    expect(figmaSelection.value).toEqual([])
    expect(mocks.rehydrateWorkingSet).toHaveBeenCalled()

    layoutWatcher.callback(true)
    expect(mocks.getCanvas).toHaveBeenCalledTimes(2)
    expect(mocks.getLeftPanel).toHaveBeenCalledTimes(2)
    const readySelection = figmaSelection.value

    setFigmaSelection([createSceneNode('mode-guard')])
    mocks.layoutReady.value = true
    modeWatcher.callback(['unavailable', true])
    expect(figmaSelection.value).toBe(readySelection)

    mocks.layoutReady.value = false
    modeWatcher.callback(['standard', true])
    expect(figmaSelection.value).toBe(readySelection)

    mocks.layoutReady.value = true
    modeWatcher.callback(['standard', false])
    expect(figmaSelection.value).toBe(readySelection)

    modeWatcher.callback(['standard', true])
    expect(figmaSelection.value[0]?.id).toBe('mode-guard')

    setFigmaSelection([createSceneNode('source-eval')])
    modeWatcher.callback(resolveWatchSource(modeWatcher.source))
    expect(figmaSelection.value[0]?.id).toBe('source-eval')
  })

  it('handles initial layout-not-ready path without hydrating from storage early', () => {
    mocks.layoutReady.value = false
    mocks.figmaSelection.value = []
    setFigmaSelection([createSceneNode('not-used')])

    useSelection()

    expect(mocks.watchers).toHaveLength(3)
    expect(mocks.listeners.filter((entry) => entry.event === 'click')).toHaveLength(2)
    expect(mocks.listeners.filter((entry) => entry.event === 'keyup')).toHaveLength(1)
    expect(mocks.loadWorkingSetFromStorage).not.toHaveBeenCalled()
  })
})
