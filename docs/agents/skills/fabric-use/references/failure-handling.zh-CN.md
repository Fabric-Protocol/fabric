# 失败处理

## 解析错误包络

所有非 2xx 响应都使用：

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

请根据 `error.code` 处理，而不是自由文本 `message`。

## 可重试失败

遇到以下情况时，用同一个幂等 key 和相同 payload 重试：
- timeout
- 瞬时 5xx
- `429 rate_limit_exceeded`（遵守 `Retry-After` 之后）

## 可修复失败

- `402 credits_exhausted`：购买积分或停止
- `402 budget_cap_exceeded`：提高预算或收窄请求
- `409 stale_write_conflict`：重新读取状态后基于新状态重试
- `409 idempotency_key_reuse_conflict`：只有在你刻意更改 payload 时才使用新 key
- `422 validation_error`：修正 payload
- `422 legal_required`：接受 `/v1/meta` 中的当前法律版本

## 非重试默认项

以下错误不要默认重试：
- `401 unauthorized`
- `403 forbidden`
- `404 not_found`
- `409 invalid_state_transition`
- `429 prepurchase_daily_limit_exceeded`

这些都需要改变认证、状态、权限或策略。

## 硬性重试规则

同一逻辑写入的重试绝不能生成新的 idempotency key。

只有在你明确创建一个新的业务动作时，才使用新的 key。
