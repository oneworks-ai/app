[简体中文](./README.zh-Hans.md)

# @oneworks/model-provider-catalog

Versioned model provider metadata for One Works.

This package contains provider identities, official API endpoints, default model fallbacks, portal links, capability declarations, adapter compatibility, and host matching rules. It can be updated independently from the application runtime.

Model availability is still discovered from each provider's official API whenever possible. This catalog supplies metadata and safe fallbacks; it does not perform network requests or store credentials.

## Install

```bash
npm install @oneworks/model-provider-catalog
```

## Usage

```ts
import {
  MODEL_PROVIDER_CATALOG,
  MODEL_PROVIDER_CATALOG_SCHEMA_VERSION,
  validateModelProviderCatalog
} from '@oneworks/model-provider-catalog'

const catalog = validateModelProviderCatalog(MODEL_PROVIDER_CATALOG)

console.log(MODEL_PROVIDER_CATALOG_SCHEMA_VERSION)
console.log(catalog.providers)
```

Consumers loading a separately installed catalog should validate it before activation and retain a compatible bundled catalog as a fallback.
