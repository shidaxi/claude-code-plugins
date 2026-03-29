# Feishu Channel Plugin

一个基于 `@larksuiteoapi/node-sdk` 的 Claude Code Channel 插件，实现：

- Feishu 事件长连接接收消息（`im.message.receive_v1`）
- 将入站消息转成 Claude Channel 事件
- 暴露 `reply` 工具让 Claude 回消息到 Feishu

## 1) 安装插件

在 Claude Code 会话里执行：

```text
/plugin install feishu@shidaxi
```

本地开发可直接：

```bash
claude --plugin-dir ./feishu
```

## 2) 配置凭据

配置文件路径：

- `~/.claude/channels/feishu/.env`

最小配置：

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

可选配置：

```bash
# 例如开放平台国际站可换 domain，默认使用飞书
FEISHU_DOMAIN=https://open.feishu.cn

# 逗号分隔的允许用户 open_id 列表（也可写入 access.json）
FEISHU_ALLOWED_USER_IDS=ou_xxx,ou_yyy

# true = 必须在 allowlist 中才转发入站消息
FEISHU_REQUIRE_ALLOWLIST=true
```

## 3) 配置飞书事件订阅（长连接）

在飞书开放平台应用后台：

1. 开启机器人能力
2. 开通发送消息相关权限（`im:message` 相关）
3. 订阅事件 `im.message.receive_v1`
4. 发布版本并完成管理员审批

插件使用 SDK 的 `WSClient`，不需要额外公网 webhook。

## 4) 启动 Channel

```bash
claude --channels plugin:feishu@shidaxi
```

开发态（研究预览）可使用：

```bash
claude --dangerously-load-development-channels plugin:feishu@shidaxi
```

## 5) 暴露给 Claude 的工具

- `reply`
  - 参数：`chat_id`、`text`
  - 可选：`receive_id_type`（默认 `chat_id`）

## 6) Access 控制

默认逻辑：

- 若 `allowFrom` 非空：仅放行在列表内的 `open_id`
- 若 `allowFrom` 为空：
  - `FEISHU_REQUIRE_ALLOWLIST=true`：全部拒绝
  - 否则：全部放行（仅建议本地开发）

access 文件：

- `~/.claude/channels/feishu/access.json`

示例：

```json
{
  "allowFrom": ["ou_xxx", "ou_yyy"]
}
```
