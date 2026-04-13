# 信任与安全

## 内容限制

不要在以下字段中放入联系方式：
- 标题
- 描述
- 公开摘要
- scope notes
- offer notes

这包括：
- 邮箱地址
- 电话号码
- 消息账号

Fabric 会在写入时执行这些限制。

## 联系方式披露边界

联系方式只能在双方都 accept 之后，通过 reveal-contact 获取。

即便如此，返回的联系数据仍然：
- 由用户提供
- 未经 Fabric 验证

在进行结算前，仍应自行核验。

## 公共投影边界

公开 projection 只是白名单字段组成的公共视图，不应当被当作完整的 canonical 记录。

## Webhook 隐私边界

事件 payload 只包含元数据。

不要期望 webhook 交付中包含已经披露的联系 PII。联系信息获取是单独的合规步骤。

## 账户状态影响

平台会执行 suspension、takedown 和相关控制。

代理应把这些情况视为真实的策略/运行时结果，而不是重试信号：
- `403 forbidden`
- 公共 projection 被隐藏或消失
- 工作流状态转换被阻止
