---
description: 配置 Feishu channel 的 App ID、App Secret、allowlist。用于首次配置或修改凭据。
allowed-tools: Read, Write, Bash(mkdir *), Bash(chmod *)
---

你正在引导用户配置 Feishu channel 插件。采用交互式问答方式，逐步收集信息并帮用户完成配置。

状态目录：`~/.claude/channels/feishu`

---

## 交互流程

### Step 1：检查现有配置

先检查 `~/.claude/channels/feishu/.env` 是否已存在。如果已存在且包含 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`，告知用户当前已有配置（仅显示 App ID，不显示 Secret），询问是否要重新配置。

### Step 2：引导创建飞书应用

询问用户："你是否已经创建了飞书应用？"

**如果没有**，展示以下创建指引：

---

**1) 创建应用**

打开飞书开放平台创建企业自建应用：
- 飞书：<https://open.feishu.cn/app>
- 海外版 Lark：<https://open.larksuite.com/app>

点击 **"创建企业自建应用"** → 填写名称和描述 → **"创建"**

**2) 添加权限**

在应用页面进入 **"权限管理"** → 使用 **批量开通**（点击"批量切换为按依赖配置"），粘贴：

```json
{
  "scopes": {
    "tenant": [
      "im:message:send_as_bot",
      "im:message:readonly",
      "im:message.p2p_msg:readonly",
      "im:message.group_at_msg:readonly",
      "im:message:update",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:chat:read",
      "im:resource",
      "cardkit:card:write",
      "cardkit:card:read"
    ],
    "user": []
  }
}
```

如果批量导入不可用，在搜索框中逐个添加上述 scope。

**3) 启用机器人能力**

进入 **"添加应用能力"** → 启用 **"机器人"** → 设置机器人名称和描述

**4) 发布应用**

进入 **"版本管理与发布"** → **"创建版本"** → 填写版本号和说明 → **"保存"** → **"申请发布"** → 管理员在飞书管理后台审批

> 机器人在版本审批通过之前无法工作。

---

完成后，提示用户："请提供你的 App ID 和 App Secret。"

### Step 3：收集 App ID 和 App Secret

请用户提供：
- **App ID**：验证格式为 `cli_` 开头
- **App Secret**：验证长度为 32 字符

如果格式不对，友好提示并让用户重新输入。

### Step 4：询问域名（可选）

询问："你使用的是飞书（feishu）还是海外版 Lark？默认为飞书。"

- 飞书 → 不需要设置 `FEISHU_DOMAIN`
- Lark → `FEISHU_DOMAIN=https://open.larksuite.com`

### Step 5：配置 allowlist（可选）

询问："是否需要限制哪些用户可以通过飞书发消息给 Claude？（推荐开启，防止未授权用户使用）"

如果用户选择开启，引导获取 open_id：

**获取 open_id 的方式：**

1. **给机器人发消息** — 最简单的方式：在飞书中给机器人发送 `我的id` 或 `my id`，机器人会自动回复你的 open_id（无需在 allowlist 中即可使用）
2. **通过飞书管理后台** — 登录 [飞书管理后台](https://feishu.cn/admin) → 组织架构 → 成员管理 → 点击用户详情页查看
3. **通过 API 查询** — 使用通讯录 API `GET /open-apis/contact/v3/users/:user_id`，需要 `contact:user.base:readonly` 权限
4. **使用 lark-cli** — 如果已安装 lark-cli，可运行 `lark-cli contact search <姓名>` 查询

收集用户提供的 open_id 列表（格式 `ou_xxx`），验证每个 ID 以 `ou_` 开头。

### Step 6：写入配置文件

收集完所有信息后，执行以下操作：

1. 创建目录：
   ```
   mkdir -p ~/.claude/channels/feishu
   ```

2. 写入 `~/.claude/channels/feishu/.env`：
   ```
   FEISHU_APP_ID=<用户提供的值>
   FEISHU_APP_SECRET=<用户提供的值>
   ```
   如果用户选择了 Lark，追加：
   ```
   FEISHU_DOMAIN=https://open.larksuite.com
   ```
   如果用户提供了 allowlist，追加：
   ```
   FEISHU_ALLOWED_USER_IDS=ou_xxx,ou_yyy
   FEISHU_REQUIRE_ALLOWLIST=true
   ```

3. 设置文件权限：
   ```
   chmod 600 ~/.claude/channels/feishu/.env
   ```

4. 如果用户提供了 allowlist，同步写入 `~/.claude/channels/feishu/access.json`：
   ```json
   {
     "allowFrom": ["ou_xxx", "ou_yyy"]
   }
   ```

### Step 7：确认并提示下一步

配置完成后，输出摘要（仅显示 App ID，不显示 Secret），并提醒：

- 重启 Claude Code 会话：`claude --channels plugin:feishu@shidaxi`
- 在飞书中找到机器人发消息测试

---

## 安全要求

- 永远不要在终端回显完整的 `FEISHU_APP_SECRET`，收到后立即写入文件。
- 如果用户直接在消息中粘贴了 Secret，写入后提醒用户注意安全。
