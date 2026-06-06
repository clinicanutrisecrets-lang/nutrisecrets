import { Page } from 'playwright';
import { logger } from './logger';

export async function login(page: Page): Promise<void> {
  const url = process.env.WEBDIET_URL!;
  await page.goto(url + '/login', { waitUntil: 'networkidle' });

  await page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 15000 });

  await page.fill('input[type="email"], input[name="email"]', process.env.WEBDIET_EMAIL!);
  await page.fill('input[type="password"]', process.env.WEBDIET_PASSWORD!);
  await page.click('button[type="submit"]');

  // Aguarda redirecionamento pós-login
  await page.waitForURL((u) => !u.includes('/login'), { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  // Verifica se está logado de verdade
  const loggedIn = await page.isVisible('text=Pacientes', { timeout: 5000 }).catch(() => false)
    || await page.isVisible('[href*="paciente"]', { timeout: 5000 }).catch(() => false);

  if (!loggedIn) {
    const title = await page.title();
    throw new Error(`Login falhou. Página atual: ${page.url()} — título: ${title}`);
  }

  logger.info('Login realizado com sucesso');
}
