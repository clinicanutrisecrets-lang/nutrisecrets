import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ExamePDF } from './types';
import { clickSidebarItem } from './extractPerfil';
import { extractTextFromPDF } from './extractPdfText';
import { logger } from './logger';

const RESULTADO_KEYWORDS = ['resultado', 'laudo', 'report', 'hemograma', 'bioquimica', 'bioquímica',
  'glicemia', 'colesterol', 'triglicerides', 'triglicérides', 'hormon', 'tiroide', 'tireoide',
  'ferritin', 'vitamina', 'mineral', 'proteina', 'proteína', 'exame'];

const PEDIDO_KEYWORDS = ['pedido', 'solicitacao', 'solicitação', 'requisicao', 'requisição',
  'encaminhamento', 'receitu', 'prescricao', 'prescrição', 'ordem'];

const GENETICO_KEYWORDS = ['geneti', 'genômi', 'genomi', 'dna', 'gene', 'snp', 'polimorf'];

const MICROBIOTA_KEYWORDS = ['microbiota', 'microbiom', 'flora intestin'];

const COPROLOGICO_KEYWORDS = ['coprol', 'coprológ', 'parasit', 'disbiose', 'bacterio',
  'fezes', 'intestin', 'protozo', 'helmint'];

const EDUCATIVO_KEYWORDS = ['lamina', 'lâmina', 'educativ', 'higieniz', 'aliment', 'receita',
  'orientacao', 'orientação', 'cardapio', 'cardápio', 'protocolo', 'guia'];

function classificarExame(nome: string): ExamePDF['tipo'] | null {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (PEDIDO_KEYWORDS.some((k) => n.includes(k))) return null;
  if (RESULTADO_KEYWORDS.some((k) => n.includes(k))) return 'sangue';
  return 'sangue'; // benefício da dúvida
}

function classificarAnexo(nome: string): ExamePDF['tipo'] | null {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (EDUCATIVO_KEYWORDS.some((k) => n.includes(k))) return null;
  if (GENETICO_KEYWORDS.some((k) => n.includes(k))) return 'genetico';
  if (COPROLOGICO_KEYWORDS.some((k) => n.includes(k))) return 'coprologico';
  if (MICROBIOTA_KEYWORDS.some((k) => n.includes(k))) return 'microbiota';
  return null;
}

async function downloadPDF(
  page: Page,
  downloadTrigger: () => Promise<void>,
  saveDir: string,
  baseName: string
): Promise<string | null> {
  try {
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      downloadTrigger(),
    ]);
    const fileName = `${baseName}_${Date.now()}.pdf`;
    const filePath = path.join(saveDir, fileName);
    await download.saveAs(filePath);
    return filePath;
  } catch (err: any) {
    logger.error(`Erro ao baixar PDF: ${err.message}`);
    return null;
  }
}

export async function extractExamesLaboratoriais(page: Page, patientId: string): Promise<ExamePDF[]> {
  const exames: ExamePDF[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'exames');

  await clickSidebarItem(page, 'Exames laboratoriais');
  await page.waitForTimeout(1000);

  const items = await page.$$('[class*="exame-item"], [class*="exam-item"], [class*="laboratorial"]');
  const pdfLinks = items.length > 0
    ? items
    : await page.$$('a[href$=".pdf"], button:has-text("PDF"), a:has-text("PDF")');

  for (let i = 0; i < pdfLinks.length; i++) {
    try {
      const nome = await pdfLinks[i].textContent().then((t) => t?.trim() || `exame_${i}`);
      const tipo = classificarExame(nome);

      if (!tipo) {
        logger.info(`  Ignorando (parece pedido): ${nome}`);
        continue;
      }

      logger.info(`  Baixando exame: ${nome}`);
      const pdfPath = await downloadPDF(page, () => pdfLinks[i].click(), saveDir, `sangue_${i}`);

      if (pdfPath) {
        const textoPDF = await extractTextFromPDF(pdfPath);
        if (textoPDF === null) continue; // escaneado → descarta

        const dataEl = await pdfLinks[i].$$eval(
          '[class*="data"], [class*="date"], small',
          (els) => els[0]?.textContent?.trim() || ''
        ).catch(() => '');

        exames.push({ nome, tipo, pdfPath, dataExame: dataEl, textoPDF });
      }

      await page.waitForTimeout(500);
    } catch (err: any) {
      logger.error(`  Erro no exame ${i}: ${err.message}`);
    }
  }

  return exames;
}

export async function extractArquivosAnexos(page: Page, patientId: string): Promise<ExamePDF[]> {
  const exames: ExamePDF[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'anexos');

  await clickSidebarItem(page, 'Arquivos anexos');
  await page.waitForTimeout(1000);

  const items = await page.$$('[class*="arquivo-item"], [class*="attachment"], [class*="anexo-item"]');
  const targets = items.length > 0
    ? items
    : await page.$$('a[href$=".pdf"], button:has-text("PDF"), a:has-text("PDF"), [class*="arquivo"] a');

  for (let i = 0; i < targets.length; i++) {
    try {
      const nome = await targets[i].textContent().then((t) => t?.trim() || `anexo_${i}`);
      const tipo = classificarAnexo(nome);

      if (!tipo) {
        logger.info(`  Ignorando anexo (não é exame clínico): ${nome}`);
        continue;
      }

      logger.info(`  Baixando anexo ${tipo}: ${nome}`);
      const pdfPath = await downloadPDF(page, () => targets[i].click(), saveDir, `${tipo}_${i}`);

      if (pdfPath) {
        const textoPDF = await extractTextFromPDF(pdfPath);
        if (textoPDF === null) continue; // escaneado → descarta

        exames.push({ nome, tipo, pdfPath, dataExame: '', textoPDF });
      }

      await page.waitForTimeout(500);
    } catch (err: any) {
      logger.error(`  Erro no anexo ${i}: ${err.message}`);
    }
  }

  return exames;
}
