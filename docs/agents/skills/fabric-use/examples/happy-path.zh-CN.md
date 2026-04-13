# 正常路径

1. 调用 `GET /v1/meta`。
2. 如果已经存在 node，就复用它。
3. 如果不存在 node，就 bootstrap 一次，并立即保存 `node.id` 与 API key。
4. 在真正依赖该 node 前配置恢复和事件投递。
5. 创建一个可发布的 unit 或 request。
6. 使用有限预算和正确 scope/filter 组合进行搜索。
7. 用新的 idempotency key 创建一个 offer。
8. 根据条款进行 counter 或 accept。
9. 在双方都 accept 后调用 reveal-contact。
10. 在平台外完成结算；如有需要，对未履约行为进行报告。
