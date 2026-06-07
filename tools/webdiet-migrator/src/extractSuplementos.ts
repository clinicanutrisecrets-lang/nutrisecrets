import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { PrescricaoData, SuplementoItem } from './types';
import { clickSidebarItem } from './extractPerfil';
import { logger } from './logger';

function parsearLinhasFormula(texto: string): SuplementoItem[] {
  const suplementos: SuplementoItem[] = [];
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const linha of linhas) {
    if (linha.toLowerCase().startsWith('tomar') || linha.toLowerCase().startsWith('usar')
      || linha.toLowerCase().startsWith('modo') || linha.length < 4) continue;

    const match = linha.match(/^(.+?)[\s.…\-:]+(\d+[\d.,]*\s*(?:mg|mcg|μg|g|ui|iu|ml|%|caps?|comp?)[\s\S]*)$/i);
    if (match) {
      const nome = match[1].trim().replace(/\.+$/, '').trim();
      const resto = match[2].trim();
      const dosagemMatch = resto.match(/^([\d.,]+\s*(?:mg|mcg|μg|g|ui|iu|ml|%|caps?|comp?))/i);
      const dosagem = dosagemMatch ? dosagemMatch[1] : resto;
      if (nome.length > 2) {
        suplementos.push({ nome, dosagem, duracao: '', horario: '', instrucoes: '' });
      }
    }
  }

  if (suplementos.length === 0 && texto.trim()) {
    suplementos.push({ nome: 'Fórmula manipulada', dosagem: '', duracao: '', horario: '', instrucoes: texto.trim() });
  }

  return suplementos;
}

async function extrairPrescricoes(
  page: Page,
  patientId: string,
  sidebarLabel: string,
  tipo: PrescricaoData['tipo']
): Promise<PrescricaoData[]> {
  const prescricoes: PrescricaoData[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'suplementos');

  await clickSidebarItem(page, sidebarLabel);
  await page.waitForTimeout(1000);

  const itemSelector = '[class*="suplemento-item"], [class*="manipulado-item"], [class*="formula-item"], [class*="prescricao-item"]';
  const count = await page.locator(itemSelector).count();

  if (count === 0) {
    logger.info(`  Nenhum item em "${sidebarLabel}"`);
    return prescricoes;
  }

  for (let i = 0; i < count; i++) {
    try {
      const item = page.locator(itemSelector).nth(i);

      const titulo = await item.locator('[class*="titulo"], [class*="title"], strong, b, span').first()
        .textContent().catch(() => `Item ${i + 1}`) || `Item ${i + 1}`;

      logger.info(`  Extraindo: ${titulo.trim()}`);

      let textoOriginal = '';
      let pdfPath: string | null = null;

      const editBtn = item.locator('button:has-text("Editar"), a:has-text("Editar"), [class*="btn-edit"]').first();
      if (await editBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(800);

        textoOriginal = await page.locator(
          'textarea, [contenteditable="true"], [class*="editor"] [class*="content"], .ql-editor, .ProseMirror'
        ).first().inputValue().catch(async () =>
          page.locator('textarea, [contenteditable="true"], .ql-editor, .ProseMirror').first().textContent()
            .catch(() => '')
        ) || '';

        const pdfBtn = page.locator('button:has-text("PDF"), a:has-text("PDF"), [class*="btn-pdf"]').first();
        if (await pdfBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          try {
            if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 12000 }),
              pdfBtn.click(),
            ]);
            const filePath = path.join(saveDir, `${tipo}_${i}_${Date.now()}.pdf`);
            await download.saveAs(filePath);
            pdfPath = filePath;
          } catch (err: any) {
            logger.error(`  Erro ao baixar PDF: ${err.message}`);
          }
        }

        const cancelBtn = page.locator(
          'button:has-text("Cancelar"), button:has-text("Fechar"), [aria-label="Fechar"]'
        ).first();
        if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelBtn.click();
          await page.waitForTimeout(500);
        }
      } else {
        textoOriginal = await item.textContent().catch(() => '') || '';
      }

      const suplementos = parsearLinhasFormula(textoOriginal);
      prescricoes.push({ titulo: titulo.trim() || `Prescrição ${i + 1}`, suplementos, textoOriginal, pdfPath, tipo });
      await page.waitForTimeout(400);

    } catch (err: any) {
      logger.error(`  Erro na prescrição ${i} de "${sidebarLabel}": ${err.message}`);
    }
  }

  return prescricoes;
}

export async function extractSuplementos(page: Page, patientId: string): Promise<PrescricaoData[]> {
  return extrairPrescricoes(page, patientId, 'Suplementos e produtos', 'suplementos');
}

export async function extractManipulados(page: Page, patientId: string): Promise<PrescricaoData[]> {
  return extrairPrescricoes(page, patientId, 'Prescrição de manipulados', 'manipulado');
}
