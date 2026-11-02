/**
 * Sincroniza .env -> .env.local.
 *
 * .env es la fuente de verdad. .env.local se conserva porque Next.js lo carga
 * aparte y algunos scripts lo leen directamente. El archivo anterior se guarda
 * como .env.local.bak (ignorado por Git).
 */
const fs = require("fs");
const path = require("path");

const source = path.join(process.cwd(), ".env");
const target = path.join(process.cwd(), ".env.local");

if (!fs.existsSync(source)) {
  console.error("\n❌ No existe .env. Cópialo desde .env.example y complétalo.\n");
  process.exit(1);
}

if (fs.existsSync(target)) {
  const backup = `${target}.bak`;
  fs.copyFileSync(target, backup);
  console.log(`📦 Backup del .env.local anterior: ${path.basename(backup)}`);
}

fs.copyFileSync(source, target);
console.log("✅ .env -> .env.local sincronizado.\n");
