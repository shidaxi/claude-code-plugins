#!/usr/bin/env bun
/**
 * Feishu/Lark channel for Claude Code.
 *
 * Inbound: Feishu event subscription (long-connection mode) -> channel events.
 * Outbound: Claude tool call `reply` -> Feishu IM message API.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as lark from "@larksuiteoapi/node-sdk";
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR =
  process.env.FEISHU_STATE_DIR ?? join(homedir(), ".claude", "channels", "feishu");
const ENV_FILE = join(STATE_DIR, ".env");
const ACCESS_FILE = join(STATE_DIR, "access.json");
const LOG_FILE = join(STATE_DIR, "feishu.log");
const LAST_CHAT_ID_FILE = join(STATE_DIR, "last_chat_id");

function fileLog(message: string): void {
  const ts = new Date().toISOString();
  appendFileSync(LOG_FILE, `[${ts}] ${message}\n`);
}

loadDotEnv(ENV_FILE);

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const DOMAIN = process.env.FEISHU_DOMAIN;
const DEBUG = process.env.FEISHU_DEBUG === "true";

if (!APP_ID || !APP_SECRET) {
  process.stderr.write(
    "feishu channel: FEISHU_APP_ID and FEISHU_APP_SECRET are required\n" +
      ` set in ${ENV_FILE}\n` +
      " format:\n" +
      " FEISHU_APP_ID=cli_xxx\n" +
      " FEISHU_APP_SECRET=xxx\n"
  );
  process.exit(1);
}

const requireAllowlist = process.env.FEISHU_REQUIRE_ALLOWLIST === "true";
const access = loadAccess();
if (requireAllowlist && access.allowFrom.length === 0) {
  process.stderr.write(
    "feishu channel: FEISHU_REQUIRE_ALLOWLIST=true but allowFrom is empty; all inbound messages will be dropped\n"
  );
}

process.on("unhandledRejection", (err) => {
  process.stderr.write(`feishu channel: unhandled rejection: ${String(err)}\n`);
});
process.on("uncaughtException", (err) => {
  process.stderr.write(`feishu channel: uncaught exception: ${String(err)}\n`);
});

debugLog(
  `boot config: app_id=${mask(APP_ID)} domain=${DOMAIN || "default"} allowlist_size=${
    access.allowFrom.length
  } require_allowlist=${String(requireAllowlist)}`
);

const baseConfig: {
  appId: string;
  appSecret: string;
  domain?: string;
} = {
  appId: APP_ID,
  appSecret: APP_SECRET,
};
if (DOMAIN) {
  baseConfig.domain = DOMAIN;
}

// The Lark SDK's default logger uses console.log/console.info which write to
// stdout. Since MCP uses stdio (JSON-RPC over stdout/stdin), any non-JSON-RPC
// output on stdout corrupts the protocol. Redirect all SDK logs to stderr.
const stderrLogger = {
  error(...msg: unknown[]) {
    process.stderr.write(`[error]: ${msg.map(String).join(" ")}\n`);
  },
  warn(...msg: unknown[]) {
    process.stderr.write(`[warn]: ${msg.map(String).join(" ")}\n`);
  },
  info(...msg: unknown[]) {
    process.stderr.write(`[info]: ${msg.map(String).join(" ")}\n`);
  },
  debug(...msg: unknown[]) {
    process.stderr.write(`[debug]: ${msg.map(String).join(" ")}\n`);
  },
  trace(...msg: unknown[]) {
    process.stderr.write(`[trace]: ${msg.map(String).join(" ")}\n`);
  },
};

const client = new lark.Client({ ...baseConfig, logger: stderrLogger });
const wsClient: any = new lark.WSClient({
  ...baseConfig,
  loggerLevel: lark.LoggerLevel.info,
  logger: stderrLogger,
});

// Track pending "GET" reactions so we can remove them when Claude replies.
// Key: chat_id, Value: array of {messageId, reactionId} awaiting reply.
const pendingReactions = new Map<
  string,
  ReadonlyArray<{ readonly messageId: string; readonly reactionId: string }>
>();

const REACTION_EMOJI = process.env.FEISHU_REACTION_EMOJI ?? "Get";

// Permission-relay: 5 lowercase letters a-z minus 'l' (avoids l/1/I confusion).
// Case-insensitive for phone autocorrect. Matches "y xxxxx" / "yes xxxxx" / "n xxxxx" / "no xxxxx".
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i;

// Stores full permission details keyed by request_id for "See more" expansion.
const pendingPermissions = new Map<
  string,
  { readonly tool_name: string; readonly description: string; readonly input_preview: string }
>();

// Helper to send a text message to a Feishu chat.
async function sendText(chatId: string, text: string): Promise<void> {
  await client.im.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

// Send a startup notification to the last known chat.
let startupNotified = false;
function notifyStartup(): void {
  if (startupNotified) return;
  const chatId = readLastChatId();
  if (!chatId) return;
  startupNotified = true;
  sendText(chatId, "✅ Claude Code 已就绪，可以发消息了").catch((err) => {
    fileLog(`startup notification failed: ${String(err)}`);
  });
  fileLog(`startup notification sent to chat_id=${chatId}`);
}

function readLastChatId(): string {
  try {
    return readFileSync(LAST_CHAT_ID_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

function saveLastChatId(chatId: string): void {
  try {
    writeFileSync(LAST_CHAT_ID_FILE, chatId, { mode: 0o600 });
  } catch {}
}

const mcp = new Server(
  { name: "feishu", version: "0.1.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        // Permission-relay opt-in: allows Claude Code to forward tool approval
        // prompts to Feishu so users can approve/deny remotely via card buttons.
        // Safe because gate (shouldDeliver/allowFrom) already drops non-allowlisted senders.
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions: [
      "Messages from Feishu arrive as <channel source=\"feishu\" ...>.",
      "To send a response to Feishu users, always call the reply tool with the same chat_id.",
      "The user reads messages in Feishu, not this terminal. Plain transcript text is not delivered unless you call reply.",
      "Feishu bots cannot read full chat history in this channel; if older context is needed, ask the user to paste it.",
    ].join("\n"),
  }
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a text reply to Feishu chat.",
      inputSchema: {
        type: "object",
        properties: {
          chat_id: {
            type: "string",
            description: "Feishu chat_id from inbound channel message meta.",
          },
          text: {
            type: "string",
            description: "Text to send.",
          },
          receive_id_type: {
            type: "string",
            enum: ["chat_id", "open_id", "union_id", "user_id", "email"],
            description:
              "Feishu receive_id_type. Default is chat_id. For channel relay, keep chat_id.",
          },
        },
        required: ["chat_id", "text"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  if (req.params.name !== "reply") {
    return {
      content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
      isError: true,
    };
  }

  try {
    const receiveId = String(args.chat_id ?? "");
    const text = String(args.text ?? "");
    const receiveIdType = asReceiveIdType(args.receive_id_type);

    if (!receiveId) throw new Error("chat_id is required");
    if (!text) throw new Error("text is required");

    const res: any = await client.im.v1.message.create({
      params: {
        receive_id_type: receiveIdType,
      },
      data: {
        receive_id: receiveId,
        msg_type: "interactive",
        content: JSON.stringify({
          config: { wide_screen_mode: true },
          elements: [{ tag: "markdown", content: text }],
        }),
      },
    });

    const messageId = res?.data?.message_id ?? "unknown";

    // Remove pending "GET" reactions for this chat (best-effort, non-blocking).
    const reactions = pendingReactions.get(receiveId);
    if (reactions && reactions.length > 0) {
      pendingReactions.delete(receiveId);
      Promise.allSettled(
        reactions.map((r) =>
          client.im.messageReaction.delete({
            path: { message_id: r.messageId, reaction_id: r.reactionId },
          })
        )
      ).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            debugLog(`failed to remove reaction: ${String(result.reason)}`);
          }
        }
      });
    }

    return {
      content: [{ type: "text", text: `sent (message_id: ${messageId})` }],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `reply failed: ${msg}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Permission relay: receive permission_request from Claude Code, send
// interactive card with Allow/Deny buttons to all allowlisted users.
// ---------------------------------------------------------------------------

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
});

function buildPermissionCard(
  requestId: string,
  toolName: string,
  description: string,
  inputPreview: string,
): Record<string, unknown> {
  let prettyInput: string;
  try {
    prettyInput = JSON.stringify(JSON.parse(inputPreview), null, 2);
  } catch {
    prettyInput = inputPreview;
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `🔐 ${description}` },
      template: "orange",
    },
    elements: [
      {
        tag: "markdown",
        content: `**Tool:** \`${toolName}\`\n\`\`\`\n${prettyInput}\n\`\`\``,
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "✅ Allow" },
            type: "primary",
            value: { action: "allow", request_id: requestId },
          },
          {
            tag: "button",
            text: { tag: "plain_text", content: "❌ Deny" },
            type: "danger",
            value: { action: "deny", request_id: requestId },
          },
        ],
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: `y ${requestId} / n ${requestId}`,
          },
        ],
      },
    ],
  };
}

mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const { request_id, tool_name, description, input_preview } = params;
  pendingPermissions.set(request_id, { tool_name, description, input_preview });
  debugLog(`permission_request received: id=${request_id} tool=${tool_name}`);

  const cardJson = buildPermissionCard(request_id, tool_name, description, input_preview);
  const cardContent = JSON.stringify(cardJson);
  const lastChatId = readLastChatId();

  // Send to last known chat if available; otherwise DM each allowlisted user.
  // Avoid sending both to prevent duplicate cards for users in the group chat.
  if (lastChatId) {
    client.im.v1.message
      .create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: lastChatId,
          msg_type: "interactive",
          content: cardContent,
        },
      })
      .catch((err) => {
        fileLog(`permission card send failed (chat): ${String(err)}`);
      });
  } else {
    // No active chat — DM each allowlisted user as fallback.
    for (const openId of access.allowFrom) {
      client.im.v1.message
        .create({
          params: { receive_id_type: "open_id" },
          data: {
            receive_id: openId,
            msg_type: "interactive",
            content: cardContent,
          },
        })
        .catch((err) => {
          debugLog(`permission card DM to ${openId} failed: ${String(err)}`);
        });
    }
  }
});

await mcp.connect(new StdioServerTransport());
fileLog("mcp transport connected");

// Wait for Claude Code to finish MCP initialization (listTools, etc.)
// before connecting to Feishu, so the first inbound message isn't lost.
await new Promise((r) => setTimeout(r, 2000));
fileLog("post-connect delay done, starting WS client");

const dispatcher = new lark.EventDispatcher({
  logger: stderrLogger,
}).register({
  "im.message.receive_v1": async (event: any) => {
    fileLog("im.message.receive_v1 event fired");
    process.stderr.write("feishu channel: im.message.receive_v1 event fired\n");
    try {
      const senderOpenId =
        event?.sender?.sender_id?.open_id ??
        event?.sender?.sender_id?.user_id ??
        "";
      const deliver = shouldDeliver(senderOpenId, access.allowFrom, requireAllowlist);
      debugLog(
        `inbound event: sender=${senderOpenId || "unknown"} message_type=${
          event?.message?.message_type ?? "unknown"
        } chat_id=${event?.message?.chat_id ?? "unknown"} deliver=${String(deliver)}`
      );

      const message = event?.message ?? {};
      const chatId = String(message.chat_id ?? "");
      if (!chatId) return;

      // Handle built-in commands before access check — allow anyone to query their own ID.
      const textContent = extractTextContent(message.message_type, message.content);
      if (isMyIdCommand(textContent)) {
        debugLog(`responding to my-id command from ${senderOpenId}`);
        await sendText(
          chatId,
          `Your open_id: ${senderOpenId}\n\nTo add to allowlist, ask the admin to run:\n/feishu:access add ${senderOpenId}`
        );
        return;
      }

      if (!deliver) {
        return;
      }

      // Permission-reply intercept: if this looks like "y xxxxx" / "n xxxxx"
      // for a pending permission request, emit the verdict instead of relaying
      // as chat. The sender already passed the allowFrom gate.
      const permMatch = PERMISSION_REPLY_RE.exec(textContent);
      if (permMatch) {
        const requestId = permMatch[2]!.toLowerCase();
        const behavior = permMatch[1]!.toLowerCase().startsWith("y") ? "allow" : "deny";
        debugLog(`permission verdict via text: id=${requestId} behavior=${behavior}`);
        void mcp
          .notification({
            method: "notifications/claude/channel/permission",
            params: { request_id: requestId, behavior },
          })
          .catch((err) => {
            fileLog(`permission verdict notification failed: ${String(err)}`);
          });
        pendingPermissions.delete(requestId);
        // Acknowledge with emoji reaction.
        const messageId = String(message.message_id ?? "");
        if (messageId) {
          const emoji = behavior === "allow" ? "OK" : "CrossMark";
          client.im.messageReaction
            .create({
              path: { message_id: messageId },
              data: { reaction_type: { emoji_type: emoji } },
            })
            .catch(() => {});
        }
        return;
      }

      // Persist last active chat for startup notification on next restart.
      saveLastChatId(chatId);

      const messageId = String(message.message_id ?? "");

      // Try event payload content first; if empty for non-text types, fetch via API.
      let rawContent = message.content;
      debugLog(`event content type=${typeof rawContent} value=${JSON.stringify(rawContent)?.slice(0, 300)}`);
      if (!rawContent && messageId) {
        debugLog(`content empty for message_type=${message.message_type}, fetching via API`);
        try {
          const fetched: any = await client.im.message.get({
            path: { message_id: messageId },
          });
          const body = fetched?.data?.items?.[0]?.body?.content ?? fetched?.data?.body?.content;
          if (body) {
            rawContent = body;
            debugLog(`API fetch content: ${String(rawContent).slice(0, 300)}`);
          }
        } catch (fetchErr) {
          debugLog(`API fetch failed: ${String(fetchErr)}`);
        }
      }

      const content = formatMessageContent(message.message_type, rawContent);
      const userName =
        event?.sender?.sender_id?.open_id ??
        event?.sender?.sender_id?.user_id ??
        "unknown";
      const ts = toIsoString(message.create_time);

      mcp.notification({
        method: "notifications/claude/channel",
        params: {
          content,
          meta: {
            chat_id: chatId,
            ...(messageId ? { message_id: messageId } : {}),
            user: userName,
            user_id: String(senderOpenId || "unknown"),
            ...(ts ? { ts } : {}),
          },
        },
      }).catch((err) => {
        fileLog(`notification FAILED: ${String(err)}`);
      });
      fileLog(`notification sent: chat_id=${chatId} message_id=${messageId || "unknown"}`);
      process.stderr.write(
        `feishu channel: notification sent for chat_id=${chatId} message_id=${messageId || "unknown"}\n`
      );
      debugLog(
        `forwarded to claude: chat_id=${chatId} message_id=${messageId || "unknown"} user_id=${
          senderOpenId || "unknown"
        }`
      );

      // Add "GET" reaction as a read receipt; store reaction_id for removal on reply.
      if (messageId) {
        try {
          const reactionRes: any = await client.im.messageReaction.create({
            path: { message_id: messageId },
            data: { reaction_type: { emoji_type: REACTION_EMOJI } },
          });
          const reactionId = reactionRes?.data?.reaction_id as string | undefined;
          if (reactionId) {
            const existing = pendingReactions.get(chatId) ?? [];
            pendingReactions.set(chatId, [...existing, { messageId, reactionId }]);
            debugLog(`added ${REACTION_EMOJI} reaction: message_id=${messageId} reaction_id=${reactionId}`);
          }
        } catch (err) {
          debugLog(`failed to add reaction: ${String(err)}`);
        }
      }
    } catch (err) {
      process.stderr.write(`feishu channel: inbound handler failed: ${String(err)}\n`);
    }
  },
});

// Card action handler for permission relay button clicks.
// Receives card.action.trigger events via WSClient when a user clicks
// Allow/Deny/See More on a permission card.
const cardHandler = new lark.CardActionHandler(
  {},
  async (data: any) => {
    try {
      const actionValue = data?.action?.value ?? {};
      const action = String(actionValue.action ?? "");
      const requestId = String(actionValue.request_id ?? "");
      const operatorOpenId = String(data?.operator?.open_id ?? "");

      debugLog(
        `card.action.trigger: action=${action} request_id=${requestId} operator=${operatorOpenId}`
      );

      if (!requestId || !action) {
        return { toast: { type: "info", content: "Unknown action" } };
      }

      // Verify the operator is in the allowlist.
      if (
        access.allowFrom.length > 0 &&
        !access.allowFrom.includes(operatorOpenId)
      ) {
        return { toast: { type: "error", content: "Not authorized" } };
      }

      if (action === "allow" || action === "deny") {
        const behavior = action;
        void mcp
          .notification({
            method: "notifications/claude/channel/permission",
            params: { request_id: requestId, behavior },
          })
          .catch((err) => {
            fileLog(`permission verdict notification failed: ${String(err)}`);
          });
        const details = pendingPermissions.get(requestId);
        pendingPermissions.delete(requestId);
        const label = behavior === "allow" ? "✅ Allowed" : "❌ Denied";
        debugLog(`permission verdict via card: id=${requestId} behavior=${behavior}`);

        // Return updated card wrapped in callback response format.
        // Feishu requires: { card: { type: "raw", data: { ...cardJson } } }
        return {
          toast: { type: behavior === "allow" ? "success" : "warning", content: label },
          card: {
            type: "raw",
            data: {
              config: { wide_screen_mode: true },
              header: {
                title: {
                  tag: "plain_text",
                  content: `🔐 ${label}${details ? ` — ${details.tool_name}` : ""}`,
                },
                template: behavior === "allow" ? "green" : "red",
              },
              elements: [
                {
                  tag: "markdown",
                  content: details
                    ? `**Tool:** \`${details.tool_name}\`\n**Request ID:** \`${requestId}\``
                    : `**Request ID:** \`${requestId}\``,
                },
              ],
            },
          },
        };
      }

      return { toast: { type: "info", content: "Unknown action" } };
    } catch (err) {
      fileLog(`card action handler error: ${String(err)}`);
      return { toast: { type: "error", content: "Internal error" } };
    }
  }
);

// In WS mode, callbacks must be handled by eventDispatcher.
// Reuse the existing cardHandler callback implementation to build response payload.
dispatcher.register({
  "card.action.trigger": async (data: any) => cardHandler.cardHandler(data),
});

wsClient.start({ eventDispatcher: dispatcher, cardHandler });
fileLog("websocket client started");
process.stderr.write("feishu channel: websocket started\n");

// Send startup notification after WS client has connected (3s delay).
setTimeout(notifyStartup, 3000);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write("feishu channel: shutting down\n");
  try {
    if (typeof wsClient.stop === "function") wsClient.stop();
  } catch {}
  setTimeout(() => process.exit(0), 1200);
}

process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function loadDotEnv(filePath: string) {
  try {
    chmodSync(filePath, 0o600);
  } catch {}

  try {
    const raw = readFileSync(filePath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {}
}

type Access = { allowFrom: string[] };

function loadAccess(): Access {
  const fromEnv = (process.env.FEISHU_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const raw = readFileSync(ACCESS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Access>;
    const fileList = Array.isArray(parsed.allowFrom) ? parsed.allowFrom : [];
    return {
      allowFrom: uniqueStrings([...fileList, ...fromEnv]),
    };
  } catch {
    const data = { allowFrom: uniqueStrings(fromEnv) };
    try {
      mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(ACCESS_FILE, JSON.stringify(data, null, 2) + "\n", {
        mode: 0o600,
      });
    } catch {}
    return data;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function shouldDeliver(senderId: string, allowFrom: string[], strict: boolean): boolean {
  if (!senderId) return false;
  if (allowFrom.includes(senderId)) return true;
  if (strict) return false;
  return allowFrom.length === 0;
}

function formatMessageContent(messageTypeRaw: unknown, contentRaw: unknown): string {
  const messageType = String(messageTypeRaw ?? "");
  // Preserve object content for post parsing; stringify only for text types
  const content =
    typeof contentRaw === "object" && contentRaw !== null
      ? JSON.stringify(contentRaw)
      : String(contentRaw ?? "");
  debugLog(`formatMessageContent: type=${messageType} content_type=${typeof contentRaw} content_len=${content.length} content_preview=${content.slice(0, 200)}`);

  if (messageType === "text") {
    try {
      const parsed = JSON.parse(content) as { text?: string };
      if (parsed.text) return parsed.text;
    } catch {}
    return content || "(empty text)";
  }

  if (messageType === "image") return "(image message)";
  if (messageType === "file") return "(file message)";
  if (messageType === "audio") return "(audio message)";
  if (messageType === "media") return "(media message)";
  if (messageType === "sticker") return "(sticker message)";
  if (messageType === "post") return parsePostContent(content);
  if (messageType === "interactive") return "(interactive card message)";
  if (messageType === "share_chat") return "(share chat message)";
  if (messageType === "share_user") return "(share user message)";
  return content || `(unsupported message type: ${messageType || "unknown"})`;
}

function toIsoString(tsRaw: unknown): string {
  const ts = String(tsRaw ?? "");
  if (!ts) return "";
  const num = Number(ts);
  if (Number.isNaN(num)) return "";
  // Feishu create_time is usually milliseconds as a string.
  return new Date(num).toISOString();
}

function mask(value: string | undefined): string {
  if (!value) return "empty";
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

function debugLog(message: string): void {
  fileLog(message);
  if (!DEBUG) return;
  process.stderr.write(`feishu channel [debug]: ${message}\n`);
}

const MY_ID_PATTERNS = [
  /^(我的|my)\s*(lark|feishu|飞书)?\s*(id|open.?id)$/i,
  /^what'?s?\s+my\s+(id|open.?id)$/i,
  /^\/?(myid|my.id|whoami)$/i,
];

function isMyIdCommand(text: string): boolean {
  const trimmed = text.trim();
  return MY_ID_PATTERNS.some((re) => re.test(trimmed));
}

function extractTextContent(messageTypeRaw: unknown, contentRaw: unknown): string {
  if (String(messageTypeRaw ?? "") !== "text") return "";
  try {
    const parsed = JSON.parse(String(contentRaw ?? "")) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return "";
  }
}

/**
 * Parse Feishu "post" (rich text) message content into readable plain text.
 *
 * Post content structure:
 *   { "<locale>": { "title": "...", "content": [[inline_elements...], ...] } }
 *
 * Inline element tags: text, a (link), at (mention), img, media, emotion, etc.
 */
function parsePostContent(raw: string): string {
  debugLog(`parsePostContent raw (${raw.length} chars): ${raw.slice(0, 500)}`);
  try {
    // Handle case where raw might already be an object (stringified via String())
    const parsed: Record<string, unknown> =
      typeof raw === "object" && raw !== null
        ? (raw as unknown as Record<string, unknown>)
        : JSON.parse(raw);
    debugLog(`parsePostContent parsed keys: ${Object.keys(parsed).join(", ")}`);
    // Pick the first available locale (zh_cn, en_us, ja_jp, etc.)
    const localeData = Object.values(parsed).find(
      (v): v is { title?: string; content?: unknown[][] } =>
        typeof v === "object" && v !== null && "content" in v
    );
    if (!localeData?.content) return raw || "(empty rich text)";

    const paragraphs: string[] = [];

    if (localeData.title) {
      paragraphs.push(localeData.title);
    }

    for (const paragraph of localeData.content) {
      if (!Array.isArray(paragraph)) continue;
      const parts: string[] = [];
      for (const el of paragraph) {
        if (typeof el !== "object" || el === null) continue;
        const node = el as Record<string, unknown>;
        const tag = String(node.tag ?? "");
        if (tag === "text") {
          parts.push(String(node.text ?? ""));
        } else if (tag === "a") {
          const text = String(node.text ?? "");
          const href = String(node.href ?? "");
          parts.push(text && href ? `[${text}](${href})` : text || href);
        } else if (tag === "at") {
          parts.push(`@${String(node.user_name ?? node.user_id ?? "user")}`);
        } else if (tag === "emotion") {
          parts.push(`[${String(node.emoji_type ?? "emoji")}]`);
        } else if (tag === "img") {
          parts.push("(image)");
        } else if (tag === "media") {
          parts.push("(media)");
        }
      }
      paragraphs.push(parts.join(""));
    }

    const result = paragraphs.join("\n").trim();
    return result || "(empty rich text)";
  } catch (err) {
    debugLog(`parsePostContent error: ${String(err)}`);
    return raw || "(rich text message)";
  }
}

function asReceiveIdType(
  value: unknown
): "chat_id" | "open_id" | "union_id" | "user_id" | "email" {
  const v = String(value ?? "chat_id");
  if (v === "open_id") return "open_id";
  if (v === "union_id") return "union_id";
  if (v === "user_id") return "user_id";
  if (v === "email") return "email";
  return "chat_id";
}
