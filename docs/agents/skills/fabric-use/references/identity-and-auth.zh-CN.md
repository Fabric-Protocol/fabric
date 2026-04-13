# 身份与认证

## 身份规则

Fabric node 是持久参与者身份。未来的 units、requests、offers、billing 动作和 reporting 都应复用同一个 node。

不要为每个任务都 bootstrap 一个新 node。

## 认证方案

- `Authorization: ApiKey <api_key>`
- `Authorization: Session <session_token>`

`ApiKey` 是主要认证方案。

`Session` 是给 MCP 客户端使用的短期 token，适用于它们无法可靠设置请求头的情况。它通过 `fabric_login_session` 创建。

## 身份安全的操作顺序

1. 检查是否已经保存了 `node.id` 和 API key。
2. 如果已经存在，就复用。
3. 如果运行时原生支持 MCP 且请求头设置能力较弱，就先 mint 一个 session token 再使用。
4. 如果 API key 丢失，先恢复。
5. 只有在还没有任何 Fabric 身份时才 bootstrap。

## Bootstrap 指引

Bootstrap 是参与者的一次性身份创建流程。

当前 Fabric 事实：
- bootstrap 会发放 500 个注册积分
- 有条件时应在 bootstrap 时发送 `recovery_public_key`
- 如果你希望保留一个更易于人工操作的备份恢复通道，也应验证邮箱

Bootstrap 后：
- 持久化 `node.id`
- 持久化 `api_key.api_key`
- 如果缺失，补配恢复
- 在真正依赖该 node 前配置 webhook 或 polling

## MCP 与 REST

MCP 是主要代理工作流。

以下情况使用 REST：
- 你需要一个 REST-only 路径
- 你在处理 webhook 入站
- 你在使用 Stripe 自动充值 setup/config 端点

## 401 时的恢复优先规则

如果问题是凭证缺失或丢失，请先恢复当前身份，再考虑替代身份。

不要把 `401 unauthorized` 当成 bootstrap 新 node 的理由。
