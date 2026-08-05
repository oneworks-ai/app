---
description: 主仓 Demo Video submodule 接入、产品控制边界与规范入口。
---

# Demo Video 主仓接入

可复用的录制、场景、安全 fixture、鼠标 / 镜头合成、后期片头、创作档案与投放清单统一维护在 `assets/demo-video` submodule：

- 总览：[`assets/demo-video/README.zh-Hans.md`](../../../assets/demo-video/README.zh-Hans.md)
- 完整录制标准：[`assets/demo-video/docs/recording-standards.md`](../../../assets/demo-video/docs/recording-standards.md)
- 视频目录：[`assets/demo-video/docs/catalog.md`](../../../assets/demo-video/docs/catalog.md)
- Adapter 宣传片创作档案：[`assets/demo-video/docs/creative/adapter-promo.md`](../../../assets/demo-video/docs/creative/adapter-promo.md)

主仓只拥有产品强耦合的薄集成：Electron 生命周期、Desktop Control、Chrome Driver、workspace 启动、fixture 向真实数据源的注入，以及 README / 文档站公开衍生素材。`scripts/demo-video.ts` 只重导出 submodule 命令，其他集成直接从 `assets/demo-video/src/` 导入。

常用入口保持不变：

```bash
pnpm tools demo-video list
pnpm tools demo-video record url-tour --url <page-url>
pnpm tools demo-video batch url-tour --url <page-url>
pnpm tools desktop-control record-batch launcher-open-workspace-adapter-tour \
  --workspace <path> \
  --app <app> \
  --use-deskpad-display \
  --demo-fixture adapter-promo
```

修改 submodule 中的视频逻辑时，先在独立仓库通过 `pnpm check`，再更新主仓 submodule 指针并跑主仓 lint、typecheck、相关 Desktop Control / CLI 测试。全高清母版不提交；公开 GIF、poster 与文档 Web MP4 留在 `.oo/docs/`，其来源和全部展示位置必须登记到 submodule 的 `catalog/videos.json`。
