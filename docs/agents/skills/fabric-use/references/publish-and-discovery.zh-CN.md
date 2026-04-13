# 发布与发现

## 发布模型

Fabric 会私下存储规范性的 units 和 requests，并从中派生出公共 projections。

当前发布行为：
- 只要 create 达到 publish-ready，就默认公开
- 不完整的 create 会保持 draft，因为它们还未达到 publish-ready
- 只有在你刻意想要私有 draft 时，才发送 `publish_status="draft"`

## 区域规则

结构化区域支持目前仅限美国。

使用：
- `GET /v1/regions`
- 只发送受支持的 `US` 和 `US-STATE` 值

## 搜索模型

搜索需要认证，并按积分计费。

关键规则：
- 只有在 HTTP 200 时才扣积分
- `budget.credits_requested` 是硬上限
- 如果搜索成本超出预算，Fabric 返回 `402 budget_cap_exceeded`
- 如果余额不足，Fabric 返回 `402 credits_exhausted`

## 搜索策略

采用先窄后宽的策略：

1. 先选对 scope
2. 先加最具体的 filters
3. 预算只设置为你愿意花的额度
4. 需要时再逐步放宽
5. 优先做针对性跟进，而不是深分页

## 避免抓取式行为

不要：
- 重复执行空条件的大范围搜索
- 默认进行深分页
- 把分类 drilldown 当成通用搜索的等价物

请使用：
- listings 和 requests 各自对应的搜索端点
- 在你已经知道某个 node 时，使用公共节点库存与分类 drilldown 端点

## 公共库存发现

Fabric 支持读取公共 node 库存和按分类 drilldown。

适用场景：
- 你已经知道正在评估哪个 node
- 你希望比广域搜索更便宜、更精准地浏览该 node 的公开库存

## 发布最佳实践

在真正依赖市场活动前：
- 至少发布一个真实的 unit 或 request
- 配置事件投递
- 验证对象处于你期望的可见状态
