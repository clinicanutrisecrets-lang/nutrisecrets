import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { PatientFullData } from './types';
import { PerfilData } from './extractPerfil';
import { logger } from './logger';

const supabase = createClient(
  process.env.SCANNER_SUPABASE_URL!,
  process.env.SCANNER_SUPABASE_SERVICE_ROLE_KEY!
);

const NUTRI_ID = process.env.NUTRI_SECRETS_ID!;

// Bucket por tipo de exame
const BUCKET_MAP: Record<string, string> = {
  sangue: 'exames',
  microbiota: 'exames',
  genetico: 'genetico-uploads',
};

async function uploadPDF(filePath: string, bucket: string, storagePath: string): Promise<string | null> {
  try {
    const buffer = fs.readFileSync(filePath);
    const { error } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  } catch (err: any) {
    logger.error(`Upload falhou (${bucket}/${storagePath}): ${err.message}`);
    return null;
  }
}

export async function saveToScanner(
  data: PatientFullData & { perfil: PerfilData }
): Promise<void> {
  // ── 1. Upsert paciente ────────────────────────────────────────────────────
  const anamneseTexto = data.anamneses
    .map((a) => `[${a.data}] ${a.titulo}\n${a.texto}`)
    .join('\n\n---\n\n');

  const { data: existing } = await supabase
    .from('pacientes')
    .select('id')
    .eq('webdiet_id', data.webdietId)
    .eq('nutricionista_id', NUTRI_ID)
    .maybeSingle();

  let pacienteId: string;

  if (existing?.id) {
    pacienteId = existing.id;
    logger.info(`  Paciente já existe: ${pacienteId}`);
  } else {
    const { data: novo, error } = await supabase
      .from('pacientes')
      .insert({
        nutricionista_id: NUTRI_ID,
        nome: data.perfil.nome || data.name.split(' ')[0],
        sobrenome: data.perfil.sobrenome || data.name.split(' ').slice(1).join(' '),
        email: data.perfil.email || null,
        telefone: data.perfil.telefone || null,
        data_nascimento: data.perfil.dataNascimento || null,
        sexo: normalizarSexo(data.perfil.sexo),
        cidade: data.perfil.cidade || null,
        estado: data.perfil.estado || null,
        cpf: data.perfil.cpf || null,
        dados_clinicos_relevantes: anamneseTexto || null,
        origem: 'webdiet',
        webdiet_id: data.webdietId,
        origem_migracao: 'webdiet',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Erro ao criar paciente: ${error.message}`);
    pacienteId = novo.id;
    logger.info(`  Paciente criado: ${pacienteId}`);
  }

  // ── 2. Exames (PDFs) ──────────────────────────────────────────────────────
  for (const exame of data.exames) {
    try {
      const bucket = BUCKET_MAP[exame.tipo] || 'exames';
      const ext = `${pacienteId}/${exame.tipo}_${Date.now()}.pdf`;
      const url = await uploadPDF(exame.pdfPath, bucket, ext);

      const { error } = await supabase.from('exames_paciente').insert({
        nutricionista_id: NUTRI_ID,
        paciente_id: pacienteId,
        tipo: exame.tipo,
        data_exame: parseDateBR(exame.dataExame) || null,
        valores: {},
        arquivo_url: url,
        interpretacao: exame.nome,
      });

      if (error) logger.error(`  Erro ao salvar exame: ${error.message}`);
      else logger.info(`  Exame salvo: ${exame.nome}`);
    } catch (err: any) {
      logger.error(`  Exame falhou (${exame.nome}): ${err.message}`);
    }
  }

  // ── 3. Planos alimentares ─────────────────────────────────────────────────
  for (const cardapio of data.cardapios) {
    try {
      let pdfUrl: string | null = null;

      if (cardapio.pdfPath) {
        pdfUrl = await uploadPDF(
          cardapio.pdfPath,
          'cardapios',
          `${pacienteId}/cardapio_${Date.now()}.pdf`
        );
      }

      const { error } = await supabase.from('planos_alimentares').insert({
        nutricionista_id: NUTRI_ID,
        paciente_id: pacienteId,
        titulo: cardapio.titulo,
        variante: 'a',
        refeicoes: [],
        titulo_dieta: cardapio.textoCompleto || null,
        pdf_url: pdfUrl,
        gerado_via: 'migracao_webdiet',
      });

      if (error) logger.error(`  Erro ao salvar plano: ${error.message}`);
      else logger.info(`  Plano alimentar salvo: ${cardapio.titulo}`);
    } catch (err: any) {
      logger.error(`  Plano falhou (${cardapio.titulo}): ${err.message}`);
    }
  }

  // ── 4. Suplementos e manipulados ──────────────────────────────────────────
  for (const prescricao of data.prescricoes) {
    try {
      let pdfUrl: string | null = null;

      if (prescricao.pdfPath) {
        pdfUrl = await uploadPDF(
          prescricao.pdfPath,
          'exames',
          `${pacienteId}/suplemento_${Date.now()}.pdf`
        );
      }

      const { error } = await supabase.from('suplementos_prescritos').insert({
        nutricionista_id: NUTRI_ID,
        paciente_id: pacienteId,
        suplementos: prescricao.suplementos,
        observacoes: `[${prescricao.titulo}]\n\n${prescricao.textoOriginal}`.trim(),
        pdf_url: pdfUrl,
        favorito: false,
        template_titulo: prescricao.titulo,
      });

      if (error) logger.error(`  Erro ao salvar prescrição: ${error.message}`);
      else logger.info(`  Prescrição salva: ${prescricao.titulo}`);
    } catch (err: any) {
      logger.error(`  Prescrição falhou (${prescricao.titulo}): ${err.message}`);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizarSexo(raw: string): string | null {
  if (!raw) return null;
  const r = raw.toLowerCase();
  if (r.includes('fem') || r === 'f') return 'feminino';
  if (r.includes('mas') || r === 'm') return 'masculino';
  return null;
}

function parseDateBR(raw: string): string | null {
  if (!raw) return null;
  // DD/MM/YYYY → YYYY-MM-DD
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Já em ISO
  if (raw.match(/^\d{4}-\d{2}-\d{2}/)) return raw.substring(0, 10);
  return null;
}
