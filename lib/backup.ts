import fs from "fs";
import path from "path";
import { createBackup, updateBackupStatus } from "@/lib/db";

export function runBackup(backupId: string, createdBy: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const Database = require("better-sqlite3");
      const dbPathLocal = path.join(process.cwd(), "data", "app.db");
      const backupDir = path.join(process.cwd(), "data", "backups");
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `backup-${dateStr}.db`;
      const destPath = path.join(backupDir, filename);

      // WAL checkpoint primero
      const db = new Database(dbPathLocal);
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();

      // Copiar archivo
      fs.copyFileSync(dbPathLocal, destPath);
      const stats = fs.statSync(destPath);

      createBackup(backupId, filename, createdBy);
      updateBackupStatus(backupId, "completed", stats.size);

      resolve(filename);
    } catch (e) {
      updateBackupStatus(backupId, "failed");
      reject(e);
    }
  });
}

export function getBackupFiles() {
  const backupDir = path.join(process.cwd(), "data", "backups");
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const stat = fs.statSync(path.join(backupDir, f));
      return { filename: f, size: stat.size, mtime: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}
