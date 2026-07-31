/**
 * Small main-process-only reservation queue for background station recovery.
 * Reserving a station happens synchronously before any asynchronous storage
 * read, so two drains can never create competing authorization windows.
 */
export const autoReauthRetryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000] as const

export class SerializedStationAutoReauthQueue {
  private readonly queuedIds = new Set<string>()
  private readonly cancelledActiveIds = new Set<string>()
  private readonly queue: string[] = []
  private activeId: string | undefined

  get activeStationId(): string | undefined {
    return this.activeId
  }

  enqueue(stationId: string): boolean {
    if (!stationId || this.activeId === stationId || this.queuedIds.has(stationId)) return false
    this.queue.push(stationId)
    this.queuedIds.add(stationId)
    return true
  }

  /** Reserve the next FIFO item synchronously, before callers await I/O. */
  reserveNext(): string | undefined {
    if (this.activeId) return undefined
    const stationId = this.queue.shift()
    if (!stationId) return undefined
    this.queuedIds.delete(stationId)
    this.activeId = stationId
    return stationId
  }

  /** Remove a queued task or mark the active task for manual preemption. */
  cancel(stationId: string): boolean {
    if (this.activeId === stationId) {
      this.cancelledActiveIds.add(stationId)
      return true
    }
    if (!this.queuedIds.delete(stationId)) return false
    const index = this.queue.indexOf(stationId)
    if (index >= 0) this.queue.splice(index, 1)
    return true
  }

  isActiveCancelled(stationId: string): boolean {
    return this.activeId === stationId && this.cancelledActiveIds.has(stationId)
  }

  complete(stationId: string): void {
    this.cancelledActiveIds.delete(stationId)
    if (this.activeId === stationId) this.activeId = undefined
  }
}
