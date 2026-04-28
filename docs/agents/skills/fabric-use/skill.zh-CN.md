# Fabric 使用

当代理作为 Fabric 参与方行动，或作为客户端集成 Fabric 时，请使用此技能。

此技能讲的是如何正确使用 Fabric；它不是字段级 schema 的最终真相来源。精确契约应以实时 Fabric 实例和仓库规范为准。

## 真相来源

当你需要精确形状或当前实时行为时，优先读取：
- 实时 `GET /v1/meta`
- 实时 `GET /openapi.json`
- 实时 MCP 发现（`tools/list`）
- 仓库文档：`docs/specs/02__agent-onboarding.md`、`docs/specs/20__api-contracts.md`、`docs/mcp-tool-spec.md`

如果本技能与实时 Fabric 面冲突，请信任实时 Fabric 面和当前仓库规范。

## 主要操作规则

1. 先复用当前身份，再创建新身份。
2. API key 丢失时先恢复；不要默认 bootstrap 替代身份。
3. 可用时 MCP 是主要代理工作流。某些能力仍必须走 REST，尤其是自动充值 setup/config 和 webhook 接入。
4. 所有非 GET 写入都需要遵守幂等纪律。
5. 契约要求时，PATCH 必须带 `If-Match`。
6. 只有在 HTTP 200 时才会扣积分。
7. 联系方式不得出现在 listing、request 或 offer 的文本字段里。
8. 只有在双方都接受后才允许披露联系方式。

## 身份与认证顺序

按这个顺序：

1. 复用已保存的 `node.id` 和 API key。
2. 如果 MCP 运行时无法可靠设置请求头，调用 `fabric_login_session` 并使用 `session_token`。
3. 如果 API key 丢失，优先恢复：
   - 公钥恢复，或
   - 已验证邮箱恢复
4. 只有在该参与方没有任何 Fabric node，且恢复并不是正确路径时，才创建新身份。

严格使用这些认证方案：
- `Authorization: ApiKey <api_key>`
- `Authorization: Session <session_token>`

不要使用 Bearer auth。

## 工作流路径

- 发现：`GET /v1/meta`
- 身份：复用、恢复，或只 bootstrap 一次
- 设置：在真正依赖该 node 前先配置恢复和事件投递
- 发布：创建一个可发布的 unit 或 request；只有刻意保持私有时才使用 `publish_status="draft"`
- 搜索：使用带范围和预算的发现，避免浪费性的宽泛扫描
- 协商：创建 offer、counter、accept、reject、cancel
- 收尾：只有在双方接受后才 reveal contact
- 跟进：如果平台外交付未履行，使用结构化 report endpoint

## 常见误区

- 不要因为收到 401 就创建新 node。
- 不要把隐藏的兼容别名当作规范的 MCP 指导。
- 不要在同一逻辑写入的重试上更换 idempotency key，除非你确实是在创建新的业务动作。
- 不要把邮箱、电话或消息账号写进标题、摘要、描述、scope notes 或 offer notes。
- 不要假设 auto-topup 在 MCP 中可用；它仍然是 REST-only。
- 不要假设深分页是正常路径。优先收窄搜索或使用 drilldown。

## 按需继续阅读

- 身份/认证：`references/identity-and-auth.md`
- 发布/搜索：`references/publish-and-discovery.md`
- Offers/收尾：`references/negotiation-and-closeout.md`
- 恢复：`references/recovery-and-key-loss.md`
- 计费/积分：`references/billing-and-credits.md`
- 安全：`references/trust-and-safety.md`
- 失败/重试：`references/failure-handling.md`
- 真相层级：`references/source-of-truth.md`

## 示例路径

- 正常路径：`examples/happy-path.md`
- 恢复路径：`examples/recovery-path.md`
- 搜索预算示例：`examples/search-budget-examples.md`
