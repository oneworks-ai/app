[English](./README.md)

# @oneworks/model-provider-catalog

One Works 的版本化模型服务商元数据目录。

该包包含服务商标识、官方 API 地址、默认模型回退、门户链接、能力声明、适配器兼容性和主机匹配规则，可以独立于应用运行时进行更新。

在服务商支持的情况下，实际可用模型仍优先通过官方 API 动态查询。该目录只提供元数据和安全回退，不发起网络请求，也不存储凭据。

## 安装

```bash
npm install @oneworks/model-provider-catalog
```

## 使用

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

加载独立安装目录的消费者应在激活前完成校验，并保留兼容的内置目录作为回退。
