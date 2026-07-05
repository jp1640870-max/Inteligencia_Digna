const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "..", "data", "app.db");
const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Uso: node scripts/reset-password.js <email> <nueva-password>");
  process.exit(1);
}

const db = new Database(DB_PATH);
const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

if (!user) {
  console.error(`Usuario con email "${email}" no encontrado.`);
  process.exit(1);
}

const hash = bcrypt.hashSync(newPassword, 10);
db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, email);

console.log(`Contraseña actualizada para ${email}`);
db.close();
