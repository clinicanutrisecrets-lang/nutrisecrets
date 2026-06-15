import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import { PatientFullData, ExamePDF } from './types';
import { PerfilData } from './extractPerfil';
import { logger } from './logger';

function getSupabase() {
  return createClient(
    process.env.SCANNER_SUPABASE_URL!,
    process.env.SCANNER_SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getNutriId() {
  return process.env.NUTRI_SECRETS_ID!;
}

const BUCKET_MAP: Record<string, string> = {
  sangue: 'exames',
  microbiota: 'exames',
  coprologico: 'exames',
  genetico: 'genetico-uploads',
};

async function uploadPDF(filePath: string, bucket: string, storagePath: string): Promise<string | null> {
  try {
    const buffer = fs.readFileSync(filePath);
    const { error } = await getSupabase().storage.from(bucket).upload(storagePath, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (error) throw error;
    const { data } = getSupabase().storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  } catch (err: any) {
    logger.error(`Upload falhou (${bucket}/${storagePath}): ${err.message}`);
    return null;
  }
}

// Retém apenas o mais recente por tipo de exame
function filtrarUltimoPorTipo(exames: ExamePDF[]): ExamePDF[] {
  const seen = new Set<string>();
  return exames.filter((e) => {
    if (seen.has(e.tipo)) return false;
    seen.add(e.tipo);
    return true;
  });
}

export async function saveToScanner(
  data: PatientFullData & { perfil: PerfilData }
): Promise<void> {
  const supabase = getSupabase();
  const nutriId = getNutriId();

  // ── 1. Upsert paciente ────────────────────────────────────────────────────
  const { data: existing } = await supabase
    .from('pacientes')
    .select('id')
    .eq('webdiet_id', data.webdietId)
    .eq('nutricionista_id', nutriId)
    .maybeSingle();

  let pacienteId: string;

  if (existing?.id) {
    pacienteId = existing.id;
    logger.info(`  Paciente já existe: ${pacienteId}`);
  } else {
    const { data: novo, error } = await supabase
      .from('pacientes')
      .insert({
        nutricionista_id: nutriId,
        nome: data.perfil.nome || data.name.split(' ')[0],
        sobrenome: data.perfil.sobrenome || data.name.split(' ').slice(1).join(' '),
        email: data.perfil.email || null,
        telefone: data.perfil.telefone || null,
        data_nascimento: data.perfil.dataNascimento || null,
        sexo: normalizarSexo(data.perfil.sexo),
        cidade: data.perfil.cidade || null,
        estado: data.perfil.estado || null,
        cpf: data.perfil.cpf || null,
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

  // ── 2. Consulta histórica ─────────────────────────────────────────────────
  // Uma consulta por entrada de anamnese; primeira consulta recebe suplementos/cardápio.
  let primeiraConsultaId: string | null = null;

  const anamnesesToSalvar = data.anamneses.length > 0
    ? data.anamneses
    : [{ titulo: 'Importado do WebDiet', data: '', texto: '' }];

  for (const anamnese of anamnesesToSalvar) {
    const dataConsulta = parseDateBR(anamnese.data) || new Date().toISOString();
    const observacoes = [anamnese.titulo, anamnese.texto].filter(Boolean).join('\n\n');

    const { data: consulta, error } = await supabase
      .from('consultas')
      .insert({
        nutricionista_id: nutriId,
        paciente_id: pacienteId,
        tipo_prontuario: 'nutricional',
        tipo: 'Retorno',
        status: 'realizada',
        na_agenda: false,
        data_hora: dataConsulta,
        observacoes: observacoes || null,
      })
      .select('id')
      .single();

    if (error) {
      logger.error(`  Erro ao criar consulta: ${error.message}`);
      continue;
    }

    if (!primeiraConsultaId) primeiraConsultaId = consulta.id;
    logger.info(`  Consulta criada (${anamnese.titulo || 'sem título'}): ${consulta.id}`);
  }

  // ── 3. Exames (sangue, microbiota, coprologico) — só o mais recente por tipo
  const examesSemGenetico = filtrarUltimoPorTipo(
    data.exames.filter((e) => e.tipo !== 'genetico')
  );

  for (const exame of examesSemGenetico) {
    try {
      const bucket = BUCKET_MAP[exame.tipo] || 'exames';
      const storagePath = `${pacienteId}/${exame.tipo}_${Date.now()}.pdf`;
      const url = await uploadPDF(exame.pdfPath, bucket, storagePath);

      const { error } = await supabase.from('exames_paciente').insert({
        nutricionista_id: nutriId,
        paciente_id: pacienteId,
        consulta_id: primeiraConsultaId,
        tipo: exame.tipo,
        data_exame: parseDateBR(exame.dataExame) || null,
        valores: {},
        arquivo_url: url,
        interpretacao: exame.textoPDF || exame.nome,
      });

      if (error) logger.error(`  Erro ao salvar exame: ${error.message}`);
      else logger.info(`  Exame salvo: ${exame.nome} (${exame.tipo})`);
    } catch (err: any) {
      logger.error(`  Exame falhou (${exame.nome}): ${err.message}`);
    }
  }

  // ── 4. Exame genético → testes_geneticos (fora da consulta, no perfil)
  const examesGenetico = data.exames.filter((e) => e.tipo === 'genetico');
  if (examesGenetico.length > 0) {
    const exame = examesGenetico[0]; // mais recente
    try {
      const storagePath = `${pacienteId}/genetico_${Date.now()}.pdf`;
      await getSupabase().storage.from('genetico-uploads').upload(
        storagePath,
        fs.readFileSync(exame.pdfPath),
        { contentType: 'application/pdf', upsert: true }
      );

      const { error } = await supabase.from('testes_geneticos').insert({
        nutricionista_id: nutriId,
        paciente_id: pacienteId,
        snps: {},
        genotipos: {},
        interpretacao: exame.textoPDF || exame.nome,
        arquivo_storage_path: storagePath,
        arquivo_nome: `genetico_${data.name}.pdf`,
      });

      if (error) logger.error(`  Erro ao salvar genético: ${error.message}`);
      else logger.info(`  Exame genético salvo no perfil`);
    } catch (err: any) {
      logger.error(`  Genético falhou: ${err.message}`);
    }
  }

  // ── 5. Planos alimentares (texto livre) ───────────────────────────────────
  for (const cardapio of data.cardapios) {
    try {
      let pdfUrl: string | null = null;
      if (cardapio.pdfPath) {
        pdfUrl = await uploadPDF(
          cardapio.pdfPath, 'cardapios',
          `${pacienteId}/cardapio_${Date.now()}.pdf`
        );
      }

      const { error } = await supabase.from('planos_alimentares').insert({
        nutricionista_id: nutriId,
        paciente_id: pacienteId,
        consulta_id: primeiraConsultaId,
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

  // ── 6. Suplementos e manipulados ──────────────────────────────────────────
  for (const prescricao of data.prescricoes) {
    try {
      let pdfUrl: string | null = null;
      if (prescricao.pdfPath) {
        pdfUrl = await uploadPDF(
          prescricao.pdfPath, 'exames',
          `${pacienteId}/suplemento_${Date.now()}.pdf`
        );
      }

      const { error } = await supabase.from('suplementos_prescritos').insert({
        nutricionista_id: nutriId,
        paciente_id: pacienteId,
        consulta_id: primeiraConsultaId,
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
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (raw.match(/^\d{4}-\d{2}-\d{2}/)) return raw.substring(0, 10);
  return null;
}
