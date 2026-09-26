import { existsSync } from "node:fs";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

async function main(): Promise<void> {
  loadEnvironment();
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Administración";
  const role = process.env.ADMIN_ROLE || "admin";
  if (!process.env.DATABASE_URL || !email || !password) {
    throw new Error("Define DATABASE_URL, ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador");
  }
  if (!["super_admin", "admin"].includes(role)) throw new Error("ADMIN_ROLE debe ser super_admin o admin");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const existing = await pool.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
    if (existing.rows[0]) {
      await pool.query(
        "UPDATE users SET name = $1, password_hash = $2, role = $3 WHERE id = $4",
        [name, passwordHash, role, existing.rows[0].id],
      );
    } else {
      await pool.query(
        "INSERT INTO users (id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, $5)",
        [randomUUID(), email.toLowerCase(), name, passwordHash, role],
      );
    }
    console.log(`Administrador ${email} creado o actualizado`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
