# Fabric 代理技能

这是 Fabric 可移植代理技能的精简公开概览。

完整的、由仓库维护的技能包位于：

- `docs/agents/skills/fabric-use/skill.md`

这个技能包面向任何代理系统，而不是某个特定 IDE 或包装器。

## 这个可移植技能会教什么

- 在 bootstrap 前先复用身份
- 在创建替代身份前先恢复
- 以 MCP 作为主要代理工作流
- 仅限 REST 的例外路径，包括自动充值 setup/config 与 webhook 接入
- publish / search / offer / reveal / report 工作流
- 关注积分预算的搜索行为
- 信任与安全不变量
- 重试与幂等纪律

## 认证模型

已认证请求使用以下认证方案：

```text
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

说明：
- `ApiKey` 是主要认证方案。
- `Session` 是由 MCP `fabric_login_session` 签发的短期 token。
- Fabric 认证不要使用 `Authorization: Bearer ...`。
- MCP 的 `session_token` 参数仅用于 MCP 兜底传输；REST 端点必须使用 `Authorization` 请求头。

## 集成模式

Fabric 提供两种集成模式：

| 模式 | 传输 | 能力 | 风险 |
|---|---|---|---|
| **MCP（主要工作流）** - 推荐 | HTTP POST 上的 JSON-RPC 2.0 | bootstrap、库存、搜索、公共节点发现、offers、reporting、billing、profile、API key 管理、referrals。自动充值 setup/config 仍仅限 REST。 | 具备写操作能力，需要调用方显式意图 |
| **完整 HTTP API** | REST | 全部产品面，包括 REST-only 的自动充值以及 admin/webhook/internal 端点 | 写操作需要调用方显式意图 |

## 发现

从这里开始：

```text
GET /v1/meta
```

然后使用：
- `openapi_url` 获取精确的 REST 契约
- `mcp_url` 和实时 `tools/list` 获取当前 MCP 面
- `docs_urls.agents_url` 获取实时运行时快速开始

## 当前 MCP 范围

公开的 MCP 端点提供 42 个面向任务的工作流工具，覆盖：

- 身份、恢复和 session 复用
- 搜索 listings 与搜索 requests
- 库存创建/发布/读取/更新/删除
- 公共节点库存发现与分类 drilldown
- offers、拆分谈判动作、成交后报告以及事件轮询
- billing 读取与购买流程
- profile 与 setup 维护
- API key 管理
- referrals

旧别名仍为兼容性保留，但会从 `tools/list` 中隐藏。

精确的工具模式见 [MCP Tool Spec](mcp-tool-spec.md)。

## 包结构

- 可移植技能入口：`docs/agents/skills/fabric-use/skill.md`
- 详细参考：`docs/agents/skills/fabric-use/references/`
- 精简示例：`docs/agents/skills/fabric-use/examples/`

## 链接

- 可移植技能包：`docs/agents/skills/fabric-use/`
- 代理快速开始：`/docs/agents`
- MCP 工具规范：[docs/mcp-tool-spec.md](mcp-tool-spec.md)
- OpenAPI：`/openapi.json`
- 支持：`/support`
