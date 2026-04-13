# 真相来源

## 真相顺序

判断 Fabric 当前支持什么时，请按以下顺序：

1. 来自实时 `GET /v1/meta` 的实例元数据
2. 来自实时 `GET /openapi.json` 的 OpenAPI
3. 来自实时 `tools/list` 的 MCP 发现
4. 仓库中的真相来源文档：
   - `docs/specs/02__agent-onboarding.md`
   - `docs/specs/20__api-contracts.md`
   - `docs/mcp-tool-spec.md`

## 冲突规则

如果可移植技能文件、旧示例或过时 wrapper 与实时 Fabric 面冲突，请相信实时 Fabric 面和当前仓库规范。

## 为什么这很重要

Fabric 会演进。技能是指导层，不是协议本身。

技能负责告诉代理应当如何行动，而精确的 endpoint 形状、tool schema 和运行时行为属于当前的真相来源。
