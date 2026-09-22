import Database from "better-sqlite3";
import path from "path";

/**
 * Única conexión SQLite del proceso.
 *
 * Toda la app (lib/db.ts, lib/projects.ts, lib/backup.ts) debe obtener la
 * base de datos exclusivamente por `getSharedDb()`. Abrir más de un handle
 * sobre el mismo archivo provoca SQLITE_BUSY en escrituras concurrentes y
 * checkpoints WAL inconsistentes.
 *
 * Preparación para Postgres: este módulo es la única costura de acceso a
 * datos. Migrar el motor implicará añadir `lib/db/postgres/` tras una
 * interfaz y conmutar aquí por `DB_DRIVER`, sin tocar las rutas.
 */

const DB_PATH = path.join(process.cwd(), "data", "app.db");

let sharedDb: Database.Database | null = null;

export function getSharedDb(): Database.Database {
  if (!sharedDb) {
    sharedDb = new Database(DB_PATH);
    sharedDb.pragma("journal_mode = WAL");
    sharedDb.pragma("foreign_keys = ON");
  }
  return sharedDb;
}
