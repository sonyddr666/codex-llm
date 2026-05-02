import { loadCodexAuth } from "./auth.js";
import { appConfig } from "./config.js";
import { parseSseJson } from "./upstreamSse.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOutputText(response) {
  if (!response) {
    return "";
  }

  if (response.output_text) {
    return response.output_text;
  }

  const output = response.output;
  if (!Array.isArray(output)) {
    return "";
  }

  const chunks = [];
  for (const item of output) {
    if (Array.isArray(item.content)) {
      for (const content of item.content) {
        if (typeof content.text === "string") {
          chunks.push(content.text);
        }
      }
    }
  }

  return chunks.join("");
}

function endpointForAuth(auth) {
  if (auth.accessToken) {
    return {
      url: `${appConfig.codexBaseUrl.replace(/\/$/, "")}/responses`,
      token: auth.accessToken,
      kind: "chatgpt_session"
    };
  }

  if (auth.apiKey) {
    return {
      url: `${appConfig.openAiBaseUrl.replace(/\/$/, "")}/responses`,
      token: auth.apiKey,
      kind: "openai_api"
    };
  }

  return {
    url: `${appConfig.codexBaseUrl.replace(/\/$/, "")}/responses`,
    kind: "chatgpt_session"
  };
}

export class CodexSessionProvider {
  previousResponseByThread = new Map();
  historyByThread = new Map();

  async *streamChat(request) {
    if (appConfig.mockLlm) {
      yield* this.mockStream(request.text);
      return;
    }

    const skippedAccounts = new Set();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const auth = loadCodexAuth({ skipKeys: skippedAccounts });
      const endpoint = endpointForAuth(auth);
      if (!endpoint.token) {
        yield {
          type: "error",
          message:
            auth.status.error ||
            "Pool local nao tem conta disponivel com access_token ou OPENAI_API_KEY.",
          recoverable: false
        };
        return;
      }

      const previousResponseId = this.previousResponseByThread.get(request.threadId);
      const useStoredResponses = endpoint.kind === "openai_api";
      const history = this.historyByThread.get(request.threadId) || [];
      const input = useStoredResponses
        ? [
            {
              role: "user",
              content: request.text
            }
          ]
        : [
            ...history,
            {
              role: "user",
              content: request.text
            }
          ];
      const payload = {
        model: request.model || appConfig.model,
        instructions: request.instructions || appConfig.defaultInstructions,
        input,
        stream: true,
        store: useStoredResponses
      };

      if (useStoredResponses && previousResponseId) {
        payload.previous_response_id = previousResponseId;
      }

      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${endpoint.token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        if (auth.accountKey && [401, 403, 429].includes(response.status)) {
          skippedAccounts.add(auth.accountKey);
          yield {
            type: "status",
            state: "thinking",
            detail: `pool: ${response.status}, tentando proxima conta`
          };
          continue;
        }

        yield {
          type: "error",
          message: `Falha ao chamar Codex (${response.status}): ${body.slice(0, 500)}`,
          recoverable: false
        };
        return;
      }

      let streamedText = "";
      let completedText = "";
      let responseId;

      for await (const raw of parseSseJson(response.body)) {
        const event = raw;

        if (event.type === "response.failed" || event.type === "error") {
          yield {
            type: "error",
            message: event.error?.message || "Codex retornou erro no streaming.",
            recoverable: false
          };
          return;
        }

        const delta =
          event.type === "response.output_text.delta" ||
          event.type === "response.text.delta" ||
          event.type === "response.delta"
            ? event.delta || event.text || ""
            : "";

        if (delta) {
          streamedText += delta;
          yield { type: "text_delta", text: delta };
        }

        if (event.type === "response.completed") {
          responseId = event.response?.id;
          completedText = extractOutputText(event.response);
        }
      }

      if (useStoredResponses && responseId) {
        this.previousResponseByThread.set(request.threadId, responseId);
      }

      const assistantText = streamedText || completedText;
      if (assistantText) {
        const nextHistory = [
          ...history,
          { role: "user", content: request.text },
          { role: "assistant", content: assistantText }
        ].slice(-12);
        this.historyByThread.set(request.threadId, nextHistory);
      }

      if (!streamedText && completedText) {
        yield { type: "text_delta", text: completedText };
      }

      yield {
        type: "completed",
        responseId,
        text: assistantText
      };
      return;
    }

    yield {
      type: "error",
      message: "Todas as contas do pool local falharam ou estao sem cota.",
      recoverable: false
    };
  }

  async *mockStream(input) {
    const text = `Entendi: "${input}". Este e o modo MOCK_LLM, com SSE funcionando sem credenciais.`;
    const words = text.split(/(\s+)/);

    for (const word of words) {
      await delay(25);
      yield { type: "text_delta", text: word };
    }

    yield {
      type: "completed",
      responseId: `mock_${Date.now()}`,
      text
    };
  }
}
