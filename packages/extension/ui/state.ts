import { useStorage, computedAsync, useEventListener } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

import { getTemPadComponent } from '@/utils'
import { logger } from '@/utils/log'

import { ui } from './figma'
import {
  CorruptPluginStorageError,
  createPluginStorage,
  PLUGIN_STORAGE_KEY,
  type PluginData
} from './plugin-storage'
import { createPreferenceStorage } from './preference-storage'
import {
  clearPinIds,
  isSceneNodeLike,
  mergePinIds,
  parseWorkingSetSnapshot,
  prunePinIds,
  removePinId,
  resolveFileKey,
  serializeWorkingSetSnapshot,
  workingSetStorageKey
} from './working-set'

export type Options = {
  minimized: boolean
  panelPosition: {
    left: number
    top: number
    width?: number
  }
  prefOpen: boolean
  deepSelectOn: boolean
  measureOn: boolean
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
  variableDisplay: 'reference' | 'resolved' | 'both'
  mcpOn: boolean
  activePluginSource: string | null
}

const defaultOptions: Options = {
  minimized: false,
  panelPosition: {
    left: window.innerWidth - ui.nativePanelWidth - ui.tempadPanelWidth,
    top: ui.topBoundary,
    width: ui.tempadPanelWidth
  },
  prefOpen: false,
  deepSelectOn: false,
  measureOn: false,
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1,
  variableDisplay: 'reference',
  mcpOn: false,
  activePluginSource: null
}

export const options = useStorage<Options>(
  'tempad-dev',
  defaultOptions,
  createPreferenceStorage(localStorage, navigator.locks, defaultOptions, (error) => {
    logger.error('Failed to persist preferences:', error)
  }),
  { mergeDefaults: true, listenToStorageChanges: false }
)

const pluginStorage = createPluginStorage(localStorage, navigator.locks)
export const plugins = shallowRef<Record<string, PluginData>>({})
export const pluginStorageCorrupted = shallowRef(false)

function publishPlugins(current: ReturnType<typeof pluginStorage.read>) {
  plugins.value = current.plugins
  pluginStorageCorrupted.value = false
  const preferences = options.value as Options & { plugins?: typeof plugins.value }
  if (!current.legacy) delete preferences.plugins
}

function refreshPlugins() {
  try {
    publishPlugins(pluginStorage.read())
  } catch (error) {
    if (error instanceof CorruptPluginStorageError) pluginStorageCorrupted.value = true
    logger.error('Failed to read plugin storage:', error)
  }
}

refreshPlugins()
void pluginStorage
  .migrate()
  .then(refreshPlugins)
  .catch((error) => {
    logger.error('Failed to migrate plugin storage:', error)
  })
useEventListener(window, 'storage', (event) => {
  if (
    event.storageArea === localStorage &&
    (event.key === null ||
      event.key === PLUGIN_STORAGE_KEY ||
      (event.key === 'tempad-dev' && localStorage.getItem(PLUGIN_STORAGE_KEY) === null))
  ) {
    // Events can arrive after a newer write. Read the durable state, not newValue.
    refreshPlugins()
  }
})

export async function savePlugin(source: string, plugin: PluginData | null): Promise<void> {
  try {
    await pluginStorage.save(source, plugin)
    publishPlugins(pluginStorage.read())
  } catch (error) {
    if (error instanceof CorruptPluginStorageError) pluginStorageCorrupted.value = true
    throw error
  }
}

export async function resetPlugins(): Promise<void> {
  const reset = await pluginStorage.resetCorruptRecord()
  publishPlugins(pluginStorage.read())
  if (reset) options.value.activePluginSource = null
}

if (!Number.isFinite(options.value.rootFontSize) || options.value.rootFontSize <= 0)
  options.value.rootFontSize = 16
if (!Number.isFinite(options.value.scale) || options.value.scale <= 0) options.value.scale = 1

export const runtimeMode = shallowRef<'standard' | 'unavailable'>('standard')
export const layoutReady = shallowRef(false)
export const figmaSelection = shallowRef<readonly SceneNode[]>([])
export const selection = figmaSelection
export const selectionRevision = shallowRef(0)
export const pinIds = shallowRef<string[]>([])
export const activeFocusId = shallowRef<string | null>(null)
export const workingNodes = shallowRef<SceneNode[]>([])
export const activeFocusNode = computed(
  () =>
    workingNodes.value.find((node) => node.id === activeFocusId.value) ??
    workingNodes.value[0] ??
    figmaSelection.value[0] ??
    null
)
export const selectedNode = computed(() => activeFocusNode.value)
export const selectedTemPadComponent = computed(() => {
  // Native nodes are mutable even while the selected IDs stay unchanged.
  void selectionRevision.value
  const node = selectedNode.value
  return node ? getTemPadComponent(node) : null
})

export const activePlugin = computedAsync(async () => {
  if (!options.value.activePluginSource) {
    return null
  }

  return plugins.value[options.value.activePluginSource]
}, null)

function currentFileKey(): string | null {
  const apiKey =
    typeof figma !== 'undefined' && 'fileKey' in figma
      ? (figma.fileKey as string | undefined)
      : undefined
  return resolveFileKey({ fileKey: apiKey })
}

function readStorageSnapshot(fileKey: string): ReturnType<typeof parseWorkingSetSnapshot> {
  try {
    return parseWorkingSetSnapshot(sessionStorage.getItem(workingSetStorageKey(fileKey)))
  } catch {
    return null
  }
}

function writeStorageSnapshot(fileKey: string | null): void {
  if (!fileKey) return
  try {
    sessionStorage.setItem(
      workingSetStorageKey(fileKey),
      serializeWorkingSetSnapshot({
        version: 1,
        pinIds: [...pinIds.value],
        activeFocusId: activeFocusId.value
      })
    )
  } catch {
    // sessionStorage 可能不可用；忽略，保持内存态。
  }
}

function applySnapshot(pinIdList: readonly string[], focusId: string | null): void {
  pinIds.value = [...pinIdList]
  activeFocusId.value = focusId
}

/**
 * 从 ID 解析 workingNodes，并修剪失效 pin。
 * layoutReady=false 时只清空派生节点，保留 ID（对抗 Figma 刷新丢记忆）。
 */
export function rehydrateWorkingSet(): { removed: number } {
  if (!layoutReady.value || typeof figma === 'undefined' || !figma.getNodeById) {
    workingNodes.value = []
    return { removed: 0 }
  }

  const resolved: SceneNode[] = []
  const existing = new Set<string>()
  for (const id of pinIds.value) {
    const node = figma.getNodeById(id)
    if (!isSceneNodeLike(node)) continue
    existing.add(id)
    resolved.push(node)
  }

  const pruned = prunePinIds(pinIds.value, activeFocusId.value, existing)
  if (pruned.removed.length || pruned.activeFocusId !== activeFocusId.value) {
    applySnapshot(pruned.pinIds, pruned.activeFocusId)
    writeStorageSnapshot(currentFileKey())
  }

  workingNodes.value = resolved.filter((node) => pruned.pinIds.includes(node.id))
  return { removed: pruned.removed.length }
}

let loadedWorkingSetFileKey: string | null = null

/** Load the working set for the active file. */
export function loadWorkingSetFromStorage(): void {
  const fileKey = currentFileKey()
  if (!fileKey || loadedWorkingSetFileKey === fileKey) return
  loadedWorkingSetFileKey = fileKey
  const snapshot = readStorageSnapshot(fileKey)
  applySnapshot(snapshot?.pinIds ?? [], snapshot?.activeFocusId ?? null)
  rehydrateWorkingSet()
}

export type PinFromSelectionResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'empty' | 'not-ready' }

/** 将当前画布选区中的可见节点加入 pins。 */
export function pinFromFigmaSelection(): PinFromSelectionResult {
  if (!layoutReady.value) {
    return { ok: false, reason: 'not-ready' }
  }

  const candidates = figmaSelection.value.filter((node) => node.visible).map((node) => node.id)
  const merged = mergePinIds(pinIds.value, activeFocusId.value, candidates)
  if (!merged.ok) {
    return { ok: false, reason: merged.reason }
  }

  applySnapshot(merged.pinIds, merged.activeFocusId)
  writeStorageSnapshot(currentFileKey())
  rehydrateWorkingSet()
  return { ok: true, added: merged.added.length }
}

export function unpinById(id: string): void {
  const next = removePinId(pinIds.value, activeFocusId.value, id)
  applySnapshot(next.pinIds, next.activeFocusId)
  writeStorageSnapshot(currentFileKey())
  rehydrateWorkingSet()
}

export function clearPins(): void {
  const next = clearPinIds()
  applySnapshot(next.pinIds, next.activeFocusId)
  writeStorageSnapshot(currentFileKey())
  workingNodes.value = []
}

export function setActiveFocus(id: string): void {
  if (!pinIds.value.includes(id)) return
  activeFocusId.value = id
  writeStorageSnapshot(currentFileKey())
}
