import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { CardapioData } from './types';
import { clickSidebarItem } from './extractPerfil';
import { logger } from './logger';

export async function extractCardapio(page: Page, patientId: string): Promise<CardapioData[]> {
  const cardapios: CardapioData[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'cardapios');

  await clickSidebarItem(page, 'Planejamento alimentar');
  await page.waitForTimeout(1000);

  // Pega todos os planos listados (o mais recente fica no topo)
  const planItems = await page.$$('[class*="plano-item"], [class*="plan-item"], [class*="dieta-item"], [class*="cardapio-item"]');

  if (planItems.length === 0) {
    logger.info('  Nenhum plano alimentar encontrado');
    return cardapios;
  }

  // Processa todos os planos (começando pelo mais recente = índice 0)
  for (let i = 0; i < planItems.length; i++) {
    try {
      // Extrai título e kcal do card
      const titulo = await planItems[i].$$eval(
        '[class*="titulo"], [class*="title"], strong, b, h3, h4',
        (els) => els[0]?.textContent?.trim() || ''
      ).catch(() => `Plano ${i + 1}`);

      const kcal = await planItems[i].$$eval(
        '[class*="kcal"], [class*="calori"]',
        (els) => els[0]?.textContent?.trim() || ''
      ).catch(() => '');

      logger.info(`  Plano ${i + 1}: ${titulo}`);

      let pdfPath: string | null = null;
      let textoCompleto = '';

      // Clica no plano para abrir
      await planItems[i].click();
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      // Tenta baixar o PDF do plano
      const pdfBtn = page.locator('button:has-text("PDF"), a:has-text("PDF"), [class*="btn-pdf"]').first();
      if (await pdfBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        try {
          if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15000 }),
            pdfBtn.click(),
          ]);
          const filePath = path.join(saveDir, `cardapio_${i}_${Date.now()}.pdf`);
          await download.saveAs(filePath);
          pdfPath = filePath;
          logger.info(`  PDF salvo: ${filePath}`);
        } catch (err: any) {
          logger.error(`  Erro ao baixar PDF do plano: ${err.message}`);
        }
      }

      // Clica em "Expandir tudo" para capturar o texto completo
      const expandBtn = page.locator('button:has-text("Expandir tudo"), button:has-text("expandir tudo"), [class*="expand-all"]').first();
      if (await expandBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expandBtn.click();
        await page.waitForTimeout(1500);
      }

      // Captura o texto da tabela de alimentos expandida
      textoCompleto = await page.locator(
        '[class*="cardapio-content"], [class*="plano-content"], [class*="dieta-content"], [class*="refeicoes"], table'
      ).first().textContent().catch(() => '') || '';

      cardapios.push({
        titulo: titulo || `Plano alimentar ${i + 1}`,
        pdfPath,
        textoCompleto: textoCompleto.trim(),
        kcal,
      });

      // Volta para a lista de planos
      const voltarBtn = page.locator('button:has-text("Voltar"), button:has-text("voltar"), [class*="btn-back"]').first();
      if (await voltarBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await voltarBtn.click();
        await page.waitForTimeout(800);
      }

    } catch (err: any) {
      logger.error(`  Erro no plano ${i}: ${err.message}`);
    }
  }

  return cardapios;
}
