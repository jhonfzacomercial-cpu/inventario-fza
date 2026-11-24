'use strict';
/*
 * Teste ponta a ponta do fluxo de aceite (usa Playwright/Chromium).
 * Requer o servidor rodando em BASE_URL, banco VAZIO, e as variáveis:
 *   ADMIN_INITIAL_PASSWORD (senha inicial do Adm)  e  ADMIN_NEW_PASSWORD (senha que o teste definirá)
 * Uso: BASE_URL=http://localhost:3000 ADMIN_NEW_PASSWORD=NovaSenha2026 npm test
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SENHA_INICIAL = process.env.ADMIN_INITIAL_PASSWORD;
const SENHA_NOVA = process.env.ADMIN_NEW_PASSWORD || 'NovaSenha2026';
const OUT = process.env.TEST_OUT || path.join(__dirname, 'saida');
fs.mkdirSync(OUT, { recursive: true });

const ok = (msg) => console.log('  ✔ ' + msg);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, acceptDownloads: true, viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  console.log('1. Acesso');
  let r = await ctx.request.get('/api/equipamentos', { maxRedirects: 0 });
  assert.strictEqual(r.status(), 401); ok('API sem login → 401');
  await page.goto('/equipamentos');
  assert.ok(page.url().endsWith('/login')); ok('Tela sem login → redireciona para /login');
  await shot('01-login');
  await page.fill('input[name=login]', 'Adm');
  await page.fill('input[name=senha]', 'errada123');
  await page.click('button:has-text("Entrar")');
  await page.waitForSelector('text=Login ou senha inválidos'); ok('Senha errada rejeitada');
  await page.fill('input[name=login]', 'Adm');
  await page.fill('input[name=senha]', SENHA_INICIAL);
  await page.click('button:has-text("Entrar")');
  await page.waitForURL('**/trocar-senha'); ok('Primeiro acesso exige troca de senha');
  await page.goto('/');
  assert.ok(page.url().endsWith('/trocar-senha')); ok('Navegação bloqueada até trocar a senha');
  await page.fill('input[name=senha_atual]', SENHA_INICIAL);
  await page.fill('input[name=nova_senha]', SENHA_NOVA);
  await page.fill('input[name=confirmacao]', SENHA_NOVA);
  await page.click('button:has-text("Salvar nova senha")');
  await page.waitForSelector('text=Senha alterada com sucesso'); ok('Senha trocada');

  console.log('2. Setores');
  for (const [codigo, nome, resp] of [['01', 'Criação', 'Ana Souza'], ['02', 'Administrativo', 'Bruno Lima']]) {
    await page.goto('/setores');
    await page.fill('input[name=codigo]', codigo);
    await page.fill('form[action="/setores"] input[name=nome]', nome);
    await page.fill('form[action="/setores"] input[name=responsavel]', resp);
    await page.click('button:has-text("Cadastrar setor")');
    await page.waitForSelector(`text=Setor ${codigo} — ${nome} cadastrado`, { timeout: 5000 }).catch(async (e) => { await shot('erro-setor'); console.log(await page.textContent('main')); throw e; });
  }
  await page.goto('/setores');
  await page.fill('input[name=codigo]', '01');
  await page.fill('form[action="/setores"] input[name=nome]', 'Outro');
  await page.click('button:has-text("Cadastrar setor")');
  await page.waitForSelector('text=já pertence ao setor'); ok('Setores 01 e 02 criados; código duplicado rejeitado');
  await shot('02-setores');

  console.log('3. Cadastro e códigos automáticos');
  async function cadastrar(d) {
    await page.goto('/equipamentos/novo');
    await page.fill('input[name=descricao]', d.descricao);
    await page.selectOption('select[name=categoria_id]', { label: d.categoria });
    if (d.marca) await page.fill('input[name=marca]', d.marca);
    if (d.modelo) await page.fill('input[name=modelo]', d.modelo);
    await page.fill('input[name=quantidade]', String(d.qtd || 1));
    if (d.series) await page.fill('textarea[name=numeros_serie]', d.series.join('\n'));
    if (d.serie) await page.fill('input[name=numero_serie]', d.serie);
    await page.selectOption('select[name=setor_id]', { label: d.setor });
    if (d.responsavel) await page.fill('input[name=responsavel]', d.responsavel);
    if (d.data) await page.fill('input[name=data_aquisicao]', d.data);
    if (d.valor) await page.fill('input[name=valor_aquisicao]', d.valor); else await page.check('#valorDesconhecido');
    if (d.foto) await page.setInputFiles('input[name=foto]', d.foto);
    await page.click('button:has-text("Cadastrar e gerar código")');
    await page.waitForLoadState('networkidle');
  }
  await cadastrar({ descricao: 'Notebook Dell Latitude 5440', categoria: 'Notebook', marca: 'Dell', modelo: 'Latitude 5440', qtd: 2,
    series: ['DL5440-A1', 'DL5440-A2'], setor: '01 — Criação', responsavel: 'Carla Mendes', data: '2024-03-10', valor: '6.890,00' });
  await page.waitForSelector('text=2 itens cadastrados');
  const lote = await page.$$eval('table a.codigo', (as) => as.map((a) => a.textContent.trim()));
  assert.deepStrictEqual(lote, ['FZA.01.001', 'FZA.01.002']); ok('Lote de 2 unidades → FZA.01.001 e FZA.01.002');
  await shot('03-lote');

  // foto PNG mínima
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const fotoPath = path.join(OUT, 'foto.png'); fs.writeFileSync(fotoPath, png);
  await cadastrar({ descricao: 'Câmera Sony A7 III', categoria: 'Câmera', marca: 'Sony', modelo: 'ILCE-7M3', serie: 'SN-7M3-998',
    setor: '02 — Administrativo', responsavel: 'Bruno Lima', data: '2023-08-01', valor: '12500,50', foto: fotoPath });
  assert.strictEqual((await page.textContent('.codigo-grande')).trim(), 'FZA.02.001'); ok('Primeiro item do setor 02 → FZA.02.001');
  await cadastrar({ descricao: 'Monitor LG antigo 22"', categoria: 'Monitor', marca: 'LG', setor: '01 — Criação' });
  assert.strictEqual((await page.textContent('.codigo-grande')).trim(), 'FZA.01.003');
  await page.waitForSelector('.dados >> text=Não informado'); ok('Item com valor desconhecido → FZA.01.003, exibido como "Não informado"');
  await shot('04-ficha');

  console.log('4. Concorrência na geração de códigos');
  const csrf = await page.getAttribute('input[name=_csrf]', 'value');
  const setor02 = await page.evaluate(async () => {
    const html = await (await fetch('/equipamentos/novo')).text();
    const m = html.match(/<option value="(\d+)"[^>]*>02 — Administrativo/); return m[1];
  });
  const cat = await page.evaluate(async () => {
    const html = await (await fetch('/equipamentos/novo')).text();
    const m = html.match(/<option value="(\d+)"[^>]*>Mouse</); return m[1];
  });
  const reqs = Array.from({ length: 15 }, (_, i) => ctx.request.post('/equipamentos/novo', {
    multipart: { _csrf: csrf, descricao: `Mouse sem fio ${i + 1}`, categoria_id: cat, quantidade: '1', setor_id: setor02,
      estado: 'novo', situacao: 'disponivel', valor_aquisicao: '89,90' },
    maxRedirects: 0,
  }));
  const resps = await Promise.all(reqs);
  assert.ok(resps.every((x) => x.status() === 302), 'todas as requisições devem redirecionar');
  const api = await (await ctx.request.get('/api/equipamentos?setor=' + setor02 + '&limite=500')).json();
  const codigos = api.itens.map((i) => i.codigo).sort();
  const esperado = Array.from({ length: 16 }, (_, i) => `FZA.02.${String(i + 1).padStart(3, '0')}`);
  assert.deepStrictEqual(codigos, esperado); ok('15 cadastros simultâneos → FZA.02.002…FZA.02.016 sem duplicidade nem lacunas');

  console.log('5. Link da ficha exige login');
  const anon = await browser.newContext({ baseURL: BASE });
  const ap = await anon.newPage();
  await ap.goto('/e/FZA.01.002');
  assert.ok(ap.url().endsWith('/login')); ok('Link /e/FZA.01.002 sem login → tela de login');
  await ap.fill('input[name=login]', 'Adm'); await ap.fill('input[name=senha]', SENHA_NOVA);
  await ap.click('button:has-text("Entrar")');
  await ap.waitForSelector('.codigo-grande');
  assert.strictEqual((await ap.textContent('.codigo-grande')).trim(), 'FZA.01.002'); ok('Após login, abre a ficha FZA.01.002');
  await anon.close();

  console.log('6. Transferência');
  await page.goto('/e/FZA.01.002');
  await page.click('a:has-text("Transferir")');
  await page.selectOption('select[name=setor_destino_id]', { label: '02 — Administrativo' });
  await page.fill('input[name=responsavel]', 'Diego Rocha');
  await page.fill('textarea[name=observacoes]', 'Remanejado para o financeiro');
  await page.click('button:has-text("Registrar transferência")');
  await page.waitForSelector('text=O código FZA.01.002 foi mantido');
  assert.strictEqual((await page.textContent('.codigo-grande')).trim(), 'FZA.01.002');
  assert.ok((await page.textContent('.sub')).includes('02 — Administrativo'));
  const hist = await page.textContent('.timeline');
  assert.ok(hist.includes('01 — Criação') && hist.includes('02 — Administrativo') && hist.includes('Administrador'));
  ok('FZA.01.002 agora no setor 02, código preservado, histórico com origem/destino/usuário');
  await shot('07-transferencia');

  console.log('7. Baixa');
  await page.goto('/e/FZA.01.001');
  await page.click('a:has-text("Dar baixa")');
  await page.click('button:has-text("Registrar baixa")');
  assert.ok(page.url().endsWith('/baixa'), 'validação HTML impede envio sem motivo/confirmação');
  await page.selectOption('select[name=motivo]', 'descarte');
  await page.fill('textarea[name=observacoes]', 'Placa-mãe danificada, sem conserto');
  await page.check('input[name=confirmar]');
  await page.click('button:has-text("Registrar baixa")');
  await page.waitForSelector('text=Baixa do item FZA.01.001 registrada');
  assert.ok(await page.isVisible('text=Item baixado em'));
  assert.strictEqual(await page.locator('a:has-text("Transferir")').count(), 0);
  ok('FZA.01.001 baixado (confirmação exigida); ficha continua acessível');
  await shot('08-baixa');

  console.log('8. Painel e relatórios');
  await page.goto('/');
  const kpis = await page.$$eval('.kpi strong', (s) => s.map((x) => x.textContent.trim()));
  // Ativos: 1 notebook + câmera + monitor + 15 mouses = 18; valor 6890 + 12500,50 + 15*89,90 = 20739,00
  assert.strictEqual(kpis[0], '18');
  assert.strictEqual(kpis[1].replace(/\s/g, ' '), 'R$ 20.739,00');
  assert.strictEqual(kpis[2], '1');
  assert.strictEqual(kpis[3], '1');
  ok(`Painel: ${kpis[0]} ativos · ${kpis[1]} · ${kpis[2]} sem valor · ${kpis[3]} baixado`);
  await shot('09-painel');

  await page.goto('/relatorios/setor');
  await shot('10-relatorio-setor');
  const dlx = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar XLSX")')]);
  const xlsxPath = path.join(OUT, 'relatorio-setor.xlsx'); await dlx[0].saveAs(xlsxPath);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  const resumo = {}; ws.eachRow((row) => { const a = row.getCell(1).value; if (typeof a === 'string') resumo[a] = row.getCell(2).value; });
  assert.strictEqual(resumo['Quantidade de itens'], 18);
  assert.strictEqual(Number(resumo['Valor de aquisição registrado']).toFixed(2), '20739.00');
  ok('XLSX por setor: 18 itens, R$ 20.739,00');
  const dlp = await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar PDF")')]);
  const relPdf = path.join(OUT, 'relatorio-setor.pdf'); await dlp[0].saveAs(relPdf);
  assert.ok(fs.readFileSync(relPdf).slice(0, 5).toString() === '%PDF-'); ok('PDF do relatório por setor gerado');

  await page.goto('/relatorios/baixas?inicio=2020-01-01');
  assert.ok((await page.textContent('.tabela')).includes('FZA.01.001'));
  await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar PDF")')]).then(([d]) => d.saveAs(path.join(OUT, 'relatorio-baixas.pdf')));
  await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar XLSX")')]).then(([d]) => d.saveAs(path.join(OUT, 'relatorio-baixas.xlsx')));
  ok('Relatório de baixas com período lista FZA.01.001 (PDF e XLSX exportados)');
  await page.goto('/relatorios/transferencias?inicio=2020-01-01');
  assert.ok((await page.textContent('.tabela')).includes('FZA.01.002'));
  await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar PDF")')]).then(([d]) => d.saveAs(path.join(OUT, 'relatorio-transferencias.pdf')));
  ok('Relatório de transferências lista FZA.01.002');
  await page.goto('/relatorios/geral');
  await Promise.all([page.waitForEvent('download'), page.click('a:has-text("Exportar PDF")')]).then(([d]) => d.saveAs(path.join(OUT, 'relatorio-geral.pdf')));
  await page.goto('/relatorios/transferencias?inicio=2099-01-01');
  assert.ok(await page.isVisible('text=Nenhum registro encontrado')); ok('Filtro de período funciona');

  console.log('9. Busca e filtros');
  await page.goto('/equipamentos?busca=SN-7M3');
  assert.strictEqual(await page.locator('tbody tr').count(), 1); ok('Busca por nº de série');
  await page.goto('/equipamentos?situacao=baixado');
  assert.strictEqual(await page.locator('tbody tr').count(), 1); ok('Filtro situação = baixado');

  console.log('10. Usuários e permissões');
  await page.goto('/usuarios');
  await page.fill('form[action="/usuarios"] input[name=nome]', 'Operador Teste');
  await page.fill('form[action="/usuarios"] input[name=login]', 'operador');
  await page.fill('form[action="/usuarios"] input[name=senha]', 'Provisoria123');
  await page.click('button:has-text("Criar usuário")');
  await page.waitForSelector('text=Usuário operador criado');
  const op = await browser.newContext({ baseURL: BASE });
  const opp = await op.newPage();
  await opp.goto('/login');
  await opp.fill('input[name=login]', 'operador'); await opp.fill('input[name=senha]', 'Provisoria123');
  await opp.click('button:has-text("Entrar")');
  await opp.waitForURL('**/trocar-senha');
  await opp.fill('input[name=senha_atual]', 'Provisoria123');
  await opp.fill('input[name=nova_senha]', 'Operador2026');
  await opp.fill('input[name=confirmacao]', 'Operador2026');
  await opp.click('button:has-text("Salvar nova senha")');
  await opp.waitForSelector('text=Senha alterada');
  assert.strictEqual(await opp.locator('nav a:has-text("Usuários")').count(), 0);
  const r403 = await opp.goto('/usuarios');
  assert.strictEqual(r403.status(), 403); ok('Operador não vê nem acessa Usuários');
  await opp.goto('/equipamentos'); assert.ok(await opp.isVisible('text=FZA.02.001')); ok('Operador consulta o inventário');
  // admin desativa o operador → perde o acesso
  await page.goto('/usuarios');
  const linha = page.locator('tr', { hasText: 'Operador Teste' });
  await linha.locator('summary').click();
  await linha.locator('button:has-text("Desativar")').click();
  await page.waitForSelector('text=Usuário operador desativado');
  await opp.goto('/equipamentos'); assert.ok(opp.url().endsWith('/login')); ok('Usuário desativado perde o acesso imediatamente');
  await op.close();

  console.log('11. Celular');
  const mob = await browser.newContext({ baseURL: BASE, ...require('playwright').devices['iPhone 13'] });
  await mob.addCookies(await ctx.cookies());
  const mp = await mob.newPage();
  await mp.goto('/'); await mp.screenshot({ path: path.join(OUT, '11-mobile-painel.png'), fullPage: true });
  await mp.goto('/e/FZA.02.001'); await mp.screenshot({ path: path.join(OUT, '12-mobile-ficha.png'), fullPage: true });
  await mp.goto('/equipamentos'); await mp.screenshot({ path: path.join(OUT, '13-mobile-lista.png'), fullPage: true });
  const largura = await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.ok(largura, 'sem rolagem horizontal da página no celular'); ok('Layout de celular sem rolagem horizontal');
  await mob.close();

  await browser.close();
  console.log('\nTodos os fluxos verificados. Arquivos em ' + OUT);
})().catch((err) => { console.error('\n✘ FALHA:', err); process.exit(1); });
