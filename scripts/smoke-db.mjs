// Smoke de regresión F0.2: inicialización de la DB sin recursión infinita.
// Corre contra una DB FRESCA en un directorio temporal (nunca toca data/app.db):
//   npm run smoke:db
// Falla (crash por recursión getDb → initTables → init* → getDb) si se rompe
// el guard de inicialización en lib/db.ts o lib/projects.ts.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "id-smoke-"));
mkdirSync(join(tmp, "data"), { recursive: true });
process.chdir(tmp);

const db = await import("../lib/db.js");
const projects = await import("../lib/projects.js");
const { getSharedDb } = await import("../lib/db-connection.js");

// 1. Init completa desde cero (tablas + seeds + migración legacy)
const maintenance = db.getConfig("maintenance_mode");
assert.equal(typeof maintenance, "string");
console.log("getConfig:", maintenance);

// 2. Módulo de proyectos sobre la MISMA conexión y archivo
projects.getProjectsByUser("inexistente");
const tables = getSharedDb()
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .all()
  .map((t) => t.name);
assert.ok(tables.includes("users"), "falta tabla users (lib/db.ts)");
assert.ok(tables.includes("projects"), "falta tabla projects (lib/projects.ts)");
console.log("tablas de ambos módulos en el mismo archivo: ok");

console.log("SMOKE-DB-OK dir=" + tmp);
