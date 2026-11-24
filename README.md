# Inventário Patrimonial — Grupo FZA

Sistema web para cadastrar, localizar, transferir e dar baixa em equipamentos, com relatórios em PDF e XLSX.

**Tecnologias:** Node.js 18+ · Express · PostgreSQL 13+ · EJS (páginas renderizadas no servidor, sem etapa de build) · PDFKit · ExcelJS.
É um único processo Node ligado a um banco PostgreSQL. As fotos também ficam no banco, então não há pasta de arquivos para guardar.

## Funcionalidades

| Área | O que faz |
|---|---|
| Acesso | Login obrigatório em todas as telas e na API `/api/*`. O usuário **Adm** é criado uma única vez a partir de `ADMIN_INITIAL_PASSWORD` e precisa trocar a senha no primeiro acesso. Senhas com hash scrypt, proteção CSRF e limite de tentativas de login. |
| Usuários (somente administrador) | Criar, desativar, redefinir senha e alterar perfil. Perfis: **Administrador** e **Operador** (consulta e movimenta o inventário). |
| Setores | Nome, código de 2 dígitos e responsável. O código não muda depois de criado. A mesma tela gerencia as categorias. |
| Equipamentos | Ficha completa com foto opcional. Valor desconhecido fica como *não informado*, nunca como R$ 0,00. Quantidade maior que 1 gera uma ficha e um código por unidade. |
| Código patrimonial | `FZA.<setor>.<sequencial>`, gerado no servidor e único no banco, mesmo com cadastros simultâneos. Depois de 999 vem 1000. Códigos nunca são reutilizados. O código aparece em destaque na ficha para ser digitado na etiquetadora. |
| Movimentações | Transferência de setor e/ou troca de responsável. O código continua o mesmo e o histórico registra origem, destino, usuário, data e hora. |
| Baixa | Data, motivo, observações e confirmação. O item sai dos totais ativos, mas a ficha e o histórico continuam disponíveis. |
| Painel | Itens ativos, valor registrado, itens sem valor, baixados, movimentações recentes e totais por setor. |
| Relatórios | **Relatório geral** (consolidado: totais ativos e baixados; quadros por setor, categoria, situação, estado e motivo de baixa; listas de itens ativos, baixados e movimentações), **Inventário (itens)**, **Por setor**, **Por categoria**, **Transferências** e **Baixas**. Filtros por setor, categoria, responsável, estado, situação e período. Exportação em **PDF** (com todas as seções) e **XLSX** (uma aba por lista). |

---

## Publicar na internet — 100% gratuito

O GitHub guarda apenas o **código**. Para a equipe acessar pelo navegador, o sistema roda em dois serviços gratuitos:

- **Neon** (https://neon.tech): banco PostgreSQL gratuito e sem prazo de expiração (0,5 GB).
- **Render** (https://render.com): servidor web gratuito que lê o `render.yaml` deste repositório.

No momento desta versão, nenhum dos dois exige cartão de crédito no plano gratuito.

### 1. Banco de dados no Neon

1. Crie uma conta em https://neon.tech (dá para entrar com a conta do GitHub).
2. Crie um projeto (ex.: `inventario-fza`) na região **AWS US East (N. Virginia)**, a mesma do Render gratuito.
3. Na tela **Connect**, **desligue a opção “Connection pooling”** e copie a *connection string*. Ela começa com `postgresql://` e termina com `?sslmode=require`.

   A conexão precisa ser direta (sem pooling) porque o sistema usa travas do banco para gerar os códigos patrimoniais sem repetição.

### 2. Servidor no Render

1. Crie uma conta em https://render.com com **“Sign in with GitHub”**.
2. Clique em **New → Blueprint** e escolha o repositório `inventario-fza`. Se ele não aparecer, autorize o Render a ver o repositório.
3. Preencha as variáveis pedidas:
   - `DATABASE_URL`: a connection string copiada do Neon.
   - `ADMIN_INITIAL_PASSWORD`: a senha inicial do usuário **Adm** (mínimo 8 caracteres, com letras e números).
   - `APP_URL`: pode ficar em branco.
4. Clique em **Apply**. Em poucos minutos o sistema estará em `https://inventario-fza.onrender.com` (ou nome parecido).
5. Entre com **Adm** e a senha inicial, defina a nova senha e crie os setores e os usuários da equipe.

### Limites do plano gratuito

| Limite | O que significa na prática |
|---|---|
| O servidor “dorme” após 15 min sem acesso | O primeiro acesso depois de um tempo parado demora **cerca de 1 minuto** para abrir. Depois disso fica rápido. |
| Banco com 0,5 GB | O suficiente para milhares de equipamentos. As fotos são reduzidas automaticamente no navegador (cerca de 200 KB cada) antes do envio. |
| O banco também hiberna quando ninguém usa | Os dados ficam guardados; ele acorda sozinho em poucos segundos. |

**Backup:** exporte periodicamente os relatórios em XLSX ou faça um `pg_dump` da connection string do Neon:

```bash
pg_dump "postgresql://...neon.tech/neondb?sslmode=require" > backup.sql
```

Se um dia quiser eliminar a espera do primeiro acesso, basta mudar o plano do serviço no Render. Nada no código precisa mudar.

**Outras opções de hospedagem:** Railway, Fly.io ou uma VPS. Use o `Dockerfile` (ou `npm ci --omit=dev && npm start`) com estas variáveis:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL do PostgreSQL |
| `DATABASE_SSL` | `true` para bancos gerenciados acessados pela URL externa (Neon, Supabase, Railway…) |
| `SESSION_SECRET` | Texto aleatório longo |
| `ADMIN_INITIAL_PASSWORD` | Usada só no primeiro início. Depois disso pode ser removida. |
| `APP_URL` | Endereço público (opcional) |
| `NODE_ENV` | `production` (o cookie passa a exigir HTTPS) |
| `COOKIE_SECURE` | `false` apenas se o acesso for por HTTP na rede interna |


---

## Rodar localmente

Pré-requisitos: Node.js 18+ e PostgreSQL 13+.

1. Crie o banco:

```bash
createdb inventario
```

2. Instale as dependências:

```bash
npm install
```

3. Crie o arquivo de configuração e preencha `DATABASE_URL`, `SESSION_SECRET` e `ADMIN_INITIAL_PASSWORD`. Localmente, use `NODE_ENV=development`.

```bash
cp .env.example .env
```

4. Inicie:

```bash
npm start
```

Acesse http://localhost:3000 e entre com **Adm** e a senha inicial. As migrações (`migrations/*.sql`) rodam sozinhas a cada início.

### Com Docker (app + PostgreSQL)

Crie um `.env` com `SESSION_SECRET`, `ADMIN_INITIAL_PASSWORD` e `DB_PASSWORD`. Depois:

```bash
docker compose up -d --build
```

## Teste automatizado

`test/e2e.js` percorre o roteiro de aceite no Chromium: login, setores, cadastro, cadastros simultâneos, transferência, baixa, painel, todos os relatórios e exportações (conferindo os totais dentro do XLSX e do PDF), permissões e celular. Precisa de um **banco vazio** e do servidor rodando:

```bash
npm i -D playwright && BASE_URL=http://localhost:3000 ADMIN_NEW_PASSWORD=NovaSenha2026 npm test
```

## Estrutura

```
migrations/        SQL versionado (tabelas, restrições e gatilhos que impedem excluir item ou mudar código)
src/server.js      configuração do Express, sessão e rotas
src/auth.js        hash de senha, autenticação, permissões, CSRF
src/routes/        painel, equipamentos, setores, relatórios, usuários, api
src/services/      cadastro (geração de códigos), consultas, relatórios, exportação PDF/XLSX
views/             telas (EJS)
public/            CSS e JS do navegador
```

## API (somente leitura, exige sessão)

- `GET /api/resumo`
- `GET /api/equipamentos?busca=&setor=&categoria=&situacao=&limite=&offset=`
- `GET /api/equipamentos/FZA.01.001`: ficha com histórico
- `GET /api/setores`
