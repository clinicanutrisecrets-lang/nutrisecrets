import { createClient } from '@supabase/supabase-js';

// O progresso é rastreado diretamente no Supabase pela coluna webdiet_id.
// Isso garante que se a execução for interrompida (timeout, erro),
// basta rodar de novo — pacientes já migrados são detectados e pulados.

function getSupabase() {
  return createClient(
    process.env.SCANNER_SUPABASE_URL!,
    process.env.SCANNER_SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getProcessedIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('pacientes')
    .select('webdiet_id')
    .eq('nutricionista_id', process.env.NUTRI_SECRETS_ID!)
    .not('webdiet_id', 'is', null);

  if (error) throw new Error(`Erro ao carregar progresso: ${error.message}`);
  return new Set((data || []).map((r: { webdiet_id: string }) => r.webdiet_id));
}
