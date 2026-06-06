import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { PrescricaoData, SuplementoItem } from './types';
import { clickSidebarItem } from './extractPerfil';
import { logger } from './logger';

// Tenta parsear linhas de texto como "Nome do composto...........dosagem"
function parsearLinhasFormula(texto: string): SuplementoItem[] {
  const suplementos: SuplementoItem[] = [];
  const linhas = texto.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const linha of linhas) {
    // Ignora linhas de instrução (não contêm dosagem)
    if (linha.toLowerCase().startsWith('tomar') || linha.toLowerCase().startsWith('usar')
      || linha.toLowerCase().startsWith('modo') || linha.length < 4) continue;

    // Padrão: "Nome...........Xmg" ou "Nome - Xmg" ou "Nome: Xmg"
    const match = linha.match(/^(.+?)[\s.…\-:]+(\d+[\d.,]*\s*(?:mg|mcg|μg|g|ui|iu|ml|%|caps?|comp?)[\s\S]*)$/i);
    if (match) {
      const nome = match[1].trim().replace(/\.+$/, '').trim();
      const resto = match[2].trim();

      // Extrai dosagem (primeira parte numérica)
      const dosagemMatch = resto.match(/^([\d.,]+\s*(?:mg|mcg|μg|g|ui|iu|ml|%|caps?|comp?))/i);
      const dosagem = dosagemMatch ? dosagemMatch[1] : resto;

      if (nome.length > 2) {
        suplementos.push({ nome, dosagem, duracao: '', horario: '', instrucoes: '' });
      }
    }
  }

  // Se não conseguiu parsear nada, retorna o texto todo como um único item
  if (suplementos.length === 0 && texto.trim()) {
    suplementos.push({
      nome: 'Fórmula manipulada',
      dosagem: '',
      duracao: '',
      horario: '',
      instrucoes: texto.trim(),
    });
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

  // Lista de prescrições/fórmulas
  const items = await page.$$(
    '[class*="suplemento-item"], [class*="manipulado-item"], [class*="formula-item"], [class*="prescricao-item"]'
  );

  if (items.length === 0) {
    logger.info(`  Nenhum item em "${sidebarLabel}"`);
    return prescricoes;
  }

  for (let i = 0; i < items.length; i++) {
    try {
      const titulo = await items[i].$$eval(
        '[class*="titulo"], [class*="title"], strong, b, span',
        (els) => els[0]?.textContent?.trim() || ''
      ).catch(() => `Item ${i + 1}`);

      logger.info(`  Extraindo: ${titulo}`);

      let textoOriginal = '';
      let pdfPath: string | null = null;

      // Clica em "Editar"
      const editBtn = items[i].locator('button:has-text("Editar"), a:has-text("Editar"), [class*="btn-edit"]').first();
      if (await editBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await editBtn.click();
        await page.waitForTimeout(800);

        // Extrai conteúdo do editor de texto
        textoOriginal = await page.locator(
          'textarea, [contenteditable="true"], [class*="editor"] [class*="content"], .ql-editor, .ProseMirror'
        ).first().inputValue().catch(async () =>
          page.locator('textarea, [contenteditable="true"], .ql-editor, .ProseMirror').first().textContent()
            .catch(() => '')
        ) || '';

        // Tenta baixar o PDF
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
            logger.error(`  Erro ao baixar PDF de suplemento: ${err.message}`);
          }
        }

        // Fecha o editor (botão cancelar/fechar)
        const cancelBtn = page.locator(
          'button:has-text("Cancelar"), button:has-text("cancelar"), button:has-text("Fechar"), [aria-label="Fechar"]'
        ).first();
        if (await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cancelBtn.click();
          await page.waitForTimeout(500);
        }
      } else {
        // Se não tem botão de editar, tenta ler o conteúdo direto
        textoOriginal = await items[i].textContent().catch(() => '') || '';
      }

      const suplementos = parsearLinhasFormula(textoOriginal);
      prescricoes.push({ titulo: titulo || `Prescrição ${i + 1}`, suplementos, textoOriginal, pdfPath, tipo });

      await page.waitForTimeout(400);
    } catch (err: any) {
      logger.error(`  Erro na prescrição ${i} de "${sidebarLabel}": ${err.message}`);
    }
  }

  return prescricoes;
}

export async function extractSuplementos(page: Page, patientId: string): Promise<PrescricaoData[]> {
  const suplementos = await extrairPrescricoes(page, patientId, 'Suplementos e produtos', 'suplementos');
  return suplementos;
}

export async function extractManipulados(page: Page, patientId: string): Promise<PrescricaoData[]> {
  const manipulados = await extrairPrescricoes(page, patientId, 'Prescrição de manipulados', 'manipulado');
  return manipulados;
}
