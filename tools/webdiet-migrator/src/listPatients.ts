import { Page } from 'playwright';
import { PatientSummary } from './types';
import { logger } from './logger';

export async function getAllPatients(page: Page): Promise<PatientSummary[]> {
  const base = process.env.WEBDIET_URL!;

  // Vai direto para a lista de pacientes
  await page.goto(base + '/pacientes', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Aguarda o primeiro paciente aparecer
  await page.waitForSelector('a[href*="/paciente/"], a[href*="/pacientes/"]', { timeout: 15000 });

  // Scroll infinito — continua até não carregar mais
  let previousCount = 0;
  let stableRounds = 0;

  while (stableRounds < 3) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    const count = await page.$$eval(
      'a[href*="/paciente/"], a[href*="/pacientes/"]',
      (els) => els.length
    );

    if (count === previousCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
      previousCount = count;
      logger.info(`Carregados ${count} pacientes...`);
    }
  }

  // Extrai nome + URL de todos
  const patients = await page.$$eval(
    'a[href*="/paciente/"], a[href*="/pacientes/"]',
    (els) => els.map((el) => {
      const href = el.getAttribute('href') || '';
      // Extrai o ID da URL: /paciente/12345 ou /pacientes/12345
      const id = href.split('/').filter(Boolean).pop() || '';
      const name = el.textContent?.trim().replace(/\s+/g, ' ') || '';
      return { id, name, profileUrl: href };
    })
  );

  // Remove duplicatas e entradas sem ID
  const seen = new Set<string>();
  return patients.filter((p) => {
    if (!p.id || !p.name || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}
