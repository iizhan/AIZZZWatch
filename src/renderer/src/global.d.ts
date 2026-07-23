import type { AizzzApi } from '../../shared/types'

declare global {
  interface Window {
    aizzz: AizzzApi
  }
}

export {}
