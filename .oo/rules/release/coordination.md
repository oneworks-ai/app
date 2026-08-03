# 多会话发布协调

返回入口：[RELEASE.md](../RELEASE.md)

本页只定义跨发布面的任务所有权、阶段门禁和证据汇总。线程生命周期、模型路由、Git operator、heartbeat、deadline 与归档继续遵守[任务规划、委派与经验沉淀](../maintenance/task-planning.md)；具体 tag、npm、Desktop、扩展和部署命令继续遵守[发布步骤](./process.md)与 [tag 约定](./tags.md)，不要在这里复制实现细节。

## 何时必须拆分

- 整体发布，或一次发布同时触达 npm、Desktop、编辑器 / 浏览器扩展、托管服务、跨仓库站点中的两个及以上分发面时，必须使用一个主协调任务和多个独立执行 / 验证任务。
- 单包且只有一个外部副作用面的发布可以保留单任务；一旦出现跨平台故障、恢复决策或需要独立最终审计，立即升级为多任务协调。
- 不按包数量拆任务。npm workspace 依赖顺序、aliases 和 dist-tag 由同一个 npm owner 负责，避免多个任务同时改写或发布同一依赖图。

## 单一发布身份

主协调任务在任何远端发布副作用前锁定以下身份，并把相同值传给所有任务：

```text
repository
release PR / merge commit
immutable source SHA
package -> target version
release channel / registry dist-tag
selected distribution surfaces
```

- 所有 tag、artifact、registry 版本、部署和探活必须能回溯到同一个 immutable source SHA；“当前 main”“最新 tag”或任务启动时重新取最新代码都不能代替精确 SHA。
- Cloudflare 与 Vercel 是两个独立部署 owner，只共享获批 source SHA 和 Relay 版本契约，任何一方成功都不能证明另一方完成。
- 发布过程中 main 继续前进时，当前发布身份不随之移动。需要改变 package set、版本或 source SHA 时，由协调者明确终止旧矩阵并建立新矩阵。

## 协调矩阵

主协调任务维护临时发布矩阵，不把 thread id、个人路径、凭据或一次性日志写入仓库：

| 字段          | 含义                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| Scope         | npm、Desktop、扩展、Cloudflare、Vercel、PWA / Avatar / Homepage 或最终审计 |
| Owner         | 唯一负责该外部副作用或只读验证的任务                                       |
| Source        | 精确 SHA、tag、workflow run、candidate run 或 artifact manifest            |
| Authorization | 当前允许的 publish、dispatch、deploy、安装或只读范围                       |
| Status        | pending、running、completed、failed 或 blocked                             |
| Evidence      | registry、Release、Actions、checksum、health 或本地安装的权威证据          |
| Next          | 缺失步骤、恢复动作或归档条件                                               |

同一个外部副作用在任一时刻只能有一个 owner。其他任务可以并行只读核验，但不得“顺手”重发、移动 tag、改 dist-tag、重复提交商店或重部署。

## 默认分面与波次

协调式整体发布默认按以下独立验收面拆分；可用并发不足时分波复用任务槽位，优先启动历史耗时最长的任务：

1. npm：publish plan、workspace 依赖顺序、aliases、目标版本和 dist-tag。
2. Desktop：候选清单、双架构产物、checksum、GitHub Release 和本地安装。
3. 扩展：VS Code Marketplace、Open VSX、Chrome Web Store、对应 artifact / Release。
4. Cloudflare Relay：dev / production、Worker / Admin 与精确 health 证据。
5. Vercel Relay：dev / production、项目配置与精确 health 证据。
6. 下游站点：PWA、Avatar、Homepage 的跨仓库 run 和线上入口。
7. 最终审计：未参与前述执行的全新只读任务，逐项核验完整矩阵。

主协调任务只保留范围、授权、异常决策和最终判断，不重复消费各平台完整日志。一个分面失败时优先把证据返回原 owner 继续恢复，不为同一范围反复创建缺少上下文的新任务。

## 任务输入与回调

每个任务输入除通用 task-planning 字段外，还必须明确：

- 主任务 id、分面名称和唯一 owner 身份。
- immutable source SHA、目标版本 / tag 和权威 workflow 或 registry。
- 允许与禁止的外部副作用；只读任务必须明确禁止 publish、dispatch、deploy、安装和 Git 写入。
- 完成条件、失败恢复边界、deadline，以及发现身份不一致时立即停止的条件。
- 只返回有限、已脱敏的权威证据，不返回 secret、token、完整环境或无界日志。

阶段和终态回调统一使用：

```text
Main thread:
Scope:
Terminal status: COMPLETED / FAILED / STOPPED / CANCELLED / BLOCKED
Source SHA / version:
Result and authoritative evidence:
Mutations performed:
Validation:
Git / PR / merge state:
Remaining follow-up:
Safe to archive: yes / no
```

`COMPLETED`、任务 idle 或 workflow 绿色本身都不是最终证据；协调者必须核对回调中的远端状态和实际目标值。

## 阶段门禁

1. **范围与预检（串行）**：确定 package set、版本、changelog、publish plan、版本例外、凭据完整性和恢复方案。
2. **Release PR（串行）**：只由 Release PR 修改版本与发布元数据；独立审阅和 required checks 通过后合入并锁定 merge SHA。
3. **候选与分发（并行）**：按分面启动独立任务；npm 内部依赖顺序、Desktop candidate -> promotion、tag -> tag-driven workflow 等分面内依赖仍保持串行。
4. **异常恢复（按分面）**：先对 registry、remote tag、Release、workflow run、candidate manifest 和线上 health 做状态对账，只恢复缺失的幂等步骤；不要直接重跑整批发布。
5. **终态审计（串行收口）**：所有 owner 回调后，由独立只读任务按当前远端状态重新核验，再由协调者处理归档并给出最终结论。

如果已经公开的 artifact、tag 或 package 指向错误身份，不移动或覆盖既有不可变版本；停止该矩阵，修复后使用下一预发布版本重新完成全链路。

## 终态验收

最终审计只覆盖发布身份中锁定的 `selected distribution surfaces` 和环境，但必须为每一个已选择的矩阵行提供完整证据；未选择的分发面明确记录为 out of scope，不能以未验证状态冒充成功。对已选择的范围至少证明：

- publish plan 中每个 public package 的精确版本和目标 dist-tag 正确，aliases 与源 CLI 一致。
- 每个 release tag 和 GitHub Release 指向获批 source SHA，Desktop / 扩展 artifact、架构、checksum 与候选清单一致。
- VS Code Marketplace、Open VSX 和 Chrome Web Store 的目标版本均可独立确认。
- Cloudflare 与 Vercel 的 dev / production 分别返回精确版本和 build SHA；根入口和管理入口按各自契约可达。
- PWA、Avatar、Homepage 的下游 run 成功，线上入口可达并能追溯 source SHA。
- 要求本地安装时，CLI 和 Desktop 的已安装版本及真实启动 / 退出行为通过。
- 没有属于本次矩阵且仍在运行、失败未接手或缺少终态证据的任务 / workflow；所有已终止独立任务完成回调、核验和归档。

只有以上证据全部成立，主协调任务才能宣布一次协调式发布完成。局部绿色、执行者自报成功或“未发现错误”不能替代完整终态审计。
