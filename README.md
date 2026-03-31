# claude-code-plugins

Claude Code 插件市场 by shidaxi.

## 前置依赖

- [Bun](https://bun.sh/) — 插件运行时（用于安装依赖和执行 TypeScript）
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — `claude` 命令行工具

## 插件列表

| 插件 | 说明 | 版本 |
|------|------|------|
| [feishu](./plugins/feishu/) | 飞书/Lark channel — WebSocket 长连接收发消息 | 0.1.0 |

## 安装

```bash
# 1. 添加 marketplace
/plugin marketplace add shidaxi/claude-code-plugins

# 2. 安装飞书插件
/plugin install feishu@shidaxi

# 3. 在飞书开放平台配置应用（见下方「飞书应用配置」）

# 4. 配置飞书凭据（交互式向导）
/feishu:configure

# 5. 启动 channel
claude --channels plugin:feishu@shidaxi
```

## 飞书应用配置

在 [飞书开放平台](https://open.feishu.cn/app) 创建并配置应用：

1. **创建应用** — 创建企业自建应用
2. **启用机器人** — 在「应用能力」中开启「机器人」
3. **添加权限** — 在「权限管理」中开通以下权限：
   - `im:message:send_as_bot` — 发送消息
   - `im:message:readonly` — 读取消息
   - `im:message.p2p_msg:readonly` — 读取单聊消息
   - `im:message.group_at_msg:readonly` — 读取群 @消息
   - `im:message:update` — 更新消息
   - `im:message.reactions:read` — 读取表情回复
   - `im:message.reactions:write_only` — 写表情回复
   - `im:chat:read` — 读取群信息
   - `im:resource` — 读取资源
   - `cardkit:card:write` — 写交互卡片
   - `cardkit:card:read` — 读交互卡片
4. **配置事件订阅** — 在「事件与回调」页面：
   - **回调配置**：选择 **使用长连接接收事件**（而非 Webhook，无需公网 IP）
   - **添加事件**：
     - `im.message.receive_v1` — 接收消息（机器人收到用户消息时触发）
     - `card.action.trigger` — 卡片交互回调（用户点击权限审批卡片的 Allow/Deny 按钮时触发）
5. **发布版本** — 创建版本并提交管理员审批

## 多 Profile 启动

飞书插件支持同时运行多个机器人实例，每个 profile 拥有独立的凭据和配置。

### 配置多个 Profile

```bash
# 配置默认 profile
/feishu:configure

# 配置命名 profile（如 bot-a、bot-b）
/feishu:configure bot-a
/feishu:configure bot-b
```

### 启动单个 Profile

⚠️ 非official marketplace 的 channel plugin，需要使用 `--dangerously-load-development-channels` 而不是 `--channels`

```bash
# 启动默认 profile
claude --dangerously-load-development-channels plugin:feishu@shidaxi

# 启动指定 profile
FEISHU_PROFILE=bot-a claude --dangerously-load-development-channels plugin:feishu@shidaxi
```

### 同时启动多个 Profile

在不同终端窗口中分别启动即可：

```bash
# 终端 1
claude --dangerously-load-development-channels plugin:feishu@shidaxi

# 终端 2
FEISHU_PROFILE=bot-a claude --dangerously-load-development-channels plugin:feishu@shidaxi

# 终端 3
FEISHU_PROFILE=bot-b claude --dangerously-load-development-channels plugin:feishu@shidaxi
```

每个实例连接各自的飞书应用，互不干扰。详细配置见 [feishu 插件文档](./plugins/feishu/README.md#5-多-profile-支持)。

## 手动注册市场

如需手动注册，在 `~/.claude/settings.json` 的 `extraKnownMarketplaces` 中添加：

```json
{
  "shidaxi": {
    "source": {
      "source": "github",
      "repo": "shidaxi/claude-code-plugins"
    }
  }
}
```
