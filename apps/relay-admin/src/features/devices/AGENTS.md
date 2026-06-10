# Relay Admin Devices Feature

`features/devices` 负责 Relay 设备互联管理：当前登录用户自己的已连接设备列表、设备详情和设备会话查看。

## 入口

- `DevicePanel.tsx`：`/admin/devices` 列表页容器。
- `DeviceTable.tsx`：设备列表，遵循 `AdminListTable` 标准。
- `DeviceDetailPage.tsx`：`/admin/devices/:deviceId` 的设备详情页，展示低频排查字段和当前设备会话。
- `devicesApi.ts`：`/api/relay/devices` 与 `/api/relay/devices/:deviceId/sessions` 的 feature 专属 client。

## 约定

- 设备是 Relay Admin 的核心管理域，侧边栏应优先展示设备入口。
- 设备列表和详情只展示当前登录用户自己的设备；不要把 owner/admin 设备入口做成全局设备观察台。
- 管理其他用户时只能使用 `deviceCount` 与 `maxDevices` 聚合字段；不要把其他用户的 device name / capabilities / workspace folder / plugin scope 暴露到 admin UI。
- 设备 UUID、workspace folder、plugin scope、capabilities JSON 等低频排查字段不默认塞进列表，放到详情页或展示列配置；面向用户的 UI 文案里 capabilities 叫「支持功能」，不要直接叫「能力」。
- 后端没有删除 / 强制下线设备语义前，不在前端伪造设备写操作。
