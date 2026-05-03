# codex-LLM

Copia enxuta da camada LLM/Codex do projeto `vtuber-ai-assistant`.

Esta pasta nao tem STT, TTS, avatar ou frontend React. Ela existe para entender e testar somente:

- selecao do modelo `gpt-5.4-mini`
- carregamento de auth local
- pool de contas
- chamada ao endpoint `/responses`
- streaming upstream SSE
- streaming downstream SSE para cliente local
- pergunta/resposta com historico por `threadId`
- chats persistidos em arquivos `chats/*.json`

## Como Rodar

```bash
npm install
npm start
```

Abra:

```text
http://127.0.0.1:8788
```

Modo sem credencial, para testar o SSE:

```bash
set MOCK_LLM=1
npm start
```

Ou no PowerShell:

```powershell
$env:MOCK_LLM = "1"
npm start
```

## Modelo

O modelo padrao vem de `server/config.js`:

```js
model: process.env.CODEX_MODEL || readModelFromConfig() || "gpt-5.4-mini"
```

Ordem:

1. `CODEX_MODEL`
2. `config.toml` com `model = "..."` na raiz
3. fallback `gpt-5.4-mini`

Exemplo:

```powershell
$env:CODEX_MODEL = "gpt-5.4-mini"
npm start
```

## Auth

O servidor nao le automaticamente `C:\Users\...\ .codex\auth.json`.

Ele so aceita auth dentro da propria pasta `codex-LLM`, por seguranca:

```text
codex-LLM/auth.json
codex-LLM/auth-pool/*.json
```

Tambem aceita:

```text
CODEX_AUTH_PATH=C:\...\codex-LLM\auth.json
```

mas o caminho ainda precisa estar dentro da pasta `codex-LLM`.

### Auth unico com access_token

Copie `auth.example.json` para `auth.json` e coloque seu token:

```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "seu-access-token",
    "id_token": "opcional",
    "refresh_token": "opcional",
    "account_id": "opcional"
  }
}
```

Com `access_token`, ele chama:

```text
https://chatgpt.com/backend-api/codex/responses
```

### Auth unico com OpenAI API key

Tambem funciona:

```json
{
  "OPENAI_API_KEY": "sk-..."
}
```

Com `OPENAI_API_KEY`, ele chama:

```text
https://api.openai.com/v1/responses
```

## Pool

O pool fica em:

```text
auth-pool/*.json
```

Formato:

```json
{
  "credential_pool": {
    "openai-codex": [
      {
        "label": "conta-1",
        "auth_type": "oauth",
        "access_token": "token-1"
      },
      {
        "label": "conta-2",
        "auth_type": "oauth",
        "access_token": "token-2"
      }
    ]
  }
}
```

O provider seleciona a primeira conta com `access_token` ou `OPENAI_API_KEY`.
Se a resposta vier `401`, `403` ou `429`, ele marca essa conta como pulada naquela request e tenta a proxima.

## Endpoints

### Chats em arquivo

```http
GET /api/chats
POST /api/chats
GET /api/chats/:id
```

Cada conversa fica salva em:

```text
chats/<data>-<assunto>.json
```

O chat web usa esses arquivos, nao `localStorage`. Na primeira rodada, depois da resposta do assistente, o servidor renomeia o titulo do chat usando um resumo curto do primeiro assunto.

### Health

```http
GET /api/health
```

Retorna modelo, endpoint escolhido e status redigido de auth/pool.
Nao retorna tokens.

### SSE ao vivo

```http
POST /api/chat/sse
Content-Type: application/json

{
  "threadId": "demo",
  "text": "Explique streaming em uma frase."
}
```

Resposta:

```text
Content-Type: text/event-stream

event: status
data: {"type":"status","state":"thinking","detail":"codex"}

event: text_delta
data: {"type":"text_delta","text":"Claro"}

event: completed
data: {"type":"completed","responseId":"...","text":"Claro..."}
```

Tambem existe `GET /api/chat/sse?threadId=demo&text=...` para teste rapido, mas POST e melhor.

### JSON sem streaming

```http
POST /api/chat/json
```

Retorna:

```json
{
  "ok": true,
  "responseId": "...",
  "text": "resposta completa"
}
```

## Como O Streaming Funciona

1. Cliente local chama `/api/chat/sse`.
2. `server/index.js` abre um SSE para o cliente.
3. `CodexSessionProvider.streamChat()` monta o payload:

```js
{
  model,
  instructions,
  input,
  stream: true,
  store
}
```

4. O servidor chama o endpoint upstream `/responses`.
5. `parseSseJson()` le os eventos SSE upstream.
6. Eventos `response.output_text.delta` viram `text_delta` para o cliente.
7. `response.completed` salva `responseId` e finaliza.

## Historico Por Thread

O provider mantem dois mapas em memoria:

```js
previousResponseByThread
historyByThread
```

Para `OPENAI_API_KEY`, ele usa `previous_response_id` quando existe.

Para `access_token` do ChatGPT/Codex, ele manda um historico curto manual:

```js
[
  ...history,
  { role: "user", content: request.text }
]
```

Depois da resposta, salva os ultimos 12 itens.

## Variaveis

```text
PORT=8788
HOST=127.0.0.1
CODEX_MODEL=gpt-5.4-mini
CODEX_AUTH_PATH=C:\...\codex-LLM\auth.json
CODEX_BASE_URL=https://chatgpt.com/backend-api/codex
OPENAI_BASE_URL=https://api.openai.com/v1
CODEX_INSTRUCTIONS=Voce e um assistente direto.
MOCK_LLM=1
```

## Arquivos Principais

```text
server/auth.js          carrega auth.json e auth-pool
server/config.js        escolhe modelo e endpoints
server/codexProvider.js chama /responses e faz fallback do pool
server/upstreamSse.js   parseia SSE vindo da API
server/outboundSse.js   escreve SSE para o cliente local
server/index.js         HTTP server e endpoints
public/index.html       tester web minimo
public/chat.html        chat simples com historico em arquivo
chats/*.json            conversas salvas localmente
```
