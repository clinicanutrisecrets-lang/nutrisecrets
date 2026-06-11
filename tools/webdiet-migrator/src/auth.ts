import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

export async function login(page: Page): Promise<void> {
  const url = process.env.WEBDIET_URL!;

  logger.info(`Navegando para ${url}/login`);
  await page.goto(url + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  await screenshot(page, '1-pagina-login');

  // ── Preenche e-mail ──────────────────────────────────────────────────────
  const emailSels = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="usuario"]',
    'input[placeholder*="e-mail" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="usuário" i]',
    'input[placeholder*="usuario" i]',
    'input[placeholder*="login" i]',
    'input:not([type="password"]):not([type="hidden"]):not([type="checkbox"])',
  ];

  let emailPreenchido = false;
  for (const sel of emailSels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click();
        await el.fill('');
        await el.type(process.env.WEBDIET_EMAIL!, { delay: 50 });
        logger.info(`E-mail preenchido com seletor: ${sel}`);
        emailPreenchido = true;
        break;
      }
    } catch { /* tenta próximo */ }
  }

  if (!emailPreenchido) {
    await screenshot(page, '2-email-falhou');
    throw new Error('Não encontrou campo de e-mail. Veja screenshot 2-email-falhou.png nos logs.');
  }

  await page.waitForTimeout(500);

  // Verifica se é login em 2 etapas (digita e-mail → próximo → senha)
  const nextBtns = [
    'button:has-text("Próximo")', 'button:has-text("Continuar")',
    'button:has-text("Next")', 'button:has-text("Avançar")',
  ];
  for (const sel of nextBtns) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        logger.info(`Login em 2 etapas detectado, clicando: ${sel}`);
        await el.click();
        await page.waitForTimeout(1500);
        break;
      }
    } catch { /* continua */ }
  }

  // ── Preenche senha ───────────────────────────────────────────────────────
  try {
    const passEl = page.locator('input[type="password"]').first();
    await passEl.waitFor({ timeout: 5000 });
    await passEl.click();
    await passEl.fill('');
    await passEl.type(process.env.WEBDIET_PASSWORD!, { delay: 50 });
    logger.info('Senha preenchida');
  } catch {
    await screenshot(page, '3-senha-falhou');
    throw new Error('Não encontrou campo de senha. Veja screenshot 3-senha-falhou.png nos logs.');
  }

  await page.waitForTimeout(500);
  await screenshot(page, '4-antes-submit');

  // ── Submete o formulário — 4 estratégias em sequência ───────────────────

  // Estratégia 1: pressiona Enter
  logger.info('Submit: tentando Enter');
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForTimeout(3000);

  if (!page.url().includes('/login')) {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    logger.info('Login OK via Enter');
    await screenshot(page, '5-login-sucesso');
    return;
  }

  // Estratégia 2: clica no botão mais provável
  logger.info('Submit: tentando clique em botão');
  const submitSels = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("entrar")',
    'button:has-text("Acessar")',
    'button:has-text("Login")',
    'button:has-text("Conectar")',
    '[class*="login-btn"]',
    '[class*="btn-login"]',
    '[class*="submit"]',
    'form button:last-of-type',
    'form button',
  ];

  for (const sel of submitSels) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        logger.info(`Submit via: ${sel}`);
        await el.click({ timeout: 5000 });
        await page.waitForTimeout(3000);
        if (!page.url().includes('/login')) break;
      }
    } catch { /* tenta próximo */ }
  }

  if (!page.url().includes('/login')) {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    logger.info('Login OK via clique');
    await screenshot(page, '5-login-sucesso');
    return;
  }

  // Estratégia 3: submete via JavaScript
  logger.info('Submit: tentando via JavaScript');
  await page.evaluate(() => {
    const form = document.querySelector('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    // Também tenta clicar no primeiro botão visível
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]')) as HTMLElement[];
    const visible = btns.find(b => b.offsetParent !== null);
    if (visible) visible.click();
  });
  await page.waitForTimeout(3000);

  if (!page.url().includes('/login')) {
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    logger.info('Login OK via JavaScript');
    await screenshot(page, '5-login-sucesso');
    return;
  }

  // Todas as estratégias falharam
  await screenshot(page, '5-login-falhou-definitivo');
  const html = await page.locator('form').innerHTML().catch(() => 'form não encontrado');
  logger.error(`HTML do formulário: ${html.substring(0, 500)}`);
  throw new Error(`Login falhou após todas as estratégias. URL: ${page.url()} — Veja screenshots nos logs.`);
}

async function screenshot(page: Page, nome: string): Promise<void> {
  try {
    const dir = process.env.LOG_PATH || './logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${nome}.png`), fullPage: true });
    logger.info(`Screenshot: ${nome}.png`);
  } catch { /* não bloqueia */ }
}
