import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { ExamePDF } from './types';
import { clickSidebarItem } from './extractPerfil';
import { logger } from './logger';

// Palavras que indicam que o PDF é um RESULTADO (manter)
const RESULTADO_KEYWORDS = ['resultado', 'laudo', 'report', 'hemograma', 'bioquimica', 'bioquímica',
  'glicemia', 'colesterol', 'triglicerides', 'triglicérides', 'hormon', 'tiroide', 'tireoide',
  'ferritin', 'vitamina', 'mineral', 'proteina', 'proteína', 'exame'];

// Palavras que indicam PEDIDO (descartar)
const PEDIDO_KEYWORDS = ['pedido', 'solicitacao', 'solicitação', 'requisicao', 'requisição',
  'encaminhamento', 'receitu', 'prescricao', 'prescrição', 'ordem'];

// Palavras que indicam GENÉTICO (guardar nos anexos)
const GENETICO_KEYWORDS = ['geneti', 'genômi', 'genomi', 'dna', 'gene', 'snp', 'polimorf'];

// Palavras que indicam MICROBIOTA (guardar nos anexos)
const MICROBIOTA_KEYWORDS = ['microbiota', 'microbiom', 'flora', 'intestin', 'coprologic', 'coprológic',
  'parasit', 'disbiose', 'bacterio'];

// Palavras que indicam LÂMINA EDUCATIVA (descartar dos anexos)
const EDUCATIVO_KEYWORDS = ['lamina', 'lâmina', 'educativ', 'higieniz', 'aliment', 'receita',
  'orientacao', 'orientação', 'cardapio', 'cardápio', 'protocolo', 'guia'];

function classificarExame(nome: string): { tipo: ExamePDF['tipo'] | null } {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (PEDIDO_KEYWORDS.some((k) => n.includes(k))) return { tipo: null };
  if (RESULTADO_KEYWORDS.some((k) => n.includes(k))) return { tipo: 'sangue' };

  // Se nenhuma keyword bater, mantém como sangue (benefício da dúvida para exames laboratoriais)
  return { tipo: 'sangue' };
}

function classificarAnexo(nome: string): { tipo: ExamePDF['tipo'] | null } {
  const n = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (EDUCATIVO_KEYWORDS.some((k) => n.includes(k))) return { tipo: null };
  if (GENETICO_KEYWORDS.some((k) => n.includes(k))) return { tipo: 'genetico' };
  if (MICROBIOTA_KEYWORDS.some((k) => n.includes(k))) return { tipo: 'microbiota' };

  return { tipo: null }; // Não identificado → descarta
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

export async function extractExamesLaboratoriais(
  page: Page,
  patientId: string
): Promise<ExamePDF[]> {
  const exames: ExamePDF[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'exames');

  await clickSidebarItem(page, 'Exames laboratoriais');
  await page.waitForTimeout(1000);

  // Encontra todos os itens de exame com link/botão de PDF
  const items = await page.$$('[class*="exame-item"], [class*="exam-item"], [class*="laboratorial"]');

  // Fallback: busca por links/botões de PDF diretos na seção
  const pdfLinks = items.length > 0
    ? items
    : await page.$$('a[href$=".pdf"], button:has-text("PDF"), a:has-text("PDF")');

  for (let i = 0; i < pdfLinks.length; i++) {
    try {
      const nome = await pdfLinks[i].textContent().then((t) => t?.trim() || `exame_${i}`);
      const { tipo } = classificarExame(nome);

      if (!tipo) {
        logger.info(`  Ignorando (parece pedido): ${nome}`);
        continue;
      }

      logger.info(`  Baixando exame: ${nome}`);
      const pdfPath = await downloadPDF(
        page,
        () => pdfLinks[i].click(),
        saveDir,
        `sangue_${i}`
      );

      if (pdfPath) {
        const dataEl = await pdfLinks[i].$$eval(
          '[class*="data"], [class*="date"], small',
          (els) => els[0]?.textContent?.trim() || ''
        ).catch(() => '');

        exames.push({ nome, tipo, pdfPath, dataExame: dataEl });
      }

      await page.waitForTimeout(500);
    } catch (err: any) {
      logger.error(`  Erro no exame ${i}: ${err.message}`);
    }
  }

  return exames;
}

export async function extractArquivosAnexos(
  page: Page,
  patientId: string
): Promise<ExamePDF[]> {
  const exames: ExamePDF[] = [];
  const saveDir = path.join(process.env.DOWNLOADS_PATH || './downloads', patientId, 'anexos');

  await clickSidebarItem(page, 'Arquivos anexos');
  await page.waitForTimeout(1000);

  // Encontra todos os itens na seção de arquivos
  const items = await page.$$('[class*="arquivo-item"], [class*="attachment"], [class*="anexo-item"]');
  const targets = items.length > 0
    ? items
    : await page.$$('a[href$=".pdf"], button:has-text("PDF"), a:has-text("PDF"), [class*="arquivo"] a');

  for (let i = 0; i < targets.length; i++) {
    try {
      const nome = await targets[i].textContent().then((t) => t?.trim() || `anexo_${i}`);
      const { tipo } = classificarAnexo(nome);

      if (!tipo) {
        logger.info(`  Ignorando anexo (não é exame clínico): ${nome}`);
        continue;
      }

      logger.info(`  Baixando anexo ${tipo}: ${nome}`);
      const pdfPath = await downloadPDF(
        page,
        () => targets[i].click(),
        saveDir,
        `${tipo}_${i}`
      );

      if (pdfPath) {
        exames.push({ nome, tipo, pdfPath, dataExame: '' });
      }

      await page.waitForTimeout(500);
    } catch (err: any) {
      logger.error(`  Erro no anexo ${i}: ${err.message}`);
    }
  }

  return exames;
}
