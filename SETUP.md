# ⚙️ Configuração da API Key

## Por que precisa de uma API Key?
O Nutri Secrets usa Claude (Anthropic) para gerar os cardápios terapêuticos.
Cada geração de cardápio consome tokens da sua conta Anthropic.

## Como configurar

### 1. Crie uma conta Anthropic
- Acesse: https://console.anthropic.com
- Crie uma conta e adicione créditos (começa a partir de $5)

### 2. Gere sua API Key
- No Console → API Keys → Create Key
- Copie a chave (começa com sk-ant-...)

### 3. Adicione a key no código
Abra index.html e encontre a linha:
```
headers: { "Content-Type": "application/json" },
```
Adicione abaixo:
```
"x-api-key": "SUA_CHAVE_AQUI",
"anthropic-version": "2023-06-01",
```

### 4. (Recomendado) Use variável de ambiente no Vercel
Para não expor sua chave no código, crie um backend simples.
Ver pasta /api para o proxy serverless pronto.

## 💰 Custo por uso
- Cada cardápio gerado: ~0,003 a 0,01 USD (menos de R$ 0,05)
- Com exame PDF: ~0,01 a 0,03 USD
- 100 pacientes/mês: ~R$ 5-15 em API
