import * as fs from 'fs';

const FILE = process.env.PROGRESS_FILE || './progress.json';

export interface Progress {
  processedIds: string[];
  errors: Array<{ id: string; name: string; error: string }>;
  startedAt: string;
  lastRunAt: string;
}

export function loadProgress(): Progress {
  if (fs.existsSync(FILE)) {
    try {
      return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    } catch {
      // arquivo corrompido — recomeça
    }
  }
  return { processedIds: [], errors: [], startedAt: new Date().toISOString(), lastRunAt: '' };
}

export function saveProgress(p: Progress): void {
  p.lastRunAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(p, null, 2));
}

export function markDone(p: Progress, id: string): void {
  if (!p.processedIds.includes(id)) p.processedIds.push(id);
  saveProgress(p);
}

export function markError(p: Progress, id: string, name: string, error: string): void {
  p.errors.push({ id, name, error });
  saveProgress(p);
}
