import * as fs from 'fs';
import { logger } from './logger';

const MIN_TEXT_LENGTH = 80; // menos que isso → provavelmente escaneado

export async function extractTextFromPDF(pdfPath: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(pdfPath);
    const data = await pdfParse(buffer);
    const text = (data.text || '').trim();

    if (text.length < MIN_TEXT_LENGTH) {
      logger.info(`  PDF escaneado (${text.length} chars) — descartando: ${pdfPath}`);
      return null;
    }

    logger.info(`  Texto extraído do PDF: ${text.length} chars`);
    return text;
  } catch (err: any) {
    logger.error(`  Erro ao extrair texto do PDF ${pdfPath}: ${err.message}`);
    return null;
  }
}
