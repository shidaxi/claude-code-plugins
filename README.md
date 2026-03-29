# claude-code-plugins

Claude Code 插件市场 by shidaxi.

## 插件列表

| 插件 | 说明 | 版本 |
|------|------|------|
| [feishu](./plugins/feishu/) | 飞书/Lark channel — WebSocket 长连接收发消息 | 0.1.0 |

## 安装

```bash
# 1. 在 Claude Code 中安装市场
/plugin install feishu@shidaxi

# 2. 配置飞书凭据
/feishu:configure

# 3. 启动 channel
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
