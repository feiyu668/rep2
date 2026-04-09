import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const openaiClient = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "placeholder",
});

const anthropicClient = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "placeholder",
});

function verifyToken(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"];
  const proxyKey = process.env.PROXY_API_KEY;
  if (!proxyKey) {
    res.status(500).json({ error: { message: "PROXY_API_KEY not configured", type: "server_error" } });
    return false;
  }
  if (!auth || auth !== `Bearer ${proxyKey}`) {
    res.status(401).json({ error: { message: "Invalid or missing Bearer token", type: "auth_error" } });
    return false;
  }
  return true;
}

const OPENAI_MODELS = [
  { id: "gpt-5.2", object: "model", created: 1700000000, owned_by: "openai" },
  { id: "gpt-5-mini", object: "model", created: 1700000000, owned_by: "openai" },
  { id: "gpt-5-nano", object: "model", created: 1700000000, owned_by: "openai" },
  { id: "o4-mini", object: "model", created: 1700000000, owned_by: "openai" },
  { id: "o3", object: "model", created: 1700000000, owned_by: "openai" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6", object: "model", created: 1700000000, owned_by: "anthropic" },
  { id: "claude-sonnet-4-6", object: "model", created: 1700000000, owned_by: "anthropic" },
  { id: "claude-haiku-4-5", object: "model", created: 1700000000, owned_by: "anthropic" },
];

router.get("/models", (req, res) => {
  if (!verifyToken(req, res)) return;
  res.json({ object: "list", data: [...OPENAI_MODELS, ...ANTHROPIC_MODELS] });
});

function isClaudeModel(model: string): boolean {
  return model.startsWith("claude-");
}

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}

function openaiMessagesToAnthropic(messages: OpenAI.ChatCompletionMessageParam[]): {
  system?: string;
  messages: Anthropic.MessageParam[];
} {
  let system: string | undefined;
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = Array.isArray(msg.content)
        ? msg.content.map((c) => (c.type === "text" ? c.text : "")).join("")
        : (msg.content as string);
      continue;
    }

    if (msg.role === "tool") {
      const last = anthropicMessages[anthropicMessages.length - 1];
      const toolResultBlock: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id as string,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
      } else {
        anthropicMessages.push({ role: "user", content: [toolResultBlock] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (typeof msg.content === "string" && msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const c of msg.content) {
          if (c.type === "text") contentBlocks.push({ type: "text", text: c.text });
        }
      }
      if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          let inputObj: Record<string, unknown> = {};
          try {
            inputObj = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
          } catch {}
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: inputObj,
          });
        }
      }
      anthropicMessages.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        anthropicMessages.push({ role: "user", content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const c of msg.content) {
          if (c.type === "text") blocks.push({ type: "text", text: c.text });
          else if (c.type === "image_url") {
            const url = typeof c.image_url === "string" ? c.image_url : c.image_url.url;
            if (url.startsWith("data:")) {
              const [header, data] = url.split(",");
              const mediaType = header.replace("data:", "").replace(";base64", "");
              blocks.push({
                type: "image",
                source: { type: "base64", media_type: mediaType as Anthropic.Base64ImageSource["media_type"], data },
              });
            } else {
              blocks.push({ type: "image", source: { type: "url", url } });
            }
          }
        }
        anthropicMessages.push({ role: "user", content: blocks });
      }
    }
  }

  return { system, messages: anthropicMessages };
}

function openaiToolsToAnthropic(tools?: OpenAI.ChatCompletionTool[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: (t.function.parameters ?? { type: "object", properties: {} }) as Anthropic.Tool["input_schema"],
  }));
}

function openaiToolChoiceToAnthropic(toolChoice?: OpenAI.ChatCompletionToolChoiceOption): Anthropic.MessageCreateParams["tool_choice"] {
  if (!toolChoice) return undefined;
  if (toolChoice === "none") return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice.type === "function") {
    return { type: "tool", name: toolChoice.function.name };
  }
  return undefined;
}

function anthropicResponseToOpenAI(msg: Anthropic.Message, model: string): OpenAI.ChatCompletion {
  const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
  let textContent = "";

  for (const block of msg.content) {
    if (block.type === "text") {
      textContent += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  const finishReason: OpenAI.ChatCompletion.Choice["finish_reason"] =
    msg.stop_reason === "tool_use"
      ? "tool_calls"
      : msg.stop_reason === "end_turn"
      ? "stop"
      : msg.stop_reason === "max_tokens"
      ? "length"
      : "stop";

  const message: OpenAI.ChatCompletionMessage = {
    role: "assistant",
    content: textContent || null,
    refusal: null,
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id: msg.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: msg.usage.input_tokens,
      completion_tokens: msg.usage.output_tokens,
      total_tokens: msg.usage.input_tokens + msg.usage.output_tokens,
    },
  };
}

router.post("/chat/completions", async (req: Request, res: Response) => {
  if (!verifyToken(req, res)) return;

  const body = req.body as {
    model: string;
    messages: OpenAI.ChatCompletionMessageParam[];
    stream?: boolean;
    tools?: OpenAI.ChatCompletionTool[];
    tool_choice?: OpenAI.ChatCompletionToolChoiceOption;
    max_tokens?: number;
    temperature?: number;
    [key: string]: unknown;
  };

  const { model, messages, stream = false, tools, tool_choice, max_tokens, temperature, ...rest } = body;

  if (!model) {
    res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    return;
  }

  logger.info({
    endpoint: "chat/completions",
    model,
    stream,
    max_tokens,
    temperature,
    tool_count: tools?.length ?? 0,
    extra: Object.keys(rest).length > 0 ? rest : undefined,
  }, "incoming request params");

  try {
    if (isOpenAIModel(model)) {
      const params: OpenAI.ChatCompletionCreateParams = {
        model,
        messages,
        stream: false,
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...rest,
      } as OpenAI.ChatCompletionCreateParams;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const streamParams = { ...params, stream: true } as OpenAI.ChatCompletionCreateParamsStreaming;
          const streamResponse = await openaiClient.chat.completions.create(streamParams);
          for await (const chunk of streamResponse) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          }
          res.write("data: [DONE]\n\n");
        } finally {
          clearInterval(keepalive);
          res.end();
        }
      } else {
        const response = await openaiClient.chat.completions.create(params as OpenAI.ChatCompletionCreateParamsNonStreaming);
        res.json(response);
      }
    } else if (isClaudeModel(model)) {
      const { system, messages: anthropicMessages } = openaiMessagesToAnthropic(messages);
      const anthropicTools = openaiToolsToAnthropic(tools);
      const anthropicToolChoice = openaiToolChoiceToAnthropic(tool_choice);

      const anthropicParams: Anthropic.MessageCreateParams = {
        model,
        messages: anthropicMessages,
        max_tokens: max_tokens ?? 8192,
        ...(system ? { system } : {}),
        ...(anthropicTools && anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
        ...(anthropicToolChoice ? { tool_choice: anthropicToolChoice } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const anthropicStream = anthropicClient.messages.stream(anthropicParams);

          let currentToolCallId: string | null = null;
          let currentToolCallName: string | null = null;
          let chunkIndex = 0;
          const completionId = `chatcmpl-${Date.now()}`;
          let inputTokens = 0;
          let outputTokens = 0;
          let inputText = "";
          let hasToolUse = false;

          for await (const event of anthropicStream) {
            if (event.type === "message_start") {
              inputTokens = event.message.usage.input_tokens;
              const chunk: OpenAI.ChatCompletionChunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null, logprobs: null }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              (res as unknown as { flush?: () => void }).flush?.();
            } else if (event.type === "content_block_start") {
              if (event.content_block.type === "text") {
                inputText = "";
              } else if (event.content_block.type === "tool_use") {
                hasToolUse = true;
                currentToolCallId = event.content_block.id;
                currentToolCallName = event.content_block.name;
                const chunk: OpenAI.ChatCompletionChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [
                          {
                            index: chunkIndex,
                            id: currentToolCallId,
                            type: "function",
                            function: { name: currentToolCallName, arguments: "" },
                          },
                        ],
                      },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                (res as unknown as { flush?: () => void }).flush?.();
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                inputText += event.delta.text;
                const chunk: OpenAI.ChatCompletionChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null, logprobs: null }],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                (res as unknown as { flush?: () => void }).flush?.();
              } else if (event.delta.type === "input_json_delta") {
                const chunk: OpenAI.ChatCompletionChunk = {
                  id: completionId,
                  object: "chat.completion.chunk",
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {
                        tool_calls: [{ index: chunkIndex, function: { arguments: event.delta.partial_json } }],
                      },
                      finish_reason: null,
                      logprobs: null,
                    },
                  ],
                };
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                (res as unknown as { flush?: () => void }).flush?.();
              }
            } else if (event.type === "content_block_stop") {
              if (currentToolCallId !== null) {
                chunkIndex++;
                currentToolCallId = null;
                currentToolCallName = null;
              }
            } else if (event.type === "message_delta") {
              outputTokens = event.usage.output_tokens;
              const finishReason: OpenAI.ChatCompletionChunk.Choice["finish_reason"] =
                event.delta.stop_reason === "tool_use"
                  ? "tool_calls"
                  : event.delta.stop_reason === "end_turn"
                  ? "stop"
                  : event.delta.stop_reason === "max_tokens"
                  ? "length"
                  : "stop";
              const chunk: OpenAI.ChatCompletionChunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: {}, finish_reason: finishReason, logprobs: null }],
                usage: {
                  prompt_tokens: inputTokens,
                  completion_tokens: outputTokens,
                  total_tokens: inputTokens + outputTokens,
                },
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              (res as unknown as { flush?: () => void }).flush?.();
            }
          }

          res.write("data: [DONE]\n\n");
        } finally {
          clearInterval(keepalive);
          res.end();
        }
      } else {
        const anthropicStream = anthropicClient.messages.stream(anthropicParams);
        const finalMsg = await anthropicStream.finalMessage();
        const openAIResponse = anthropicResponseToOpenAI(finalMsg, model);
        res.json(openAIResponse);
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}. Use gpt-/o- prefix for OpenAI or claude- for Anthropic.`, type: "invalid_request_error" } });
    }
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string; name?: string };
    const status = error.status ?? 500;
    const message = error.message ?? "Internal server error";
    res.status(status).json({ error: { message, type: "api_error" } });
  }
});

router.post("/messages", async (req: Request, res: Response) => {
  if (!verifyToken(req, res)) return;

  const body = req.body as {
    model: string;
    messages: Anthropic.MessageParam[];
    system?: string;
    tools?: Anthropic.Tool[];
    tool_choice?: Anthropic.ToolChoiceParam;
    max_tokens?: number;
    stream?: boolean;
    temperature?: number;
    [key: string]: unknown;
  };

  const { model, messages, system, tools, tool_choice, max_tokens = 8192, stream = false, temperature, ...rest } = body;

  if (!model) {
    res.status(400).json({ error: { message: "model is required", type: "invalid_request_error" } });
    return;
  }

  logger.info({
    endpoint: "messages",
    model,
    stream,
    max_tokens,
    temperature,
    has_system: !!system,
    tool_count: tools?.length ?? 0,
    extra: Object.keys(rest).length > 0 ? rest : undefined,
  }, "incoming request params");

  try {
    if (isClaudeModel(model)) {
      const params: Anthropic.MessageCreateParams = {
        model,
        messages,
        max_tokens,
        ...(system ? { system } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(tool_choice ? { tool_choice } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...rest,
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const anthropicStream = anthropicClient.messages.stream(params);
          for await (const event of anthropicStream) {
            res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            (res as unknown as { flush?: () => void }).flush?.();
          }
        } finally {
          clearInterval(keepalive);
          res.end();
        }
      } else {
        const anthropicStream = anthropicClient.messages.stream(params);
        const finalMsg = await anthropicStream.finalMessage();
        res.json(finalMsg);
      }
    } else if (isOpenAIModel(model)) {
      const openaiMessages = anthropicMessagesToOpenAI(messages);
      const openaiTools = anthropicToolsToOpenAI(tools);
      const openaiToolChoice = anthropicToolChoiceToOpenAI(tool_choice);

      const openaiParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: openaiMessages,
        stream: false,
        ...(max_tokens ? { max_completion_tokens: max_tokens } : {}),
        ...(openaiTools && openaiTools.length > 0 ? { tools: openaiTools } : {}),
        ...(openaiToolChoice ? { tool_choice: openaiToolChoice } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const keepalive = setInterval(() => {
          res.write(": keepalive\n\n");
        }, 5000);

        req.on("close", () => clearInterval(keepalive));

        try {
          const streamParams = { ...openaiParams, stream: true } as OpenAI.ChatCompletionCreateParamsStreaming;
          const openaiStream = await openaiClient.chat.completions.create(streamParams);

          const messageId = `msg_${Date.now()}`;
          let inputTokens = 0;
          let outputTokens = 0;
          let contentBlockIndex = 0;
          let currentToolIndex = 0;
          const toolCallMap: Record<number, { id: string; name: string; args: string }> = {};
          let started = false;
          let textStarted = false;

          res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: messageId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);

          for await (const chunk of openaiStream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              if (!textStarted) {
                res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: contentBlockIndex, content_block: { type: "text", text: "" } })}\n\n`);
                textStarted = true;
              }
              res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: contentBlockIndex, delta: { type: "text_delta", text: delta.content } })}\n\n`);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!(idx in toolCallMap)) {
                  if (textStarted) {
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentBlockIndex })}\n\n`);
                    contentBlockIndex++;
                    textStarted = false;
                  }
                  toolCallMap[idx] = { id: tc.id ?? `tool_${idx}`, name: tc.function?.name ?? "", args: "" };
                  res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: contentBlockIndex + idx, content_block: { type: "tool_use", id: toolCallMap[idx].id, name: toolCallMap[idx].name, input: {} } })}\n\n`);
                }
                if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
                if (tc.function?.arguments) {
                  toolCallMap[idx].args += tc.function.arguments;
                  res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: contentBlockIndex + idx, delta: { type: "input_json_delta", partial_json: tc.function.arguments } })}\n\n`);
                }
                currentToolIndex = idx;
              }
            }

            const finishReason = chunk.choices[0]?.finish_reason;
            if (finishReason) {
              if (textStarted) {
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentBlockIndex })}\n\n`);
                contentBlockIndex++;
              }
              for (const idx of Object.keys(toolCallMap).map(Number)) {
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: contentBlockIndex + idx })}\n\n`);
              }

              const anthropicStopReason = finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";
              outputTokens = chunk.usage?.completion_tokens ?? 0;
              inputTokens = chunk.usage?.prompt_tokens ?? 0;

              res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: anthropicStopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } })}\n\n`);
              res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
            }

            (res as unknown as { flush?: () => void }).flush?.();
          }
        } finally {
          clearInterval(keepalive);
          res.end();
        }
      } else {
        const response = await openaiClient.chat.completions.create(openaiParams);
        const anthropicResponse = openaiResponseToAnthropic(response, model, max_tokens);
        res.json(anthropicResponse);
      }
    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err: unknown) {
    const error = err as { status?: number; message?: string };
    const status = error.status ?? 500;
    const message = error.message ?? "Internal server error";
    res.status(status).json({ error: { message, type: "api_error" } });
  }
});

function anthropicMessagesToOpenAI(messages: Anthropic.MessageParam[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const parts: OpenAI.ChatCompletionContentPart[] = [];
        const toolResults: OpenAI.ChatCompletionToolMessageParam[] = [];
        for (const block of msg.content) {
          if (block.type === "text") {
            parts.push({ type: "text", text: block.text });
          } else if (block.type === "tool_result") {
            toolResults.push({
              role: "tool",
              tool_call_id: block.tool_use_id,
              content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
            });
          }
        }
        if (parts.length > 0) result.push({ role: "user", content: parts });
        result.push(...toolResults);
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else {
        let text = "";
        const toolCalls: OpenAI.ChatCompletionMessageToolCall[] = [];
        for (const block of msg.content) {
          if (block.type === "text") text += block.text;
          else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              type: "function",
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          }
        }
        const assistantMsg: OpenAI.ChatCompletionAssistantMessageParam = { role: "assistant", content: text || null };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      }
    }
  }
  return result;
}

function anthropicToolsToOpenAI(tools?: Anthropic.Tool[]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));
}

function anthropicToolChoiceToOpenAI(toolChoice?: Anthropic.ToolChoiceParam): OpenAI.ChatCompletionToolChoiceOption | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "any") return "required";
  if (toolChoice.type === "tool") return { type: "function", function: { name: (toolChoice as Anthropic.ToolChoiceTool).name } };
  return undefined;
}

function openaiResponseToAnthropic(response: OpenAI.ChatCompletion, model: string, maxTokens: number): Anthropic.Message {
  const choice = response.choices[0];
  if (!choice) {
    return {
      id: response.id,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const content: Anthropic.ContentBlock[] = [];
  if (choice.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }
  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments ?? "{}") as Record<string, unknown>;
      } catch {}
      content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
    }
  }

  const stopReason: Anthropic.Message["stop_reason"] =
    choice.finish_reason === "tool_calls"
      ? "tool_use"
      : choice.finish_reason === "length"
      ? "max_tokens"
      : "end_turn";

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

export default router;
