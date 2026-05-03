# codex-LLM

Chat local minimalista para conversar com modelos Codex/ChatGPT via streaming SSE.

Esta pasta nasceu como uma copia LLM-only: sem avatar, sem TTS e sem frontend pesado. Agora ela tem um chat simples, persistencia em arquivos, configuracoes editaveis e entrada por microfone.

## O Que Tem Aqui

- Chat web simples em `public/chat.html`
- Streaming SSE ao vivo para a resposta aparecer enquanto chega
- Pool local de contas em `auth-pool/*.json`
- Fallback para `OPENAI_API_KEY`
- Historico salvo em arquivos `chats/*.json`
- Nome automatico do chat a partir da primeira conversa
- System prompt editavel pela interface
- Vocabulario local editavel pela interface
- Memoria resumida editavel pela interface
- Markdown basico nas respostas
- Botao copiar nas mensagens do assistente
- Data/hora e tempo de resposta nas mensagens
- Modal interno para apagar chat, sem `alert()` do navegador
- Botao `Mic` para escrever por voz na barra de texto
- Fallback STT Python para quando o Web Speech do Chrome falhar

## Como Rodar

Instale dependencias:

```bash
npm install
```

Rode o servidor:

```bash
npm start
```

Abra:

```text
http://127.0.0.1:8788/chat.html
```

No Windows tambem pode usar:

```bat
run_codex_llm.bat
```

## Modo Com STT Python Sidecar

O botao `Mic` tenta usar primeiro o STT nativo do navegador:

```text
window.SpeechRecognition || window.webkitSpeechRecognition
```

Se o Chrome/Edge bloquear, falhar, ou se o navegador nao tiver Web Speech, o chat cai para o modo STT local por Python.

Para o modo Python funcionar de forma estavel, rode:

```bat
run_codex_llm_with_stt.bat
```

Esse bat abre:

1. O servidor Node do chat.
2. O sidecar Python `stt-config-ok.py`, que captura o microfone local.

Tambem da para rodar o sidecar separado:

```bat
run_stt_sidecar.bat
```

O sidecar usa:

```text
C:\Users\Larri\Documents\PRGRAMACAO\stt\openya\stt-config-ok.py
C:\Users\Larri\Documents\PRGRAMACAO\stt\openya\token.txt
```

Ele escreve a transcricao acumulada em:

```text
runtime/external-stt.txt
```

O chat le esse arquivo e joga o texto na barra de mensagem.

Importante: o token fica na pasta original do STT. O projeto nao copia nem imprime token.

## Como O Mic Funciona

Fluxo normal pelo navegador:

```text
Chrome/Edge Web Speech API
        -> textarea do chat
        -> Enviar
        -> LLM SSE
```

Fluxo fallback pelo Python:

```text
Python sounddevice
        -> turnos por silencio
        -> ChatGPT transcribe
        -> runtime/external-stt.txt
        -> textarea do chat
        -> Enviar
        -> LLM SSE
```

O Python nao depende da permissao de microfone do navegador. Ele usa o microfone pelo sistema operacional.

## Auth

O servidor procura auth dentro da pasta do projeto:

```text
auth.json
auth-pool/*.json
```

Tambem aceita:

```text
CODEX_AUTH_PATH=C:\...\codex-LLM\auth.json
```

Por seguranca, o caminho precisa continuar dentro da pasta do projeto.

### Auth Unico

Exemplo `auth.json`:

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

Com `access_token`, o servidor chama:

```text
https://chatgpt.com/backend-api/codex/responses
```

Com `OPENAI_API_KEY`, chama:

```text
https://api.openai.com/v1/responses
```

## Pool De Contas

O pool fica em:

```text
auth-pool/*.json
```

Formato esperado:

```json
{
  "credential_pool": {
    "openai-codex": [
      {
        "label": "conta-1",
        "auth_type": "oauth",
        "access_token": "token-1",
        "account_id": "opcional"
      }
    ]
  }
}
```

O loader:

- le todos os JSONs do pool
- aceita arquivo unico ou `credential_pool.openai-codex`
- ordena contas por `exp` do JWT
- ignora tokens expirados
- usa cache por tamanho/mtime do arquivo

O provider:

- escolhe uma conta disponivel
- chama `/responses`
- se receber `401`, `403` ou `429`, pula aquela conta nesta request
- tenta a proxima conta do pool

## Modelo E Inteligencia

Modelo padrao:

```text
gpt-5.4-mini
```

Ordem de configuracao:

1. `CODEX_MODEL`
2. `config.toml`
3. fallback `gpt-5.4-mini`

Exemplo:

```powershell
$env:CODEX_MODEL = "gpt-5.4-mini"
npm start
```

Na interface existem niveis:

```text
Baixa
Media
Alta
Altissimo
```

`Baixa` e `Media` nao enviam `reasoning`.

`Alta` e `Altissimo` enviam:

```json
{
  "reasoning": {
    "effort": "high"
  }
}
```

Neste provider, `Altissimo` e um rotulo de UI mapeado para `high`, porque o endpoint usado aqui aceita `low`, `medium` e `high`.

## Configuracoes Do Chat

A aba `Configuracoes` tem:

- `Geral`: modelo e inteligencia
- `Prompt`: system prompt editavel
- `Vocabulario`: termos locais relevantes
- `Memoria`: resumo persistente

Arquivos:

```text
memory/system_prompt.md
memory/vocabulary.txt
memory/persona.json
memory/summary.json
```

O backend monta as instrucoes finais em `server/contextStore.js`.

Para evitar prompt gigante em toda chamada:

- system prompt e limitado por `MAX_SYSTEM_PROMPT_CHARS`
- vocabulario e filtrado por termos relevantes da pergunta

## Chats Salvos

Os chats ficam em:

```text
chats/*.json
```

Exemplo:

```text
chats/20260502-225657-oi.json
```

Cada arquivo guarda:

- `id`
- `title`
- `createdAt`
- `updatedAt`
- mensagens
- tempo de resposta do assistente quando disponivel

Nao usa `localStorage`.

## Endpoints

Health:

```http
GET /api/health
```

Contas:

```http
GET /api/auth/accounts
```

Contexto:

```http
GET /api/context
PUT /api/context
```

Chats:

```http
GET /api/chats
POST /api/chats
GET /api/chats/:id
DELETE /api/chats/:id
```

Chat SSE:

```http
POST /api/chat/sse
Content-Type: application/json

{
  "chatId": "opcional",
  "text": "Oi",
  "model": "gpt-5.4-mini",
  "instructions": "opcional",
  "reasoningEffort": "high"
}
```

Chat JSON sem streaming:

```http
POST /api/chat/json
```

STT Python:

```http
GET /api/stt/external/status
POST /api/stt/external/start
POST /api/stt/external/stop
GET /api/stt/external/text?cursor=0
```

## Variaveis De Ambiente

```text
HOST=127.0.0.1
PORT=8788
CODEX_MODEL=gpt-5.4-mini
CODEX_AUTH_PATH=C:\...\codex-LLM\auth.json
CODEX_CONFIG_PATH=C:\...\codex-LLM\config.toml
CODEX_BASE_URL=https://chatgpt.com/backend-api/codex
OPENAI_BASE_URL=https://api.openai.com/v1
CODEX_INSTRUCTIONS=Voce e um assistente direto.
MAX_SYSTEM_PROMPT_CHARS=12000
MOCK_LLM=1
STT_SCRIPT_PATH=C:\Users\Larri\Documents\PRGRAMACAO\stt\openya\stt-config-ok.py
STT_SCRIPT_CWD=C:\Users\Larri\Documents\PRGRAMACAO\stt\openya
STT_OUTPUT_PATH=C:\...\runtime\external-stt.txt
STT_PYTHON=python
```

## Modo Mock

Para testar o frontend e o SSE sem credenciais:

```powershell
$env:MOCK_LLM = "1"
npm start
```

Ou:

```bat
npm run mock
```

## Estrutura

```text
codex-LLM/
  public/
    chat.html                  chat principal
    index.html                 tester SSE simples
  server/
    index.js                   servidor Express e rotas
    auth.js                    auth unico e pool local
    codexProvider.js           chamada /responses e SSE upstream
    contextStore.js            prompt, vocabulario, persona e memoria
    chatStore.js               persistencia dos chats
    externalStt.js             ponte com STT Python
    upstreamSse.js             parser SSE vindo da API
    outboundSse.js             escritor SSE local
  memory/
    system_prompt.md
    vocabulary.txt
    persona.json
    summary.json
  chats/
    *.json
  auth-pool/
    *.json
  runtime/
    external-stt.txt
```

## Git

Nao suba:

```text
node_modules/
auth.json
auth-pool/*.json
chats/
runtime/
*.log
```

Tokens, cookies e historico local devem ficar fora do Git.

## Troubleshooting

Se o LLM responder `Nenhuma conta disponivel no pool local`:

- veja se existe JSON em `auth-pool/`
- confira se o token nao expirou
- acesse `GET /api/auth/accounts`

Se o microfone do navegador falhar:

- use Chrome ou Edge
- confira permissao do navegador
- rode `run_codex_llm_with_stt.bat` para usar o STT Python

Se o STT Python nao escrever texto:

- confira se `token.txt` existe na pasta `openya`
- rode `python stt-config-ok.py --no-meter` direto para ver erros
- veja se `runtime/external-stt.txt` esta mudando

Se o Node nao conseguir iniciar Python:

- isso pode aparecer como `spawn EPERM`
- rode `run_stt_sidecar.bat` separado
- o chat ainda consegue ler o arquivo de saida do sidecar
