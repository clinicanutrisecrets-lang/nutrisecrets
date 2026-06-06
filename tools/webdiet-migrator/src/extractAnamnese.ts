import { Page } from 'playwright';
import { AnamneseRecord } from './types';
import { clickSidebarItem } from './extractPerfil';
import { logger } from './logger';

export async function extractAnamnese(page: Page): Promise<AnamneseRecord[]> {
  const records: AnamneseRecord[] = [];

  await clickSidebarItem(page, 'Anamnese geral');

  // Aguarda a lista de registros
  await page.waitForTimeout(1000);

  // Cada registro aparece como um card/item com título e data
  const items = await page.$$('[class*="anamnese"] [class*="item"], [class*="anamnese"] [class*="card"], [class*="registro"]');

  if (items.length === 0) {
    // Tenta extração direta do texto da seção inteira como fallback
    const rawText = await page.locator('[class*="anamnese"], [id*="anamnese"]').textContent().catch(() => '');
    if (rawText?.trim()) {
      records.push({ titulo: 'Anamnese geral', data: '', texto: rawText.trim() });
    }
    return records;
  }

  for (let i = 0; i < items.length; i++) {
    try {
      // Clica no item para abrir/expandir
      await items[i].click();
      await page.waitForTimeout(800);

      // Extrai título, data e conteúdo
      const titulo = await items[i].$$eval(
        '[class*="titulo"], [class*="title"], strong, b, h3, h4',
        (els) => els[0]?.textContent?.trim() || ''
      ).catch(() => '');

      const data = await items[i].$$eval(
        '[class*="data"], [class*="date"], small, time',
        (els) => els[0]?.textContent?.trim() || ''
      ).catch(() => '');

      // Texto do modal/painel que abriu
      const texto = await page.locator(
        '[class*="modal"] [class*="conteudo"], [class*="modal"] [class*="content"], [class*="panel"] [class*="body"], textarea'
      ).first().textContent().catch(() => '') || '';

      if (titulo || texto) {
        records.push({ titulo: titulo || `Registro ${i + 1}`, data, texto: texto.trim() });
      }

      // Fecha o modal se abriu
      const fecharBtn = page.locator('[class*="modal"] button[class*="fechar"], [class*="modal"] button[class*="close"], [aria-label="Fechar"]').first();
      if (await fecharBtn.isVisible({ timeout: 500 }).catch(() => false)) {
        await fecharBtn.click();
        await page.waitForTimeout(400);
      }

    } catch (err: any) {
      logger.error(`Erro ao extrair registro de anamnese ${i}: ${err.message}`);
    }
  }

  return records;
}
