/**
 * Tracks the latest refresh intent for each station. Network work is not
 * cancelled, but results from an older intent must never overwrite a newer
 * snapshot, association, or ledger observation.
 */
export class StationRefreshEpochs {
  private readonly epochs = new Map<string, number>()

  begin(stationId: string): number {
    const next = (this.epochs.get(stationId) ?? 0) + 1
    this.epochs.set(stationId, next)
    return next
  }

  invalidate(stationId: string): void {
    this.begin(stationId)
  }

  isCurrent(stationId: string, epoch: number): boolean {
    return this.epochs.get(stationId) === epoch
  }
}
