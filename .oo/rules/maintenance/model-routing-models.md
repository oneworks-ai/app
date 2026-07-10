# 模型能力、速度与消耗基线

本文保存 [`model-routing.md`](./model-routing.md) 使用的模型比较基线。模型和费率会变化，实际分配前仍需检查当前线程工具 schema 和官方信息。

OpenAI 当前把 Sol 定位为旗舰复杂任务模型，Terra 定位为日常均衡模型，Luna 定位为清晰、可重复和高吞吐任务模型；GPT-5.5 是上一代复杂工作模型，GPT-5.4 / GPT-5.4 Mini 仍可用于日常与轻量编码。官方 Codex 模型页给出的能力 / 速度是相对档位，不是固定延迟或 tokens/s 保证：

| 模型                             | 官方相对能力 | 官方相对速度 | Codex 单位 token 消耗（Luna = 1） | 推荐定位                                                            |
| -------------------------------- | ------------ | ------------ | --------------------------------- | ------------------------------------------------------------------- |
| GPT-5.6 Sol（`gpt-5.6-sol`）     | 5 / 5        | 2 / 5        | 5×                                | 复杂、开放、高价值、需要深度判断和最终打磨                          |
| GPT-5.5（`gpt-5.5`）             | 4 / 5        | 3 / 5        | 5×                                | 上一代复杂工作模型；用于 Codex cloud、既有验证基线或 5.6 不可用场景 |
| GPT-5.6 Terra（`gpt-5.6-terra`） | 4 / 5        | 3 / 5        | 2.5×                              | 日常开发、工具协作、既有模式内的工程实现；新任务的默认日常档        |
| GPT-5.4（`gpt-5.4`）             | 3 / 5        | 3 / 5        | 2.5×                              | 5.6 不可用、需要兼容或复现既有行为时的日常工作档                    |
| GPT-5.6 Luna（`gpt-5.6-luna`）   | 3 / 5        | 4 / 5        | 1×                                | 明确、重复、低风险、强验收和高吞吐工作                              |
| GPT-5.4 Mini（`gpt-5.4-mini`）   | 2 / 5        | 4 / 5        | 0.75×                             | 最便宜的纯机械编码、固定转换、烟测和窄子任务                        |

当前公开 Codex credits 费率如下，单位为每 1M tokens：

| 模型          |          输入 |      缓存输入 |        输出 |
| ------------- | ------------: | ------------: | ----------: |
| GPT-5.6 Sol   |   125 credits |  12.5 credits | 750 credits |
| GPT-5.6 Terra |  62.5 credits |  6.25 credits | 375 credits |
| GPT-5.6 Luna  |    25 credits |   2.5 credits | 150 credits |
| GPT-5.5       |   125 credits |  12.5 credits | 750 credits |
| GPT-5.4       |  62.5 credits |  6.25 credits | 375 credits |
| GPT-5.4 Mini  | 18.75 credits | 1.875 credits | 113 credits |

任务实际总消耗仍取决于上下文长度、reasoning、输出量、工具结果、重试次数和是否启用 fast / ultra；不能只看单 token 价格。对大量纯机械任务，GPT-5.4 Mini 成本最低；需要更强 agent / 工具能力的结构化子任务优先 Luna；对需要多次返工的任务，错误选用低档模型可能比一次使用 Terra 或 Sol 更贵。

横向比较得到以下默认结论：

- **Sol 对 GPT-5.5**：单位 token 同价；Sol 官方能力更高但相对速度更慢。开放式高难任务优先 Sol；GPT-5.5 保留给 Codex cloud、既有工作流基线、延迟敏感且已实测可靠的复杂任务，或 5.6 不可用场景。
- **Terra 对 GPT-5.4**：单位 token 同价且官方相对速度相同，Terra 官方能力更高。新日常开发默认 Terra；GPT-5.4 只在可用性、兼容性、复现旧行为或代表性评测证明它更合适时使用。
- **Luna 对 GPT-5.4**：官方相对能力相同，Luna 更快且单位 token 费率低 60%。明确、重复和高吞吐任务默认 Luna，不再默认 GPT-5.4。
- **GPT-5.4 Mini 对 Luna**：两者官方相对速度相同，Mini 单位 token 费率低约 25%，但能力低一档。纯机械、单命令和固定转换先用 Mini；需要稳定工具协作、多步执行或更强指令遵循时用 Luna。
- 旧模型不是禁止项。仓库对某类任务已有真实成功率、延迟和总成本数据时，以代表性评测覆盖上述默认路由；不要只因为模型更新就丢掉已验证的可靠路径。

公开评测提供以下方向性证据：

- OpenAI 报告 Sol 在 Terminal-Bench 2.1 的命令行 agent 工作流上达到当时最佳结果，并在 GeneBench v1 以少于 GPT-5.5 的 tokens 获得更强结果；这支持把长链路、开放式和工具协调任务交给 Sol，但不能推导为所有任务都更优。
- OpenAI 将 Terra 描述为性能可与 GPT-5.5 竞争但成本减半的日常模型；系统卡中的部分调试与研究任务也显示 Sol / Terra 相对旧模型有提升。
- 系统卡在 ExploitGym 这一特定安全评测上观察到 Luna 大致落在 GPT-5.4 档、Terra 大致落在 GPT-5.5 档、Sol 位于性能 / 输出 token 前沿。该结果只作为相对能力证据，不能直接外推到所有开发任务。
- 系统卡指出，更大的模型在复杂任务中避免编辑冲突的表现通常好于 Terra / Luna，因此复杂合并、重叠写入和不可逆操作不能只因为步骤看起来机械就降级。
- METR 对 Sol 的独立预部署评测认为长任务 time-horizon 估计高度不确定，并观察到作弊与隐藏行为；因此即使使用 Sol，也必须保留明确授权边界、外部验证和主线程审阅，不能把模型档位当成正确性保证。

目前没有足够统一、独立且同一运行环境下的公开数据，可以把三者写成稳定的首 token 延迟或 tokens/s 数值。规则只采用官方相对速度档位；不要拿特定预览、Cerebras 专用通道或单个用户体验数字当作本仓通用速度保证。

## 信息来源与维护

- [Codex 模型选择：Sol、Terra、Luna 的定位、相对能力和速度](https://learn.chatgpt.com/docs/models)
- [GPT-5.6 最新模型与从 GPT-5.5 / GPT-5.4 迁移建议](https://developers.openai.com/api/docs/guides/latest-model)
- [Codex credits 当前费率](https://learn.chatgpt.com/docs/pricing#what-are-tokens-and-credits)
- [OpenAI GPT-5.6 发布与公开能力评测](https://openai.com/index/previewing-gpt-5-6-sol/)
- [GPT-5.6 Preview System Card](https://deploymentsafety.openai.com/gpt-5-6-preview)
- [METR 对 GPT-5.6 Sol 的独立预部署评测](https://metr.org/blog/2026-06-26-gpt-5-6-sol/)

更新本规则时优先使用官方当前模型页和费率页；独立评测只用于补充不确定性和外部验证，不用单一榜单覆盖仓库自己的代表性任务评测。模型、费率或速度档位变化时同步更新表格和路由建议。
