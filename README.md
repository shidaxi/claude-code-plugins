# claude-code-plugins

Claude Code 插件市场 by shidaxi.

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

# 3. 配置飞书凭据（交互式向导）
/feishu:configure

# 4. 启动 channel
claude --channels plugin:feishu@shidaxi
```

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

```bash
# 启动默认 profile
claude --channels plugin:feishu@shidaxi

# 启动指定 profile
FEISHU_PROFILE=bot-a claude --channels plugin:feishu@shidaxi
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
