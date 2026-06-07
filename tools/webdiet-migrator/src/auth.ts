import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';

export async function login(page: Page): Promise<void> {
  const url = process.env.WEBDIET_URL!;
  await page.goto(url + '/login', { waitUntil: 'networkidle' });

  // Aguarda qualquer campo de e-mail aparecer
  await page.waitForSelector(
    'input[type="email"], input[name="email"], input[placeholder*="e-mail" i], input[placeholder*="email" i]',
    { timeout: 15000 }
  );

  // Preenche e-mail
  await page.locator(
    'input[type="email"], input[name="email"], input[placeholder*="e-mail" i], input[placeholder*="email" i]'
  ).first().fill(process.env.WEBDIET_EMAIL!);

  // Preenche senha
  await page.locator('input[type="password"]').first().fill(process.env.WEBDIET_PASSWORD!);

  await page.waitForTimeout(500);

  // Tira screenshot antes de clicar (salva para debug)
  await salvarScreenshot(page, 'login-antes-submit');

  // Tenta clicar no botão de submit com vários seletores possíveis
  const submitOpcoes = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Entrar")',
    'button:has-text("entrar")',
    'button:has-text("Login")',
    'button:has-text("Acessar")',
    'button:has-text("Continuar")',
    '[class*="login"] button',
    '[class*="submit"]',
    'form button',
  ];

  let clicou = false;
  for (const sel of submitOpcoes) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        logger.info(`Login: clicando em "${sel}"`);
        await btn.click();
        clicou = true;
        break;
      }
    } catch { /* tenta próximo */ }
  }

  if (!clicou) {
    // Última tentativa: pressiona Enter no campo de senha
    logger.info('Login: nenhum botão encontrado, tentando Enter');
    await page.locator('input[type="password"]').first().press('Enter');
  }

  // Aguarda sair da página de login
  try {
    await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 20000 });
  } catch {
    await salvarScreenshot(page, 'login-falhou');
    const title = await page.title();
    throw new Error(`Login falhou. URL: ${page.url()} | Título: ${title}`);
  }

  await page.waitForLoadState('networkidle');
  await salvarScreenshot(page, 'login-sucesso');
  logger.info('Login realizado com sucesso');
}

async function salvarScreenshot(page: Page, nome: string): Promise<void> {
  try {
    const dir = process.env.LOG_PATH || './logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${nome}.png`), fullPage: false });
  } catch { /* não bloqueia se screenshot falhar */ }
}
