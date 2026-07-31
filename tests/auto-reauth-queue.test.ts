import { describe, expect, it } from 'vitest'
import { autoReauthRetryDelaysMs, SerializedStationAutoReauthQueue } from '../src/main/auto-reauth-queue'

describe('SerializedStationAutoReauthQueue', () => {
  it('reserves one FIFO station before asynchronous work and never double-reserves it', () => {
    const queue = new SerializedStationAutoReauthQueue()

    expect(queue.enqueue('station-a')).toBe(true)
    expect(queue.enqueue('station-b')).toBe(true)
    expect(queue.enqueue('station-a')).toBe(false)
    expect(queue.reserveNext()).toBe('station-a')
    expect(queue.reserveNext()).toBeUndefined()

    queue.complete('station-a')
    expect(queue.reserveNext()).toBe('station-b')
  })

  it('lets a manual authorization cancel an active reservation before it opens a window', () => {
    const queue = new SerializedStationAutoReauthQueue()
    queue.enqueue('station-a')
    expect(queue.reserveNext()).toBe('station-a')

    expect(queue.cancel('station-a')).toBe(true)
    expect(queue.isActiveCancelled('station-a')).toBe(true)
    queue.complete('station-a')
    expect(queue.activeStationId).toBeUndefined()
  })

  it('removes a queued manual target without disturbing the active recovery', () => {
    const queue = new SerializedStationAutoReauthQueue()
    queue.enqueue('station-a')
    queue.enqueue('station-b')
    expect(queue.reserveNext()).toBe('station-a')

    expect(queue.cancel('station-b')).toBe(true)
    queue.complete('station-a')
    expect(queue.reserveNext()).toBeUndefined()
  })

  it('keeps the approved bounded 1/5/30-minute retry schedule', () => {
    expect(autoReauthRetryDelaysMs).toEqual([60_000, 5 * 60_000, 30 * 60_000])
  })
})
