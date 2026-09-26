const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Uso: node scripts/reset-password.js <email> <nueva-password>");
  process.exit(1);
}
if (newPassword.length < 12) {
  console.error("La nueva contraseña debe tener al menos 12 caracteres");
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
    const result = await pool.query("UPDATE users SET password_hash = $1 WHERE LOWER(email) = LOWER($2)", [hash, email]);
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
