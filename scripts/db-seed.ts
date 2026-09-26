import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

type ConfigSeed = {
  key: string;
  value: string;
  description: string;
};

type CategorySeed = {
  name: string;
  label: string;
};

const configSeeds: ConfigSeed[] = [
  { key: "max_chats_per_user", value: "999", description: "Máximo de chats por usuario" },
  { key: "max_file_size_mb", value: "20", description: "Tamaño máximo de archivos (MB)" },
  { key: "max_knowledge_files_per_heart", value: "3", description: "Archivos de conocimiento por Heart" },
  { key: "allow_registration", value: "true", description: "Permitir nuevos registros" },
  { key: "allow_guest_access", value: "false", description: "Permitir acceso sin login" },
  { key: "default_user_role", value: "user", description: "Rol por defecto al registrarse" },
  { key: "maintenance_mode", value: "false", description: "Modo mantenimiento" },
  { key: "ollama_context_length", value: "32768", description: "Contexto del modelo (tokens)" },
  { key: "ollama_num_predict", value: "4096", description: "Tokens máximos de respuesta" },
  { key: "ollama_temperature", value: "0.3", description: "Temperatura por defecto del modelo" },
  { key: "rate_limit_per_minute", value: "30", description: "Rate limit por minuto" },
  { key: "heart_memory_enabled", value: "true", description: "Memoria persistente para Hearts" },
  { key: "chat_summary_enabled", value: "true", description: "Resúmenes automáticos de chat" },
];

const categorySeeds: CategorySeed[] = [
  { name: "general", label: "General" },
  { name: "legal", label: "Legal" },
  { name: "medico", label: "Médico" },
  { name: "procesos", label: "Procesos" },
  { name: "faq", label: "FAQ" },
  { name: "seguridad", label: "Seguridad" },
];

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Falta DATABASE_URL");
  return databaseUrl;
}

async function seedConfig(client: import("pg").PoolClient): Promise<void> {
  for (const config of configSeeds) {
    await client.query(
      `INSERT INTO config (key, value, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description`,
      [config.key, config.value, config.description],
    );
  }
}

async function seedCategories(client: import("pg").PoolClient): Promise<void> {
  for (const category of categorySeeds) {
    await client.query(
      `INSERT INTO kb_categories (name, label)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET label = EXCLUDED.label, updated_at = NOW()`,
      [category.name, category.label],
    );
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  const pool = new Pool({ connectionString: getDatabaseUrl(), max: 1 });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await seedConfig(client);
        await seedCategories(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }

  console.log(`Seed completado: ${configSeeds.length} configuraciones y ${categorySeeds.length} categorías`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
