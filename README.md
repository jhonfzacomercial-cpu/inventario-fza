# Inventário Patrimonial — Grupo FZA

Sistema web para cadastrar, localizar, transferir e dar baixa em equipamentos, com relatórios em PDF e XLSX e **cadastro pelo WhatsApp**.

**Tecnologias:** Node.js 18+ · Express · PostgreSQL 13+ · EJS (páginas renderizadas no servidor, sem etapa de build) · PDFKit · ExcelJS.
É um único processo Node ligado a um banco PostgreSQL. As fotos também ficam no banco, então não há pasta de arquivos para guardar.

## Funcionalidades

| Área | O que faz |
|---|---|
| Acesso | Login obrigatório em todas as telas e na API `/api/*`. O usuário **Adm** é criado uma única vez a partir de `ADMIN_INITIAL_PASSWORD` e precisa trocar a senha no primeiro acesso. Senhas com hash scrypt, proteção CSRF e limite de tentativas de login. |
| Usuários (somente administrador) | Criar, desativar, redefinir senha, alterar perfil e vincular o WhatsApp. Perfis: **Administrador** e **Operador** (consulta e movimenta o inventário). |
| Setores | Nome, código de 2 dígitos e responsável. O código não muda depois de criado. A mesma tela gerencia as categorias. |
| Equipamentos | Ficha completa com foto opcional. Valor desconhecido fica como *não informado*, nunca como R$ 0,00. Quantidade maior que 1 gera uma ficha e um código por unidade. |
| Código patrimonial | `FZA.<setor>.<sequencial>`, gerado no servidor e único no banco, mesmo com cadastros simultâneos. Depois de 999 vem 1000. Códigos nunca são reutilizados. O código aparece em destaque na ficha para ser digitado na etiquetadora. |
| Movimentações | Transferência de setor e/ou troca de responsável. O código continua o mesmo e o histórico registra origem, destino, usuário, data e hora. |
| Baixa | Data, motivo, observações e confirmação. O item sai dos totais ativos, mas a ficha e o histórico continuam disponíveis. |
| Painel e relatórios | Totais ativos, valor registrado, itens sem valor e movimentações recentes. Relatórios geral, por setor, de transferências e de baixas, exportáveis em PDF e XLSX. |
| WhatsApp | Usuários com número vinculado enviam os dados do equipamento (e uma foto) para o número da empresa. O sistema confere, pede confirmação e cadastra, respondendo com o código gerado. |

---

## Publicar na internet (acesso para qualquer pessoa com login e senha)

O GitHub guarda apenas o **código**. Para a equipe acessar pelo navegador, o sistema precisa rodar em um servidor com banco PostgreSQL. A forma mais simples é o **Render**, que lê o arquivo `render.yaml` deste repositório e cria tudo sozinho.

1. Crie uma conta em https://render.com e conecte sua conta do GitHub.
2. Clique em **New → Blueprint** e escolha este repositório.
3. O Render vai pedir os valores das variáveis marcadas como “sync: false”:
   - `ADMIN_INITIAL_PASSWORD`: a senha inicial do usuário **Adm** (mínimo 8 caracteres, com letras e números).
   - `APP_URL`: pode ficar em branco no primeiro deploy. Depois, preencha com o endereço que o Render gerar (ex.: `https://inventario-fza.onrender.com`).
   - Variáveis `WHATSAPP_*`: deixe em branco por enquanto (veja a seção do WhatsApp).
4. Clique em **Apply**. Em poucos minutos o sistema estará no ar no endereço `https://<nome>.onrender.com`.
5. Entre com **Adm** e a senha inicial, defina a nova senha e crie os usuários da equipe em **Usuários**.

O `render.yaml` usa planos pagos de entrada (serviço web e banco), porque o banco gratuito do Render é temporário e apagaria os dados. Confira os valores atuais em https://render.com/pricing. Para usar um domínio próprio (ex.: `inventario.grupofza.com.br`), acesse *Settings → Custom Domains* no Render e atualize `APP_URL`.

**Outras opções:** Railway, Fly.io ou uma VPS. Use o `Dockerfile` (ou `npm ci --omit=dev && npm start`) com estas variáveis:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | URL do PostgreSQL |
| `DATABASE_SSL` | `true` para bancos gerenciados acessados pela URL externa (Neon, Supabase, Railway…) |
| `SESSION_SECRET` | Texto aleatório longo |
| `ADMIN_INITIAL_PASSWORD` | Usada só no primeiro início. Depois disso pode ser removida. |
| `APP_URL` | Endereço público, usado nos links enviados pelo WhatsApp |
| `NODE_ENV` | `production` (o cookie passa a exigir HTTPS) |
| `COOKIE_SECURE` | `false` apenas se o acesso for por HTTP na rede interna |

**Backup:** basta fazer o `pg_dump` do banco (as fotos estão incluídas):

```bash
pg_dump "$DATABASE_URL" > backup.sql
```

---

## Cadastro pelo WhatsApp

### Como funciona para o usuário

1. O administrador vincula o celular do usuário em **Usuários → Gerenciar → WhatsApp**. Só números vinculados a usuários ativos são aceitos.
2. O usuário envia para o número da empresa uma mensagem neste formato (pode ser a legenda de uma foto do equipamento):

```
Descrição: Notebook Dell Latitude 5440
Categoria: Notebook
Setor: 01
Marca: Dell
Modelo: Latitude 5440
Série: ABC123
Responsável: Carla Mendes
Valor: 6.890,00
Data: 10/03/2024
Estado: bom
Quantidade: 1
Obs: com carregador
```

   Somente **Descrição**, **Categoria** e **Setor** são obrigatórios. Para valor desconhecido, use `Valor: desconhecido`. Para várias unidades, use `Quantidade: 3` e `Série: A1, A2, A3`.
3. O sistema responde com um resumo para conferência. O usuário responde **SIM** para gravar ou **CANCELAR** para descartar. O resumo vale por 30 minutos.
4. Depois do **SIM**, o sistema responde com o(s) código(s) patrimonial(is), por exemplo `FZA.01.004`, para digitar na etiquetadora.

Outros comandos: **AJUDA**, **MODELO** (envia o formulário em branco), **SETORES** (lista setores e categorias), **CONSULTAR FZA.01.001**.
O cadastro aparece no histórico do item com o nome do usuário e a indicação “Cadastro feito pelo WhatsApp”.

A tela **WhatsApp** (somente administrador) mostra o status da integração, os números autorizados e as últimas mensagens. Ela também tem um campo para testar como uma mensagem será interpretada, sem cadastrar nada.

### Configuração (uma vez)

A integração usa a **API oficial do WhatsApp (WhatsApp Cloud API, da Meta)**. Você precisa de um número de telefone que **não** esteja em uso no aplicativo WhatsApp comum (pode ser um chip novo ou um fixo da empresa).

1. Em https://business.facebook.com, crie (ou use) o Gerenciador de Negócios do Grupo FZA.
2. Em https://developers.facebook.com, clique em **Meus apps → Criar app → tipo “Empresa”** e adicione o produto **WhatsApp**.
3. Em **WhatsApp → Configuração da API**, adicione e verifique o número da empresa. Anote o **ID do número de telefone** e coloque-o em `WHATSAPP_PHONE_NUMBER_ID`.
4. Gere um **token permanente**: em Configurações do negócio → Usuários do sistema, crie um usuário do sistema administrador, atribua o app e gere um token com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Coloque-o em `WHATSAPP_TOKEN`.
5. Em **Configurações do app → Básico**, copie a **Chave secreta do aplicativo** para `WHATSAPP_APP_SECRET`.
6. Invente uma senha qualquer para o webhook e coloque-a em `WHATSAPP_VERIFY_TOKEN`.
7. Salve as variáveis no servidor (no Render: *Environment*) e reinicie o serviço.
8. Em **WhatsApp → Configuração** no painel da Meta, em *Webhook*, informe:
   - **URL de retorno:** `https://SEU-ENDERECO/webhooks/whatsapp` (aparece pronta na tela WhatsApp do sistema)
   - **Token de verificação:** o mesmo valor de `WHATSAPP_VERIFY_TOKEN`

   Clique em *Verificar e salvar* e depois **assine o campo `messages`**.
9. Publique o app (modo *Ao vivo*).

**Custos:** as respostas do sistema são “conversas de serviço” iniciadas pelo usuário, que pela política atual da Meta não são cobradas. A Meta pode alterar essa política; confira em https://developers.facebook.com/docs/whatsapp/pricing.

**Segurança:** o endereço `/webhooks/whatsapp` é o único sem login, porque é chamado pela Meta. Toda requisição precisa da assinatura `X-Hub-Signature-256` gerada com a chave secreta do app; sem ela é rejeitada. Mensagens repetidas são ignoradas e números não vinculados recebem apenas uma recusa.

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

## Testes automatizados

- `test/e2e.js` percorre o roteiro de aceite no Chromium (login, setores, cadastro, cadastros simultâneos, transferência, baixa, painel, exportações, permissões e celular).
- `test/whatsapp.js` simula a API da Meta e testa o webhook: assinatura, números não autorizados, validação, foto, confirmação, mensagens duplicadas e consulta.

Os dois precisam de um **banco vazio**. O servidor deve rodar com as variáveis de teste do WhatsApp:

```bash
WHATSAPP_API_URL=http://localhost:3999 WHATSAPP_TOKEN=tk WHATSAPP_PHONE_NUMBER_ID=123 WHATSAPP_VERIFY_TOKEN=verifica WHATSAPP_APP_SECRET=segredo npm start
```

Em outro terminal:

```bash
npm i -D playwright && BASE_URL=http://localhost:3000 ADMIN_NEW_PASSWORD=NovaSenha2026 npm test
```

## Estrutura

```
migrations/        SQL versionado (tabelas, restrições e gatilhos que impedem excluir item ou mudar código)
src/server.js      configuração do Express, sessão e rotas
src/auth.js        hash de senha, autenticação, permissões, CSRF
src/routes/        painel, equipamentos, setores, relatórios, usuários, whatsapp, api
src/services/      cadastro (geração de códigos), consultas, relatórios, exportação, whatsapp
views/             telas (EJS)
public/            CSS e JS do navegador
```

## API (somente leitura, exige sessão)

- `GET /api/resumo`
- `GET /api/equipamentos?busca=&setor=&categoria=&situacao=&limite=&offset=`
- `GET /api/equipamentos/FZA.01.001`: ficha com histórico
- `GET /api/setores`
