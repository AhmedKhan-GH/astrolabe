import type { AstrolabeApi } from '../../preload/index'

declare global {
  interface Window {
    astrolabe: AstrolabeApi
  }
}

export {}
