import * as dotenv from 'dotenv';
dotenv.config();

import { chromium } from 'playwright';
import { login } from './auth';
import { getAllPatients } from './listPatients';
import { extractPatientData } from './extractPatient';
import { saveToScanner } from './saveToScanner';
import { getProcessedIds } from './progress';
import { logger } from './logger';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════');
  logger.info('  MIGRAÇÃO WEBDIET → SCANNER DA SAÚDE');
  logger.info('═══════════════════════════════════════════');

  const browser = await chromium.launch({
    headless: process.env.HEADLESS === 'true',
    slowMo: 300,
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    // Aceita downloads automaticamente
    acceptDownloads: true,
  });

  const page = await context.newPage();

  try {
    // 1. Login
    await login(page);

    // 2. Progresso — verifica no Supabase quem já foi migrado
    logger.info('Verificando progresso no Supabase...');
    const done = await getProcessedIds();
    logger.info(`Já migrados: ${done.size} pacientes`);

    // 3. Lista de pacientes
    logger.info('Obtendo lista de pacientes...');
    const allPatients = await getAllPatients(page);
    logger.info(`Total encontrado: ${allPatients.length}`);

    const pending = allPatients.filter((p) => !done.has(p.id));
    logger.info(`Pendentes: ${pending.length}`);

    if (pending.length === 0) {
      logger.info('Nada a fazer — todos os pacientes já foram migrados.');
      return;
    }

    // 4. Processa cada paciente
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pending.length; i++) {
      const patient = pending[i];
      logger.info('───────────────────────────────────────────');
      logger.info(`[${i + 1}/${pending.length}] ${patient.name} (id: ${patient.id})`);

      try {
        const data = await extractPatientData(page, patient);
        await saveToScanner(data);

        successCount++;
        logger.info(`✅ Sucesso: ${patient.name}`);
      } catch (err: any) {
        errorCount++;
        logger.error(`❌ Erro em ${patient.name}: ${err.message}`);
      }

      // Delay entre pacientes para não sobrecarregar o WebDiet
      const delay = parseInt(process.env.DELAY_MS || '3000');
      await page.waitForTimeout(delay);
    }

    // 5. Relatório final
    logger.info('═══════════════════════════════════════════');
    logger.info('MIGRAÇÃO CONCLUÍDA');
    logger.info(`✅ Sucesso:  ${successCount}`);
    logger.info(`❌ Erros:    ${errorCount}`);
    logger.info(`📦 Total:    ${successCount + errorCount}/${allPatients.length}`);
    if (errorCount > 0) {
      logger.info('Verifique logs/errors.log para detalhes dos erros.');
    }
    logger.info('═══════════════════════════════════════════');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error(`Erro fatal: ${err.message}`);
  process.exit(1);
});
