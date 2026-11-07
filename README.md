# LendControl V6.5

Sistema de controle de empréstimos no modelo **RE-EMPRÉSTIMO Cliente → Funcionário → Dono**, com carteira independente (revolving), régua de cobrança pelo WhatsApp, score automático e backup semanal em Excel com as **Regras BANE** (dá para tocar o negócio só pela planilha se o sistema cair).

- `backend/` — API NestJS 11 + Prisma 6 + PostgreSQL
- `web/` — painel de gestão React + Vite (leve: ~70 KB gzip, sem biblioteca de UI)
- `docs/telas/` — prints das telas

## Rodando local

```bash
docker compose up -d                 # PostgreSQL (ou use um Postgres seu)
cd backend
cp .env.example .env                 # ajuste os segredos
npm install
npx prisma migrate deploy
npm run seed                         # admin@, dono@, funcionario@lendcontrol.local — senha lend1234
npm run start:dev                    # API em http://localhost:3000/api

cd ../web
npm install
npm run dev                          # painel em http://localhost:5173
```

Produção: `cd web && npm run build`, depois `cd backend && npm run build && npm start`. A API serve o painel de `web/dist` no mesmo endereço.

Testes: `cd backend && npm test` (19 testes das regras) e `npm run test:e2e` (38 testes: fluxo completo + auditoria de todas as funções e da régua, no banco do `.env` — use um banco de teste).

## O que tem

| Área | Como funciona |
|---|---|
| **Loan Engine** | 4 métodos (diário, semanal, quinzenal, mensal), Tabela Price, multa diária `ValorAtual = Parcela × (1 + %multa × dias)`, projeção automática das 3 próximas datas (30/10 → 30/11, fim de mês igual ao EDATE). |
| **Só juros** | A parcela fica “só juros” e uma nova parcela igual é criada no final do cronograma. |
| **Quitação total** | Principal em aberto + juros e multa vencidos; todas as parcelas abertas são apagadas (canceladas) e o empréstimo fecha. |
| **Approval Lock** | “Só juros” e “quitação” ficam `AGUARDANDO_APROVACAO`. Só o Dono aprova, com biometria do aparelho (WebAuthn) ou senha. Quem lançou nunca aprova o próprio lançamento. |
| **Carteira / equipe** | Dono faz aporte e `REPASSE_CAPITAL` (ex.: R$ 10.000) ao funcionário → funcionário empresta → cliente paga o funcionário → principal volta ao capital do funcionário (revolving) → juros e multa: 30% comissão, 70% “a repassar” → funcionário faz `REPASSE_RECEBIMENTO` ao Dono. Todo movimento cai no `CashLedger`. |
| **Score** | 0–10 automático; cliente novo começa REGULAR e vira BOM ao pagar em dia (recalcula todo dia 06:00 e a cada pagamento). 8–10 BOM ⭐ (margem R$ 1.500, taxa 8%), 5–7 REGULAR, 2–4 RUIM ⚠️ (margem R$ 500, novo empréstimo só com liberação do Dono), 0–1 ou 180+ dias PERDA 💀 (bloqueado, só o Super Admin desbloqueia). Cada faixa mostra as estratégias de cobrança (emergência, fiador, visita, desconto 10%, parcelamento, carta PDF, negativação, acordo 30%, jurídico). |
| **Ficha do cliente** | 5 abas: Dados pessoais · Contato/Endereço (ViaCEP) · Financeiro/PIX · Vínculos (emergência, fiador linkado a outro cliente, indicação) · Documentos/Recibos (inclui o comprovante enviado pelo cliente). Inputs brancos `#FFFFFF` com texto `#0F172A`. |
| **Importador WhatsApp** | Cola a mensagem: linha `NOME;CPF;RG;NASCIMENTO;…` (18 campos) ou bloco `Nome: … CPF: …`. Mostra a prévia “14 de 18 campos” e o que falta antes de preencher. |
| **Mensagens** | Régua D-2, D-0, D+1, D+3, D+7 (+ fiador) e, depois do D+7, lembrete toda semana (D+14, D+21…, também ao fiador) até pagar. Textos editáveis. Cada funcionário vê só a fila dos próprios empréstimos. Envia pela Evolution API (conexão por QR code) ou gera links `wa.me` quando ela não está configurada. Envio automático 09:00 opcional. |
| **Alertas para você** | Faixa no Painel e número vermelho no menu Cobrança com as mensagens do dia; número em Aprovações; resumo diário às 08:30 por e-mail (atrasos, vencimentos do dia, aprovações e fila). |
| **Documentos** | Armazenamento privado; cada abertura gera link assinado (HMAC) que vale 5 minutos. |
| **Atalhos** | `Ctrl+N` novo empréstimo · `Ctrl+E` baixa o Excel completo. |

## Exportar e importar (retirar e devolver os dados)

Tela **Exportar / Importar** (Dono):

1. **Excel completo** (`Ctrl+E`): 7 abas — Clientes, Emprestimos, Parcelas, Pagamentos, Equipe, Movimentacoes, Calculadora_BANE. Cada aba vem pronta para 500 linhas com as fórmulas já preenchidas.
2. **CSV por tabela**: arquivo leve com `;` e acentos corretos, abre direto no Excel.
3. **Modelo vazio**: 6 registros de teste + linhas modelo até 500.
4. **Importar**: arraste o `.xlsx` (inteiro ou só algumas abas) ou um `.csv`. Primeiro aparece a **prévia** com erros e avisos; só grava quando você confirma. **Nada é apagado**: o mesmo ID ou CPF atualiza o registro, o resto é incluído, e cada aba vai para a sua área (equipe, clientes, empréstimos, parcelas, pagamentos, movimentações).
5. **Backup automático** toda segunda 08:00 (horário de Brasília), mantém os 10 últimos e envia para o e-mail configurado em **Configurações** (precisa do SMTP no `.env`).

### Regras BANE (fórmulas na planilha)

- Parcelas: `Dias atraso = HOJE() − Vencimento` · `Valor atualizado = Original × (1 + multa × dias)` · penalidade de score por parcela
- Clientes: maior atraso, pontos perdidos, **score automático** e status BOM/REGULAR/RUIM/PERDA com cores
- Emprestimos: valor da parcela por `PMT`, último vencimento e **projeção 3x com EDATE**, saldo atualizado
- Calculadora_BANE: calculadora de empréstimo com cronograma de 36 parcelas, calculadora de atraso e o passo a passo para operar só pela planilha

Fórmulas conferidas recalculando no LibreOffice (0 erros); funcionam no Excel 2019+/365 e no LibreOffice.

## Publicar no Render (para testar no celular)

1. Crie uma conta grátis em https://render.com entrando com o GitHub.
2. Clique em **New > Blueprint**, escolha o repositório `Projeto_Finance` e o branch `main`.
3. O Render lê o `render.yaml` e cria o banco e o serviço `lendcontrol`. Ele pede o `SEED_PASSWORD`: digite a senha inicial dos usuários admin@, dono@ e funcionario@lendcontrol.local.
4. Clique em **Apply**. Em uns 5 minutos o sistema fica no ar em `https://lendcontrol.onrender.com` (ou o endereço que o Render mostrar).
5. No celular, instale o **Expo Go**, rode `cd mobile && npx expo start` no PC e leia o QR code. Em **Servidor**, coloque o endereço do Render.

Limites do plano grátis: o serviço dorme depois de 15 minutos parado (a primeira abertura demora ~1 minuto), então os horários automáticos (score 06:00, resumo 08:30, backup de segunda) só rodam se ele estiver acordado; os arquivos enviados e os backups em disco somem quando ele reinicia; e o banco grátis expira em 30 dias. Para uso real, troque para os planos pagos (Starter) e adicione um disco.

## Perfis

- **Super Admin**: tudo, inclusive desbloquear cliente PERDA
- **Dono**: equipe, repasses, aprovações, exportar/importar, configurações
- **Funcionário**: os próprios clientes e empréstimos, lança pagamentos, repassa ao Dono

## Pontos a configurar em produção

- `JWT_SECRET` e `STORAGE_SIGNING_SECRET` fortes.
- SMTP para o e-mail do backup e Evolution API para o WhatsApp automático.
- A biometria usa WebAuthn do navegador para confirmar o aprovador no aparelho; o servidor registra a confirmação. Para validar a assinatura no servidor, plugue `@simplewebauthn/server` no endpoint de aprovação.
- Documentos ficam em disco (`STORAGE_DIR`); para nuvem, troque o `StorageService` por S3/R2 mantendo os métodos.

## App celular (Expo) — `mobile/`

App para o dia a dia no celular (Android e iPhone), usando a mesma API:

- **Hoje**: resumo do painel, fila de cobrança do dia com botão de WhatsApp e lista de atrasados.
- **Clientes**: busca, ficha resumida, WhatsApp/ligação para o cliente e o fiador, empréstimos.
- **Empréstimo**: parcelas e ações Receber / Só juros / Quitar tudo (as duas últimas vão para aprovação).
- **Aprovações** (Dono): aprova com a digital/Face ID do aparelho; sem biometria, pede a senha.
- **Carteira**: capital, comissão, saldo a repassar e botão "Repassar ao Dono".

```bash
cd mobile
npm install
npx expo start          # abra no Expo Go lendo o QR code
```

Na tela de entrada, informe em **Servidor** o endereço do sistema publicado (ex.: `https://lendcontrol.onrender.com`; com ou sem `/api` no fim). O token fica guardado no armazenamento seguro do aparelho.
