import { describe, expect, it } from 'vitest'
import { StationRefreshEpochs } from '../src/main/station-refresh-epochs'

describe('StationRefreshEpochs', () => {
  it('accepts only the newest refresh intent for a station', () => {
    const epochs = new StationRefreshEpochs()
    const pollingEpoch = epochs.begin('station-a')
    const forcedEpoch = epochs.begin('station-a')

    expect(epochs.isCurrent('station-a', pollingEpoch)).toBe(false)
    expect(epochs.isCurrent('station-a', forcedEpoch)).toBe(true)
  })

  it('invalidates an in-flight refresh when its station is removed', () => {
    const epochs = new StationRefreshEpochs()
    const inFlightEpoch = epochs.begin('station-a')
    epochs.invalidate('station-a')

    expect(epochs.isCurrent('station-a', inFlightEpoch)).toBe(false)
  })
})
