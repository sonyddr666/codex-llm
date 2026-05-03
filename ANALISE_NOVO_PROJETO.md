# Analise do `novo-projeto` para trazer prompt, vocabulario e memoria

Origem analisada:

`C:/Users/Larri/Desktop/base para uma llm-vtuber/novo-projeto`

Destino pensado:

`C:/Users/Larri/Documents/New project 10/codex-LLM`

Nao foram lidos nem copiados arquivos sensiveis como `codex/auth.json` ou `data/tts_secrets.json`.

## O que eu li

Arquivos principais:

- `README.md`: descreve um MVP local de LLM-VTuber com web, STT do Chrome, LLM via Codex, TTS, memoria local JSON, visao por screenshot e prompt/persona local.
- `data/system_prompt.md`: prompt gigante da personagem Base, "O Fantasma no Tesla".
- `data/vocabulary.txt`: vocabulario grande com termos de aura, energia, colapso estetico, bug, IA e girias/persona.
- `data/persona.json`: nome, idioma, estilo e regras curtas da personagem.
- `data/settings.json`: configuracoes de TTS/STT/modelo/voz.
- `data/summary.json`: memoria resumida dos turnos antigos.
- `data/history.json`: historico simples de mensagens.
- `server.py`: trecho que monta o system prompt final e envia em `instructions`.
- `gui_app.py`: tela de configuracoes com dois editores, "System prompt" e "Vocabulario", cada um com botao de salvar.
- `codex-LLM/public/chat.html`: chat atual ja tem painel de configuracoes, modelo, inteligencia e system prompt em memoria da pagina.
- `codex-LLM/server/codexProvider.js`: provedor atual ja aceita `instructions`, `model`, `reasoningEffort` e historico.
- `codex-LLM/server/chatStore.js`: chat atual ja salva conversas em arquivos `chats/*.json`.

## Como o `novo-projeto` faz

O ponto central esta em `server.py`, na funcao `build_system_prompt(...)`.

Ela carrega:

- `data/system_prompt.md`
- `data/vocabulary.txt`
- `data/persona.json`
- `data/summary.json`

Depois monta um texto unico:

```text
Prompt editavel do usuario:
<system_prompt.md>

Voce tambem e <persona.name>, uma personagem VTuber local.
Idioma: <persona.language>.
Estilo: <persona.style>.

Regras:
<persona.rules>

Memoria resumida:
<summary.json.summary>

Vocabulario local:
<vocabulary.txt>
```

Esse bloco vai para a LLM como `instructions`.

Ou seja: o vocabulario nao e um recurso separado da LLM. Ele entra como contexto fixo no prompt. A LLM passa a usar esses termos porque recebe essa lista antes da pergunta.

## O que ja existe no `codex-LLM`

O `codex-LLM` ja tem a parte mais importante pronta:

- chat simples estilo ChatGPT em `public/chat.html`;
- streaming SSE em `/api/chat/sse`;
- arquivos de chat em `chats/*.json`;
- seletor de modelo;
- nivel de inteligencia;
- system prompt digitado na tela;
- envio de `instructions` para o backend;
- provider usando `instructions` no payload da LLM.

O que ainda falta e persistir e organizar essas configuracoes em arquivos, igual ao projeto antigo.

## O que vale trazer para ca

Trazer a ideia, nao o projeto inteiro.

Estrutura sugerida:

```text
codex-LLM/
  memory/
    system_prompt.md
    vocabulary.txt
    persona.json
    summary.json
```

Endpoints sugeridos:

```text
GET  /api/memory
PUT  /api/memory/system-prompt
PUT  /api/memory/vocabulary
PUT  /api/memory/persona
PUT  /api/memory/summary
```

Ou, mais simples:

```text
GET /api/settings/context
PUT /api/settings/context
```

com JSON:

```json
{
  "systemPrompt": "...",
  "vocabulary": "...",
  "persona": {
    "name": "Base",
    "language": "pt-BR",
    "style": "curta, natural, presente e util",
    "rules": []
  },
  "summary": ""
}
```

## Como acoplar no chat atual

No frontend `public/chat.html`:

1. Manter o chat como esta.
2. Trocar o painel "Configuracoes" para ter abas pequenas:
   - Geral
   - System prompt
   - Vocabulario
   - Memoria
3. Carregar os textos ao abrir a pagina.
4. Salvar em arquivo pelo backend quando clicar em salvar.
5. Na hora de enviar mensagem, nao depender mais so do texto em memoria da pagina.

No backend:

1. Criar `server/contextStore.js`.
2. Esse arquivo cria `memory/` se nao existir.
3. Ele le e salva `system_prompt.md`, `vocabulary.txt`, `persona.json`, `summary.json`.
4. Criar uma funcao `buildInstructions(requestInstructions)` que junta:
   - prompt salvo em arquivo;
   - prompt extra da tela, se existir;
   - persona;
   - memoria resumida;
   - vocabulario;
   - nivel de inteligencia.
5. Usar esse resultado em `codexProvider.streamChat`.

## Modelo mental

Hoje:

```text
chat.html -> monta instructions -> /api/chat/sse -> Codex
```

Depois:

```text
chat.html -> pergunta + opcoes
backend -> le arquivos memory/*
backend -> monta instructions completo
backend -> /responses do Codex
```

Isso e melhor porque:

- o prompt nao some ao recarregar a pagina;
- o vocabulario vira arquivo editavel;
- a persona fica reutilizavel;
- da para versionar o contexto sem versionar chats/auth;
- o backend controla o prompt final, nao so o navegador.

## Cuidado importante

Nao colocar tudo sempre se ficar enorme demais.

O `vocabulary.txt` e grande. Se crescer muito, pode comer contexto e deixar a resposta mais lenta/cara. O ideal e:

- comecar enviando tudo, porque e simples;
- depois criar modo "vocabulario ativo por busca", pegando so as linhas relevantes pelo texto do usuario.

## Plano de implementacao seguro

1. Criar `memory/` com arquivos default.
2. Copiar para la o `system_prompt.md` e `vocabulary.txt` do `novo-projeto`, se o usuario quiser.
3. Criar `server/contextStore.js`.
4. Adicionar rotas GET/PUT para ler/salvar contexto.
5. Alterar `server/index.js` para usar `buildInstructions`.
6. Atualizar `public/chat.html` com editor de System prompt e Vocabulario.
7. Testar:
   - abrir chat;
   - salvar prompt;
   - salvar vocabulario;
   - recarregar pagina;
   - perguntar algo;
   - conferir que o estilo/persona apareceu na resposta.

## Resumo

O `novo-projeto` tem uma boa arquitetura de contexto local:

- prompt em arquivo;
- vocabulario em arquivo;
- persona em JSON;
- memoria resumida em JSON;
- tudo montado em `instructions`.

O `codex-LLM` ja tem o chat, SSE, modelos, auth pool e historico em arquivo. Entao o melhor caminho e trazer apenas essa camada de contexto/prompt persistente para o backend atual.
