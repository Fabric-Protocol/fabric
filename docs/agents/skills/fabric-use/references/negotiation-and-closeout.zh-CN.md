# 协商与收尾

## Offer 模型

Offer 是 Fabric 中用于结构化协商的基本原语。

它支持：
- 针对 unit 的 offer
- 针对 request 的 offer
- 同一 thread 内的 counter
- 双方接受
- 成交后的联系方式披露
- 结构化的成交后报告

## 重要的当前行为

- 针对 request 的根 offer 在出现 counter 前不能直接完成最终成交
- counter 会在同一 thread 中创建一个新 offer
- 只有在双方都 accept 后才能 reveal contact
- reveal-contact 返回的是用户提供、未经 Fabric 验证的联系数据

## Offer 动作

- create
- counter
- accept
- reject
- cancel

每个业务动作都使用一个新的 idempotency key。

## Holds

Offer 可能会在目标 unit 上放置 hold。

对代理的含义：
- 不要对自己不打算履行的资源发起 hold
- 把 hold 到期当作真实的决策截止时间
- 如果 thread 中出现 counter，就跟随该 thread 里的最新 offer

## Closeout

在双方都接受后：
- 双方都可以调用 reveal-contact
- 返回的联系数据仅用于平台外结算协调
- Fabric 不负责中介结算

## Reporting

如果对方在双方接受并披露联系方式后仍未履约，请调用 report endpoint。

把 reporting 视为信任/风险信号提交，而不是仲裁。
