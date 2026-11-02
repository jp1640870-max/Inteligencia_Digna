import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createBackup, updateBackupStatus } from "@/lib/db";

const execFileAsync = promisify(execFile);

function databaseUrl(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("Falta DATABASE_URL");
  return value;
}

export async function runBackup(backupId: string, createdBy: string): Promise<string> {
  const backupDir = path.join(process.cwd(), "data", "backups");
  const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`;
  const destination = path.join(backupDir, filename);
  await createBackup(backupId, filename, createdBy);
  await updateBackupStatus(backupId, "processing");
  try {
    await mkdir(backupDir, { recursive: true });
    await execFileAsync("pg_dump", [
      "--dbname",
      databaseUrl(),
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "--file",
      destination,
    ]);
    const file = await stat(destination);
    await updateBackupStatus(backupId, "completed", file.size);
    return filename;
  } catch (error) {
    await updateBackupStatus(backupId, "failed");
    throw error;
  }
}
