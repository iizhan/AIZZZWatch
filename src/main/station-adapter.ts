import { NewApiClient } from './newapi-client'
import { Sub2ApiClient } from './sub2api-client'
import type { ResolvedStationAdapterType, StationAdapterType } from '../shared/types'

type AdapterStation = ConstructorParameters<typeof Sub2ApiClient>[0] & {
  adapterType?: StationAdapterType
  detectedAdapterType?: ResolvedStationAdapterType
}

export function resolveStationAdapterType(station: Pick<AdapterStation, 'adapterType' | 'detectedAdapterType'>): ResolvedStationAdapterType {
  if (station.adapterType === 'newapi') return 'newapi'
  if (station.adapterType === 'custom') return 'custom'
  if (station.adapterType === 'auto' && station.detectedAdapterType) return station.detectedAdapterType
  return 'sub2api'
}

export function usesSub2ApiContract(station: Pick<AdapterStation, 'adapterType' | 'detectedAdapterType'>): boolean {
  return resolveStationAdapterType(station) !== 'newapi'
}

export function createStationReadClient(station: AdapterStation): Sub2ApiClient | NewApiClient {
  return resolveStationAdapterType(station) === 'newapi'
    ? new NewApiClient(station)
    : new Sub2ApiClient(station)
}
