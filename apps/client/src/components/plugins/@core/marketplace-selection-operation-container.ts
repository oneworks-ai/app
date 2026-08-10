import type { MarketplaceSelectionOperation } from './marketplace-plugin-selection'

export class MarketplaceSelectionOperationContainer {
  readonly #inFlight = new Map<string, MarketplaceSelectionOperation>()
  readonly #tokens = new Map<string, object>()

  clear() {
    this.#inFlight.forEach(operation => operation.authority.release())
    this.#inFlight.clear()
    this.#tokens.clear()
  }

  get(key: string) {
    return this.#inFlight.get(key)
  }

  isCurrent(key: string, token: object) {
    return this.#tokens.get(key) === token
  }

  retire(key: string, operation: MarketplaceSelectionOperation) {
    if (!operation.settled || operation.consumers > 0) return false
    if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key)
    if (this.#tokens.get(key) === operation.token) this.#tokens.delete(key)
    return true
  }

  set(key: string, operation: MarketplaceSelectionOperation) {
    this.#inFlight.set(key, operation)
    this.#tokens.set(key, operation.token)
  }
}
