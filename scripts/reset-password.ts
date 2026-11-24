import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { validatePasswordPolicy } from "../lib/password-policy";

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Uso: npm run db:reset-password -- <email> <nueva-password>");
  process.exit(1);
}

const passwordCheck = validatePasswordPolicy(newPassword);
if (!passwordCheck.valid) {
  console.error(`Contraseña inválida: ${passwordCheck.errors.join("; ")}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)",
      [hash, email],
    );
    if (result.rowCount === 0) {
      console.error(`Usuario con email "${email}" no encontrado.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Contraseña actualizada para ${email}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
