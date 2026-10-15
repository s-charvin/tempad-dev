/** Working Set：与画布选区解耦的 pin / 焦点模型（纯函数，便于单测）。 */

export const WORKING_SET_STORAGE_PREFIX = 'tempad-dev:working-set:'
export const WORKING_SET_VERSION = 1 as const

export type WorkingSetSnapshot = {
  version: typeof WORKING_SET_VERSION
  pinIds: string[]
  activeFocusId: string | null
}

export type MergePinsResult =
  | { ok: true; pinIds: string[]; added: string[]; activeFocusId: string | null }
  | { ok: false; reason: 'empty'; pinIds: string[]; activeFocusId: string | null }

export function workingSetStorageKey(fileKey: string): string {
  return `${WORKING_SET_STORAGE_PREFIX}${fileKey}`
}

/**
 * 解析当前文件 key：优先 Plugin API，再尝试 URL，失败返回 null（仅内存、不写 storage）。
 */
export function resolveFileKey(input?: {
  fileKey?: string | null
  pathname?: string | null
}): string | null {
  const fromApi = input?.fileKey?.trim()
  if (fromApi) return fromApi

  const pathname = input?.pathname ?? (typeof location !== 'undefined' ? location.pathname : '')
  // /design/:key/... 或 /file/:key/...
  const match = pathname.match(/\/(?:design|file|board|proto|slides|deck|site)\/([A-Za-z0-9]+)/)
  return match?.[1] ?? null
}

export function parseWorkingSetSnapshot(raw: string | null | undefined): WorkingSetSnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<WorkingSetSnapshot>
    if (parsed.version !== WORKING_SET_VERSION) return null
    if (!Array.isArray(parsed.pinIds)) return null
    const pinIds = parsed.pinIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    const activeFocusId =
      typeof parsed.activeFocusId === 'string' && parsed.activeFocusId.length > 0
        ? parsed.activeFocusId
        : null
    return {
      version: WORKING_SET_VERSION,
      pinIds,
      activeFocusId
    }
  } catch {
    return null
  }
}

export function serializeWorkingSetSnapshot(snapshot: WorkingSetSnapshot): string {
  return JSON.stringify({
    version: WORKING_SET_VERSION,
    pinIds: snapshot.pinIds,
    activeFocusId: snapshot.activeFocusId
  })
}

/** 追加 pin：去重保序；超限拒绝整次新增（不静默裁切已有项）。 */
export function mergePinIds(
  currentPinIds: readonly string[],
  currentFocusId: string | null,
  candidateIds: readonly string[]
): MergePinsResult {
  const uniqueCandidates: string[] = []
  const seen = new Set(currentPinIds)
  for (const id of candidateIds) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    uniqueCandidates.push(id)
  }

  if (!uniqueCandidates.length) {
    return {
      ok: false,
      reason: 'empty',
      pinIds: [...currentPinIds],
      activeFocusId: currentFocusId
    }
  }

  const pinIds = [...currentPinIds, ...uniqueCandidates]
  const activeFocusId = currentFocusId ?? uniqueCandidates[0] ?? null
  return { ok: true, pinIds, added: uniqueCandidates, activeFocusId }
}

export function removePinId(
  currentPinIds: readonly string[],
  currentFocusId: string | null,
  removeId: string
): { pinIds: string[]; activeFocusId: string | null } {
  const pinIds = currentPinIds.filter((id) => id !== removeId)
  const activeFocusId =
    currentFocusId && pinIds.includes(currentFocusId) ? currentFocusId : (pinIds[0] ?? null)
  return { pinIds, activeFocusId }
}

export function clearPinIds(): { pinIds: string[]; activeFocusId: null } {
  return { pinIds: [], activeFocusId: null }
}

/** 按仍存在的 id 修剪；焦点不在剩余集合中则回落到首项。 */
export function prunePinIds(
  currentPinIds: readonly string[],
  currentFocusId: string | null,
  existingIds: ReadonlySet<string>
): { pinIds: string[]; activeFocusId: string | null; removed: string[] } {
  const removed: string[] = []
  const pinIds: string[] = []
  for (const id of currentPinIds) {
    if (existingIds.has(id)) {
      pinIds.push(id)
    } else {
      removed.push(id)
    }
  }
  const activeFocusId =
    currentFocusId && pinIds.includes(currentFocusId) ? currentFocusId : (pinIds[0] ?? null)
  return { pinIds, activeFocusId, removed }
}

export function isSceneNodeLike(node: BaseNode | null | undefined): node is SceneNode {
  return !!node && 'visible' in node && 'type' in node
}
