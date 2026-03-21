import { query } from "@anthropic-ai/claude-code";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// claude-agent root: two levels up from app/server/
const AGENT_ROOT = path.resolve(__dirname, "../..");

type UserMessage = {
  type: "user";
  message: { role: "user"; content: string };
};

class QueueClosedError extends Error {
  constructor() {
    super("Queue closed");
    this.name = "QueueClosedError";
  }
}

/**
 * Async iterable message queue.
 * Lets the SDK iterate over user messages as they arrive via WebSocket/channels.
 */
class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: {
    resolve: (msg: UserMessage) => void;
    reject: (err: Error) => void;
  } | null = null;
  private closed = false;

  push(content: string) {
    if (this.closed) return;

    const msg: UserMessage = {
      type: "user",
      message: { role: "user", content },
    };

    if (this.waiting) {
      this.waiting.resolve(msg);
      this.waiting = null;
    } else {
      this.messages.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length > 0) {
        yield this.messages.shift()!;
      } else {
        try {
          yield await new Promise<UserMessage>((resolve, reject) => {
            this.waiting = { resolve, reject };
          });
        } catch (err) {
          if (err instanceof QueueClosedError) break;
          throw err;
        }
      }
    }
  }

  close() {
    this.closed = true;
    if (this.waiting) {
      this.waiting.reject(new QueueClosedError());
      this.waiting = null;
    }
  }
}

/**
 * Load MCP server configs from the claude-agent root .mcp.json.
 * Returns an empty object if the file is missing or invalid.
 */
function loadMcpServers(): Record<string, any> {
  const mcpPath = path.join(AGENT_ROOT, ".mcp.json");
  try {
    const raw = fs.readFileSync(mcpPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.mcpServers ?? {};
  } catch {
    return {};
  }
}

/**
 * AgentSession wraps the Claude Code SDK `query` function for a single session.
 * One AgentSession per active conversation — they are long-lived and survive
 * multiple message exchanges via the internal MessageQueue.
 */
export class AgentSession {
  private queue = new MessageQueue();
  private outputIterator: AsyncIterator<any> | null = null;
  private abortController = new AbortController();
  public readonly sessionId: string;
  public readonly cwd: string;

  constructor(sessionId: string, cwd?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd || AGENT_ROOT;

    const mcpServers = loadMcpServers();

    const options: Record<string, any> = {
      maxTurns: 200,
      model: "sonnet",
      // bypassPermissions: this server is a local single-user tool.
      // All tool calls execute without prompting. Never expose to untrusted networks.
      permissionMode: "bypassPermissions",
      abortController: this.abortController,
      cwd: this.cwd,
      mcpServers,
    };

    this.outputIterator = query({
      prompt: this.queue as any,
      options,
    })[Symbol.asyncIterator]();
  }

  /**
   * Push a user message into the queue so the SDK can process it.
   */
  sendMessage(content: string) {
    this.queue.push(content);
  }

  /**
   * Async generator that yields raw SDK output messages.
   * Consumers should iterate this and handle each message type.
   */
  async *getOutputStream(): AsyncGenerator<any> {
    if (!this.outputIterator) {
      throw new Error("Session not initialized");
    }
    while (true) {
      const { value, done } = await this.outputIterator.next();
      if (done) break;
      yield value;
    }
  }

  /**
   * Abort the current SDK execution. The session becomes unusable after this.
   */
  interrupt() {
    this.abortController.abort();
    this.queue.close();
  }
}
