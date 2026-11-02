import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type EnvMap = Record<string, string>;

/**
 * Parser mínimo de archivos .env. No soporta multilínea ni expansión de
 * variables; el proyecto no usa ninguna de las dos cosas.
 */
export function parseEnvFile(fileName: string): EnvMap {
  const filePath = resolve(process.cwd(), fileName);
  if (!existsSync(filePath)) return {};

  const result: EnvMap = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** Variables de los archivos, con .env.local pisando a .env. */
export function readFileEnv(): EnvMap {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local") };
}

/** Variables efectivas: archivos primero y proceso después (gana el proceso). */
export function readEffectiveEnv(): EnvMap {
  const processEnv: EnvMap = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) processEnv[key] = value;
  }
  return { ...readFileEnv(), ...processEnv };
}
