import { createHash } from 'node:crypto'
import { chmodSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAssetHttpServer } from '../src/asset-http-server'
import { createAssetStore } from '../src/asset-store'
import { ASSET_DIR } from '../src/shared'

const NOW = Date.parse('2026-10-30T00:00:00Z')
const HOUR = 3_600_000
let store: ReturnType<typeof createAssetStore>
let server: ReturnType<typeof createAssetHttpServer>

function seed(body: string, lastAccess: number): string {
  const hash = createHash('sha256').update(body).digest('hex')
  const filePath = join(ASSET_DIR, `${hash}.png`)
  writeFileSync(filePath, body)
  store.upsert({
    hash,
    filePath,
    size: body.length,
    mimeType: 'image/png',
    uploadedAt: 1,
    lastAccess
  })
  return hash
}

async function upload(body: string): Promise<Response> {
  const hash = createHash('sha256').update(body).digest('hex')
  return fetch(`${server.getBaseUrl()}/assets/${hash}.png`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body
  })
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  store = createAssetStore()
})

afterEach(() => {
  server?.stop()
  store.flush()
  for (const name of readdirSync(ASSET_DIR)) rmSync(join(ASSET_DIR, name), { force: true })
  vi.restoreAllMocks()
})

describe('asset cache pressure', () => {
  it('reclaims the least recently used cold asset and keeps recent assets readable', async () => {
    const newer = seed('warm', NOW - 2 * HOUR)
    const recent = seed('busy', NOW - 60_000)
    const oldest = seed('cold', NOW - 3 * HOUR)
    server = createAssetHttpServer(store, { maxAssetStoreBytes: 12 })
    await server.start()

    expect((await upload('next')).status).toBe(201)
    expect(store.get(oldest)).toBeUndefined()
    expect(existsSync(join(ASSET_DIR, `${oldest}.png`))).toBe(false)
    expect(await (await fetch(`${server.getBaseUrl()}/assets/${newer}`)).text()).toBe('warm')
    expect(await (await fetch(`${server.getBaseUrl()}/assets/${recent}`)).text()).toBe('busy')
    expect(store.list().reduce((total, asset) => total + asset.size, 0)).toBe(12)
  })

  it('preserves cold files when reclaiming them cannot make enough room', async () => {
    const cold = seed('cold', NOW - 2 * HOUR)
    seed('busy', NOW)
    server = createAssetHttpServer(store, { maxAssetStoreBytes: 8 })
    await server.start()

    expect((await upload('large')).status).toBe(507)
    expect(existsSync(store.get(cold)!.filePath)).toBe(true)
    expect(store.list()).toHaveLength(2)
  })

  it('preserves old client references when capacity eviction is disabled', async () => {
    const cold = seed('cold', NOW - 2 * HOUR)
    server = createAssetHttpServer(store, {
      maxAssetStoreBytes: 4,
      canEvictAssets: () => false
    })
    await server.start()
    expect((await upload('next')).status).toBe(507)
    expect(await (await fetch(`${server.getBaseUrl()}/assets/${cold}`)).text()).toBe('cold')
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps undeletable assets charged to the quota',
    async () => {
      const cold = seed('cold', NOW - 2 * HOUR)
      server = createAssetHttpServer(store, { maxAssetStoreBytes: 4 })
      await server.start()
      chmodSync(ASSET_DIR, 0o500)
      try {
        expect((await upload('next')).status).toBe(507)
        expect(store.get(cold)?.size).toBe(4)
        expect(existsSync(store.get(cold)!.filePath)).toBe(true)
      } finally {
        chmodSync(ASSET_DIR, 0o700)
      }
    }
  )

  it('does not evict a download when its access timestamp ages during the transfer', async () => {
    const hash = seed('x'.repeat(8 * 1024 * 1024), NOW - 2 * HOUR)
    server = createAssetHttpServer(store, { maxAssetStoreBytes: 8 * 1024 * 1024 })
    await server.start()
    const pending = request(`${server.getBaseUrl()}/assets/${hash}`)
    const response = new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      pending.on('response', (res) => {
        res.pause()
        resolve(res)
      })
      pending.on('error', reject)
    })
    pending.end()
    const download = await response
    try {
      expect(download.statusCode).toBe(200)
      vi.mocked(Date.now).mockReturnValue(NOW + 2 * HOUR)
      expect((await upload('next')).status).toBe(507)
      expect(existsSync(store.get(hash)!.filePath)).toBe(true)
    } finally {
      download.destroy()
      pending.destroy()
    }
  })

  it('counts in-flight upload reservations while reclaiming space for another upload', async () => {
    const cold = seed('cold', NOW - 2 * HOUR)
    server = createAssetHttpServer(store, { maxAssetStoreBytes: 8, maxAssetSizeBytes: 4 })
    await server.start()
    const body = 'held'
    const hash = createHash('sha256').update(body).digest('hex')
    const pending = request(`${server.getBaseUrl()}/assets/${hash}.png`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': 4 }
    })
    const response = new Promise<number | undefined>((resolve, reject) => {
      pending.on('response', (res) => {
        res.resume()
        resolve(res.statusCode)
      })
      pending.on('error', reject)
    })
    pending.write('he')
    try {
      await vi.waitFor(() =>
        expect(readdirSync(ASSET_DIR).some((name) => name.includes('.tmp.'))).toBe(true)
      )
      expect((await upload('next')).status).toBe(201)
      pending.end('ld')
      expect(await response).toBe(201)
      expect(store.get(cold)).toBeUndefined()
      expect(store.list().reduce((total, asset) => total + asset.size, 0)).toBe(8)
    } finally {
      pending.destroy()
      await response.catch(() => {})
    }
  })

  it('keeps a cold legacy asset pinned until all concurrent retries finish', async () => {
    const fullHash = seed('held', NOW - 2 * HOUR)
    const record = store.get(fullHash)!
    const hash = fullHash.slice(0, 8)
    store.remove(fullHash, { removeFile: false })
    store.upsert({ ...record, hash })
    server = createAssetHttpServer(store, { maxAssetStoreBytes: 8, maxAssetSizeBytes: 4 })
    await server.start()
    const retries = [0, 1].map(() => {
      const pending = request(`${server.getBaseUrl(true)}/assets/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Content-Length': 4 }
      })
      const response = new Promise<number | undefined>((resolve, reject) => {
        pending.on('response', (res) => {
          res.resume()
          resolve(res.statusCode)
        })
        pending.on('error', reject)
      })
      pending.write('he')
      return { pending, response }
    })
    try {
      await vi.waitFor(() =>
        expect(readdirSync(ASSET_DIR).filter((name) => name.includes('.tmp.'))).toHaveLength(2)
      )
      retries[0]!.pending.end('ld')
      expect(await retries[0]!.response).toBe(200)
      // Keep the original cold timestamp to distinguish transfer pins from the grace period.
      store.upsert({ ...store.get(hash)!, lastAccess: NOW - 2 * HOUR })
      expect((await upload('next')).status).toBe(507)
      retries[1]!.pending.end('ld')
      expect(await retries[1]!.response).toBe(200)
      expect(existsSync(record.filePath)).toBe(true)
    } finally {
      for (const retry of retries) retry.pending.destroy()
      await Promise.allSettled(retries.map((retry) => retry.response))
    }
  })
})
