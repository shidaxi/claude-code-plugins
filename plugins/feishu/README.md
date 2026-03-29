# Feishu Channel Plugin

一个基于 `@larksuiteoapi/node-sdk` 的 Claude Code Channel 插件，实现：

- Feishu 事件长连接接收消息（`im.message.receive_v1`）
- 将入站消息转成 Claude Channel 事件
- 暴露 `reply` 工具让 Claude 回消息到 Feishu
- 权限中继（Permission Relay）— 在飞书中审批 Claude 的工具调用请求
- 多 Profile 支持 — 同时运行多个飞书机器人

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

推荐使用交互式配置向导：

```text
/feishu:configure
```

向导会引导你完成应用创建、凭据填写和 allowlist 配置。

### 手动配置

配置文件路径：`~/.claude/channels/feishu/.env`

最小配置：

```bash
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
```

可选配置：

```bash
# 海外版 Lark 需要切换 domain，默认使用飞书
FEISHU_DOMAIN=https://open.larksuite.com

# 逗号分隔的允许用户 open_id 列表（也可写入 access.json）
FEISHU_ALLOWED_USER_IDS=ou_xxx,ou_yyy

# true = 必须在 allowlist 中才转发入站消息
FEISHU_REQUIRE_ALLOWLIST=true

# 开启调试日志
FEISHU_DEBUG=true
```

## 3) 配置飞书应用

在飞书开放平台应用后台：

1. 创建企业自建应用
2. 启用机器人能力
3. 添加权限（批量开通或逐个添加）：
   - `im:message:send_as_bot`
   - `im:message:readonly`
   - `im:message.p2p_msg:readonly`
   - `im:message.group_at_msg:readonly`
   - `im:message:update`
   - `im:message.reactions:read`
   - `im:message.reactions:write_only`
   - `im:chat:read`
   - `im:resource`
   - `cardkit:card:write`
   - `cardkit:card:read`
4. 订阅事件 `im.message.receive_v1`
5. 发布版本并完成管理员审批

插件使用 SDK 的 `WSClient` 长连接模式，不需要公网 webhook。

## 4) 启动 Channel

```bash
claude --channels plugin:feishu@shidaxi
```

开发态（研究预览）可使用：

```bash
claude --dangerously-load-development-channels plugin:feishu@shidaxi
```

## 5) 多 Profile 支持

Multi-profile 允许你同时运行多个飞书机器人实例，每个 profile 拥有独立的凭据、allowlist 和日志。

### 目录结构

```
~/.claude/channels/feishu/
├── .env                    # 默认 profile 的凭据
├── access.json             # 默认 profile 的 allowlist
├── feishu.log              # 默认 profile 的日志
└── profiles/
    ├── bot-a/
    │   ├── .env            # bot-a 的凭据
    │   ├── access.json     # bot-a 的 allowlist
    │   └── feishu.log      # bot-a 的日志
    └── bot-b/
        ├── .env            # bot-b 的凭据
        ├── access.json     # bot-b 的 allowlist
        └── feishu.log      # bot-b 的日志
```

### 配置指定 Profile

使用配置向导时可直接指定 profile 名称：

```text
/feishu:configure bot-a
```

或通过环境变量：

```bash
export FEISHU_PROFILE=bot-a
```

然后运行 `/feishu:configure`，向导会自动检测并配置该 profile。

### 启动指定 Profile

通过环境变量 `FEISHU_PROFILE` 指定：

```bash
FEISHU_PROFILE=bot-a claude --channels plugin:feishu@shidaxi
```

不设置 `FEISHU_PROFILE` 时使用默认 profile（`~/.claude/channels/feishu/`）。

### 同时运行多个 Profile

在不同终端窗口中分别启动：

```bash
# 终端 1 — 默认 profile
claude --channels plugin:feishu@shidaxi

# 终端 2 — bot-a
FEISHU_PROFILE=bot-a claude --channels plugin:feishu@shidaxi

# 终端 3 — bot-b
FEISHU_PROFILE=bot-b claude --channels plugin:feishu@shidaxi
```

每个实例连接各自的飞书机器人应用，互不干扰。启动后会在对应的飞书聊天中发送就绪通知，包含 profile 标签、工作目录和时间戳。

### 管理 Profile 的 Allowlist

```text
# 管理 bot-a 的 allowlist
/feishu:access list bot-a
/feishu:access add ou_xxx bot-a
/feishu:access remove ou_xxx bot-a
```

## 6) 暴露给 Claude 的工具

- `reply`
  - 参数：`chat_id`、`text`
  - 可选：`receive_id_type`（默认 `chat_id`）

## 7) Access 控制

默认逻辑：

- 若 `allowFrom` 非空：仅放行在列表内的 `open_id`
- 若 `allowFrom` 为空：
  - `FEISHU_REQUIRE_ALLOWLIST=true`：全部拒绝
  - 否则：全部放行（仅建议本地开发）

access 文件（路径取决于 profile）：

- 默认 profile：`~/.claude/channels/feishu/access.json`
- 命名 profile：`~/.claude/channels/feishu/profiles/<name>/access.json`

示例：

```json
{
  "allowFrom": ["ou_xxx", "ou_yyy"]
}
```

用户可在飞书中给机器人发送 `我的id` 或 `my id` 查询自己的 open_id（此命令无需在 allowlist 中即可使用）。

## 8) 权限中继（Permission Relay）

当 Claude 需要执行敏感工具调用时，会通过飞书发送交互式卡片，用户可直接在飞书中点击 "Allow" / "Deny" 按钮审批，或回复 `y <code>` / `n <code>` 文本进行审批。

## 9) 环境变量参考

| 变量 | 必填 | 说明 |
|------|------|------|
| `FEISHU_APP_ID` | 是 | 飞书应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 飞书应用 App Secret |
| `FEISHU_PROFILE` | 否 | Profile 名称，未设置时使用默认 profile |
| `FEISHU_DOMAIN` | 否 | API 域名，海外版设为 `https://open.larksuite.com` |
| `FEISHU_ALLOWED_USER_IDS` | 否 | 逗号分隔的 open_id allowlist |
| `FEISHU_REQUIRE_ALLOWLIST` | 否 | `true` 时强制要求 allowlist，空 allowlist 将拒绝所有消息 |
| `FEISHU_DEBUG` | 否 | `true` 开启调试日志输出到 stderr |
| `FEISHU_REACTION_EMOJI` | 否 | 已读回执 emoji，默认 `Get` |
| `FEISHU_STATE_DIR` | 否 | 自定义状态目录（覆盖 profile 路径计算） |
