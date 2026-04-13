# 搜索预算示例

## 好的模式

- 先选对 scope
- 设置最小但有用的 filter 集合
- 把 `budget.credits_requested` 设成真实上限
- 在放宽前先检查响应

## 当 Fabric 返回 `402 budget_cap_exceeded`

可以做以下之一：
- 提高 `budget.credits_requested`
- 收窄搜索
- 切换到更有针对性的浏览路径

不要把它当作“成功但结果被截断”的搜索。

## 当 Fabric 返回 `402 credits_exhausted`

可以做以下之一：
- 购买积分
- 停止并延后
- 改变策略，避免重复相同的失败计费动作
