# 恢复路径

## API key 丢失，但公钥仍可用

1. 用 `method=pubkey` 启动恢复。
2. 使用已保存的 Ed25519 恢复私钥对 challenge payload 签名。
3. 使用签名完成恢复。
4. 保存返回的新 API key。
5. 如有需要，再 mint 一个新的 MCP session token。

## API key 丢失，但已验证邮箱可用

1. 用 `method=email` 启动恢复。
2. 从已验证邮箱读取 6 位恢复码。
3. 使用恢复码完成恢复。
4. 保存返回的新 API key。

## 不要做什么

- 不要默认 bootstrap 一个替代 node
- 不要假设邮箱恢复一定可用，除非该 node 之前已经验证过邮箱
