export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type Msg = {
  id?: number;
  role: "user" | "ai";
  text?: string;
  images?: string[];
  files?: { name: string }[];
  editResult?: EditResult;
  searching?: boolean;
  sources?: SearchResult[];
};

export type Chat = {
  id: string;
  title: string;
  messages: Msg[];
  created_at?: string;
  updated_at?: string;
};

export type User = {
  id: string;
  email: string;
  name: string | null;
};

export type Project = {
  id: string;
  name: string;
  instructions: string;
  created_at: string;
  chat_count?: number;
};

export type ProjectChat = {
  project_id: string;
  chat_id: string;
  added_at: string;
};

export type ProyectoConChats = Project & {
  chats: Chat[];
};

export type EditFormat = "xlsx" | "docx" | "pdf";

export type CellEdit = {
  sheet?: string;
  cell: string;
  value: string | number;
};

export type RowInsertEdit = {
  sheet?: string;
  afterRow: number;
  values: (string | number)[][];
};

export type ColInsertEdit = {
  sheet?: string;
  afterCol: string;
  header: string;
  values: (string | number)[];
};

export type RowDeleteEdit = {
  sheet?: string;
  row: number;
};

export type ColDeleteEdit = {
  sheet?: string;
  col: string;
};

export type ParagraphEdit = {
  paragraphIndex: number;
  action: "replaceText" | "deleteParagraph" | "insertAfter";
  newText?: string;
};

export type PdfTextEdit = {
  pageNumber: number;
  oldText: string;
  newText: string;
};

export type EditInstruction = {
  format: EditFormat;
  description?: string;
  changes: CellEdit[] | RowInsertEdit[] | ColInsertEdit[] | RowDeleteEdit[] | ColDeleteEdit[] | ParagraphEdit[] | PdfTextEdit[];
};

export type EditResult = {
  success: boolean;
  format: EditFormat;
  filename: string;
  originalName: string;
  changesCount: number;
  downloadUrl?: string;
  dataUri?: string;
  error?: string;
};

// Document generation types
export type DocGenFormat = "xlsx" | "docx" | "pdf";

export type DocGenSheet = {
  name: string;
  headers?: string[];
  rows: string[][];
};

export type DocGenContentBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string; level?: number }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers?: string[]; rows: string[][] };

export type DocGenStructure = {
  format: DocGenFormat;
  filename: string;
  sheets?: DocGenSheet[];
  content?: DocGenContentBlock[];
};
