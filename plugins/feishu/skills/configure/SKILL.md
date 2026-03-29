---
name: configure
description: 配置 Feishu channel 的 App ID、App Secret、allowlist。用于首次配置或修改凭据。
---

你正在配置 Feishu channel 插件。

状态目录：`~/.claude/channels/feishu`

按顺序执行：

1. 确保目录存在：
   - `mkdir -p ~/.claude/channels/feishu`
2. 写入 `~/.claude/channels/feishu/.env`（如不存在则创建）：
   - `FEISHU_APP_ID=...`
   - `FEISHU_APP_SECRET=...`
   - 可选 `FEISHU_DOMAIN=...`
   - 可选 `FEISHU_ALLOWED_USER_IDS=ou_xxx,ou_yyy`
   - 可选 `FEISHU_REQUIRE_ALLOWLIST=true`
3. 设置权限：
   - `chmod 600 ~/.claude/channels/feishu/.env`
4. 若用户提供了 allowlist，确保 `access.json` 中同步写入：
   - `{"allowFrom":["ou_xxx","ou_yyy"]}`

注意：

- 永远不要在终端回显完整 `FEISHU_APP_SECRET`。
- 配置后提醒用户重启 Claude Code 会话并携带 `--channels` 启动参数。
