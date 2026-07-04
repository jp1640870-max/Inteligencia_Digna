//archivo index este se encarga de exportar los tipos de datos que se van a utilizar en la aplicación
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
};

export type User = {
  id: string;
  email: string;
  name: string | null;
};
