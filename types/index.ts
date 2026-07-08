export type Msg = {
  id?: number;
  role: "user" | "ai";
  text?: string;
  images?: string[];
  files?: { name: string }[];
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
