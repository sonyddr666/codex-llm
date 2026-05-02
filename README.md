# codex-LLM

Uma implementação enxuta da camada LLM/Codex isolada do projeto `vtuber-ai-assistant`. Este projeto fornece um servidor Node.js com suporte a streaming SSE (Server-Sent Events) para integração [...]

## 📋 Visão Geral

**codex-LLM** é um servidor standalone focado exclusivamente em:

- ✅ Seleção dinâmica de modelos (com fallback)
- ✅ Autenticação local e pool de contas
- ✅ Streaming bidirecional com SSE (Server-Sent Events)
- ✅ Histórico de conversas por `threadId`
- ✅ Suporte a múltiplas estratégias de autenticação
- ✅ Modo mock para testes sem credenciais
- ✅ Interface web minimalista para testes

**Fora do escopo:** STT, TTS, avatar ou frontend React complexo.

## 🚀 Quick Start

### Instalação

```bash
# Instalar dependências
npm install

# Iniciar servidor
npm start
```

Acesse a interface de teste em: **http://127.0.0.1:8788**

### Modo Mock (Sem Credenciais)

Para testar streaming sem usar credenciais reais:

**Windows (CMD):**
```bash
set MOCK_LLM=1
npm start
```

**Windows (PowerShell):**
```powershell
$env:MOCK_LLM = "1"
npm start
```

**Linux/Mac:**
```bash
MOCK_LLM=1 npm start
```

## ⚙️ Configuração

### Seleção de Modelo

O servidor seleciona o modelo na seguinte ordem:

1. **Variável `CODEX_MODEL`** (com maior prioridade)
2. **Arquivo `config.toml`** na raiz do projeto
3. **Fallback padrão:** `gpt-5.4-mini`

**Exemplo com variável de ambiente:**
```powershell
$env:CODEX_MODEL = "gpt-4-turbo"
npm start
```

**Exemplo com arquivo `config.toml`:**
```toml
model = "gpt-4-turbo"
```

### Autenticação

O servidor **não** lê automaticamente credenciais do perfil do sistema. Por segurança, aceita apenas arquivos locais dentro da pasta `codex-LLM`:

```
codex-LLM/
├── auth.json                 # Credencial única
└── auth-pool/
    ├── conta1.json          # Pool de contas
    └── conta2.json
```

#### Autenticação Única com Access Token

**Crie `auth.json`** (copie de `auth.example.json`):

```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "access_token": "seu-access-token-aqui",
    "id_token": "opcional",
    "refresh_token": "opcional",
    "account_id": "opcional"
  }
}
```

**Endpoint chamado:** `https://chatgpt.com/backend-api/codex/responses`

#### Autenticação com OpenAI API Key

```json
{
  "OPENAI_API_KEY": "sk-..."
}
```

**Endpoint chamado:** `https://api.openai.com/v1/responses`

### Pool de Contas

Para usar múltiplas contas com fallback automático, crie arquivos em `auth-pool/`:

**Exemplo: `auth-pool/contas.json`**
```json
{
  "credential_pool": {
    "openai-codex": [
      {
        "label": "conta-producao",
        "auth_type": "oauth",
        "access_token": "token-1",
        "refresh_token": "opcional",
        "account_id": "opcional"
      },
      {
        "label": "conta-backup",
        "auth_type": "oauth",
        "access_token": "token-2"
      }
    ]
  }
}
```

**Comportamento:**
- Tenta a primeira conta com `access_token` ou `OPENAI_API_KEY`
- Se receber `401`, `403` ou `429`, pula automaticamente para a próxima
- Mantém registro de quais contas falharam naquele request

## 📡 API Endpoints

### Health Check

```http
GET /api/health
```

**Resposta:**
```json
{
  "ok": true,
  "model": "gpt-5.4-mini",
  "auth": {
    "hasAccessToken": true,
    "hasApiKey": false,
    "pool": { "available": 2, "accounts": 2 }
  },
  "llm": {
    "mock": false,
    "endpoint": "https://chatgpt.com/backend-api/codex"
  }
}
```

### Listar Contas

```http
GET /api/auth/accounts
```

Retorna status de todas as contas disponíveis no pool.

### Chat com Streaming SSE

**POST (recomendado):**
```http
POST /api/chat/sse
Content-Type: application/json

{
  "threadId": "conversacao-123",
  "text": "Explique como funciona streaming SSE",
  "instructions": "Você é um especialista em tecnologia",
  "model": "gpt-4-turbo"
}
```

**GET (rápido teste):**
```http
GET /api/chat/sse?threadId=demo&text=Oi
```

**Resposta (text/event-stream):**
```
event: status
data: {"type":"status","state":"thinking","detail":"codex"}

event: text_delta
data: {"type":"text_delta","text":"Streaming "}

event: text_delta
data: {"type":"text_delta","text":"em tempo real"}

event: completed
data: {"type":"completed","responseId":"resp-123","text":"Streaming em tempo real"}
```

### Chat sem Streaming (JSON)

```http
POST /api/chat/json
Content-Type: application/json

{
  "threadId": "conversacao-123",
  "text": "Sua pergunta aqui"
}
```

**Resposta:**
```json
{
  "ok": true,
  "responseId": "resp-123",
  "text": "Resposta completa da IA aqui"
}
```

## 🔄 Como Funciona o Streaming

```
┌─────────────────────────────────────────────────────────┐
│ 1. Cliente chama /api/chat/sse                          │
├─────────────────────────────────────────────────────────┤
│ 2. Server abre SSE com cliente                          │
│    - Envia evento "status" (thinking)                   │
├─────────────────────────────────────────────────────────┤
│ 3. CodexSessionProvider monta payload e chama           │
│    endpoint upstream (/responses) com stream: true      │
├─────────────────────────────────────────────────────────┤
│ 4. Upstream SSE é parseado em tempo real                │
│    - response.output_text.delta → text_delta            │
│    - response.completed → completed                     │
├─────────────────────────────────────────────────────────┤
│ 5. Eventos são retransmitidos ao cliente                │
├─────────────────────────────────────────────────────────┤
│ 6. Response ID e histórico são salvos em memória        │
└─────────────────────────────────────────────────────────┘
```

## 💾 Histórico por Thread

O servidor mantém em memória:

- **`previousResponseByThread`** - ID da última resposta por thread
- **`historyByThread`** - Histórico de 12 últimas mensagens por thread

### Funcionamento

**Com OpenAI API Key:**
- Usa `previous_response_id` para referenciar contexto prévio

**Com ChatGPT/Codex Token:**
- Manda histórico manual:
```js
[
  ...history,  // 12 últimas mensagens
  { role: "user", content: request.text }
]
```

## 🔐 Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `8788` | Porta do servidor |
| `HOST` | `127.0.0.1` | Host (localhost) |
| `CODEX_MODEL` | `gpt-5.4-mini` | Modelo LLM |
| `CODEX_AUTH_PATH` | Auto-detecta | Caminho para `auth.json` |
| `CODEX_BASE_URL` | ChatGPT endpoint | URL base para Codex |
| `OPENAI_BASE_URL` | OpenAI v1 endpoint | URL base para OpenAI |
| `CODEX_INSTRUCTIONS` | Padrão | Instrução padrão |
| `MOCK_LLM` | `0` | `1` para modo mock (sem credenciais) |

**Exemplo completo:**
```bash
PORT=3000 \
HOST=0.0.0.0 \
CODEX_MODEL=gpt-4-turbo \
CODEX_INSTRUCTIONS="Você é um especialista em IA" \
npm start
```

## 📁 Estrutura do Projeto

```
codex-llm/
├── server/
│   ├── index.js              # HTTP server e endpoints
│   ├── auth.js               # Carregamento de auth.json e pool
│   ├── config.js             # Seleção de modelo e endpoints
│   ├── codexProvider.js       # Chamadas ao /responses e fallback
│   ├── upstreamSse.js         # Parser de SSE upstream
│   └── outboundSse.js         # Escritor de SSE para cliente
├── public/
│   └── index.html            # Tester web minimalista
├── auth-pool/                # Pool de contas (ignorado no git)
│   └── README.md
├── auth.example.json         # Template de autenticação
├── config.example.toml       # Template de configuração
├── package.json
└── README.md
```

## 🛠️ Desenvolvimento

### Scripts Disponíveis

```bash
npm start      # Inicia servidor em produção
npm run dev    # Alias para start
npm run mock   # Inicia em modo mock (set MOCK_LLM=1)
```

### Requisitos

- **Node.js >= 18**
- npm 9+

### Dependências

- `express@^5.2.1` - Framework HTTP
- `cors@^2.8.5` - Middleware CORS

## 🔍 Troubleshooting

### Erro: "auth.json not found"
- Copie `auth.example.json` para `auth.json`
- Adicione suas credenciais
- Garanta que o arquivo está na raiz do projeto

### Erro: "401 Unauthorized"
- Verifique se o `access_token` é válido
- Confirme que não expirou
- Tente usar `OPENAI_API_KEY` se tiver uma

### Pool ignorando contas
- Confirme que `auth-pool/*.json` tem a estrutura correta
- Verifique se os tokens estão válidos
- Logs de erro aparecerão no console do servidor

### SSE não conecta
- Verifique se o servidor está rodando em `http://127.0.0.1:8788`
- Abra console do navegador (F12) e veja erros CORS
- Teste com `curl`:
```bash
curl -X POST http://127.0.0.1:8788/api/chat/sse \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"test\",\"text\":\"Oi\"}"
```

## 📊 Fluxo de Request

```
Browser/Client
     │
     ├─ POST /api/chat/sse
     │  {threadId, text}
     │
     ▼
Server (index.js)
     │
     ├─ normalizeChatBody()
     ├─ setupSse() → abre conexão SSE
     ├─ writeSse() → "status: thinking"
     │
     ▼
CodexSessionProvider.streamChat()
     │
     ├─ montaPayload() → {model, instructions, input, stream}
     ├─ lookupAuth() → seleciona conta do pool
     │
     ▼
HTTP POST /responses (upstream)
     │
     ├─ [Mock] → gera resposta fake
     ├─ [Real] → chama ChatGPT/OpenAI
     │
     ▼
upstreamSse.parseSseJson()
     │
     ├─ lê eventos: output_text.delta, completed
     │
     ▼
outboundSse.writeSse()
     │
     ├─ event: text_delta
     ├─ event: completed
     │
     ▼
Browser/Client
     (recebe resposta em tempo real)
```

## 🎯 Casos de Uso

- **Teste rápido de modelos** - Valide comportamento de diferentes modelos
- **Debug de streaming** - Analise SSE em tempo real
- **Pool de contas** - Distribua load em múltiplas contas
- **Integração com backend** - Use como microserviço de IA
- **Prototipagem** - Desenvolva sem STT/TTS/UI complexity

## 📝 Licença

Não especificada (verifique com o autor)

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se livre para abrir PRs e issues.

## ⚡ Performance

- Conexões SSE mantêm-se abertas durante streaming
- Histórico em memória (máx 12 msgs/thread)
- Pool com fallback automático em falhas 4xx/5xx
- Suporta múltiplas requisições simultâneas
