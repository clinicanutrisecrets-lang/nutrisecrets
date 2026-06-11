import { Page } from 'playwright';

export interface PerfilData {
  nome: string;
  sobrenome: string;
  email: string;
  telefone: string;
  dataNascimento: string;
  sexo: string;
  cidade: string;
  estado: string;
  cpf: string;
}

export async function extractPerfil(page: Page): Promise<PerfilData> {
  // Clica em "Perfil do paciente" na sidebar
  await clickSidebarItem(page, 'Perfil do paciente');

  const get = async (selectors: string[]): Promise<string> => {
    for (const sel of selectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 })) {
          const val = await el.inputValue().catch(() => el.textContent());
          if (val?.trim()) return val.trim();
        }
      } catch { /* tenta próximo */ }
    }
    return '';
  };

  // Tenta extrair campos comuns — seletores genéricos que funcionam em forms HTML padrão
  const nomeCompleto = await get([
    'input[name="nome"]', 'input[placeholder*="nome" i]',
    'input[id*="nome" i]', 'input[name*="name" i]',
  ]);

  const partes = nomeCompleto.split(' ');
  const nome = partes[0] || nomeCompleto;
  const sobrenome = partes.slice(1).join(' ');

  return {
    nome,
    sobrenome,
    email: await get(['input[name="email"]', 'input[type="email"]']),
    telefone: await get(['input[name="telefone"]', 'input[name="phone"]', 'input[placeholder*="telefone" i]']),
    dataNascimento: await get(['input[name="data_nascimento"]', 'input[name="birthdate"]', 'input[type="date"]']),
    sexo: await get(['select[name="sexo"]', 'select[name="gender"]']),
    cidade: await get(['input[name="cidade"]', 'input[name="city"]']),
    estado: await get(['input[name="estado"]', 'select[name="estado"]', 'input[name="state"]']),
    cpf: await get(['input[name="cpf"]']),
  };
}

export async function clickSidebarItem(page: Page, label: string): Promise<void> {
  const item = page.locator(`text="${label}"`).first();
  if (await item.isVisible({ timeout: 3000 })) {
    await item.click();
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}
