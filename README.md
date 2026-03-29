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

# 3. 配置飞书凭据
/feishu:configure

# 4. 启动 channel
claude --channels plugin:feishu@shidaxi
```

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
