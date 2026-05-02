# Auth pool

Coloque aqui arquivos `*.json` locais com uma ou mais contas.

Exemplo:

```json
{
  "credential_pool": {
    "openai-codex": [
      {
        "label": "conta-1",
        "auth_type": "oauth",
        "access_token": "access-token-da-conta-1",
        "refresh_token": "refresh-token-opcional",
        "account_id": "account-id-opcional"
      },
      {
        "label": "conta-2",
        "auth_type": "oauth",
        "access_token": "access-token-da-conta-2"
      }
    ]
  }
}
```

Arquivos `*.json` desta pasta sao ignorados pelo git.

O servidor tenta a primeira conta com `access_token` ou `OPENAI_API_KEY`.
Se a API retornar `401`, `403` ou `429`, ele pula para a proxima conta disponivel.
