import { Page } from 'playwright';
import { PatientSummary, PatientFullData } from './types';
import { extractPerfil, PerfilData } from './extractPerfil';
import { extractAnamnese } from './extractAnamnese';
import { extractExamesLaboratoriais, extractArquivosAnexos } from './extractExames';
import { extractCardapio } from './extractCardapio';
import { extractSuplementos, extractManipulados } from './extractSuplementos';
import { logger } from './logger';

async function abrirPaciente(page: Page, patient: PatientSummary): Promise<PerfilData> {
  const url = process.env.WEBDIET_URL! + patient.profileUrl;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Se apareceu o modal "Você está realizando uma nova consulta?"
  // clica em "não registrar e abrir menu do paciente"
  const naoRegistrar = page.locator(
    'text="não registrar e abrir menu do paciente", button:has-text("não registrar")'
  ).first();

  if (await naoRegistrar.isVisible({ timeout: 3000 }).catch(() => false)) {
    await naoRegistrar.click();
    await page.waitForLoadState('networkidle');
    logger.info('  Modal de nova consulta dispensado');
  }

  await page.waitForTimeout(600);
  return extractPerfil(page);
}

export async function extractPatientData(
  page: Page,
  patient: PatientSummary
): Promise<PatientFullData & { perfil: PerfilData }> {
  const perfil = await abrirPaciente(page, patient);

  const anamneses = await extractAnamnese(page).catch((e) => {
    logger.error(`  Anamnese falhou: ${e.message}`);
    return [];
  });

  const examesLab = await extractExamesLaboratoriais(page, patient.id).catch((e) => {
    logger.error(`  Exames lab falhou: ${e.message}`);
    return [];
  });

  const examesAnexos = await extractArquivosAnexos(page, patient.id).catch((e) => {
    logger.error(`  Arquivos anexos falhou: ${e.message}`);
    return [];
  });

  const cardapios = await extractCardapio(page, patient.id).catch((e) => {
    logger.error(`  Cardápio falhou: ${e.message}`);
    return [];
  });

  const suplementos = await extractSuplementos(page, patient.id).catch((e) => {
    logger.error(`  Suplementos falhou: ${e.message}`);
    return [];
  });

  const manipulados = await extractManipulados(page, patient.id).catch((e) => {
    logger.error(`  Manipulados falhou: ${e.message}`);
    return [];
  });

  return {
    webdietId: patient.id,
    name: patient.name,
    profileUrl: patient.profileUrl,
    perfil,
    anamneses,
    exames: [...examesLab, ...examesAnexos],
    cardapios,
    prescricoes: [...suplementos, ...manipulados],
  };
}
