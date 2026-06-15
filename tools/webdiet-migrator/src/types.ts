export interface PatientSummary {
  id: string;
  name: string;
  profileUrl: string;
}

export interface AnamneseRecord {
  titulo: string;
  data: string;
  texto: string;
}

export interface ExamePDF {
  nome: string;
  tipo: 'sangue' | 'microbiota' | 'genetico' | 'coprologico';
  pdfPath: string;
  dataExame: string;
  textoPDF?: string;
}

export interface CardapioData {
  titulo: string;
  pdfPath: string | null;
  textoCompleto: string;
  kcal: string;
}

export interface SuplementoItem {
  nome: string;
  dosagem: string;
  duracao: string;
  horario: string;
  instrucoes: string;
}

export interface PrescricaoData {
  titulo: string;
  suplementos: SuplementoItem[];
  textoOriginal: string;
  pdfPath: string | null;
  tipo: 'suplementos' | 'manipulado';
}

export interface PatientFullData {
  webdietId: string;
  name: string;
  profileUrl: string;
  anamneses: AnamneseRecord[];
  exames: ExamePDF[];
  cardapios: CardapioData[];
  prescricoes: PrescricaoData[];
}
