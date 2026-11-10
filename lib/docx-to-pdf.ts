import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Conversión DOCX → PDF con LibreOffice headless.
 *
 * Se usa un perfil temporal por conversión (`-env:UserInstallation`) para evitar
 * el lock de LibreOffice y se limita la concurrencia porque cada instancia pesa.
 */

const WINDOWS_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
];

const POSIX_CANDIDATES = [
  "/usr/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/lib/libreoffice/program/soffice",
  "/opt/libreoffice/program/soffice",
];

const DARWIN_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];

const MAX_CAPTURED_OUTPUT = 64_000;

export class LibreOfficeUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibreOfficeUnavailableError";
  }
}

export class LibreOfficeConversionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibreOfficeConversionError";
  }
}

export type ConvertDocxToPdfOptions = {
  /** Cancela la conversión y termina el proceso de LibreOffice. */
  signal?: AbortSignal;
  /** Tiempo máximo de conversión. Por defecto `DOC_CONVERSION_TIMEOUT_MS` (60 s). */
  timeoutMs?: number;
};

function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  return clampInt(Number(process.env[name]), fallback, min, max);
}

function findOnPath(command: string): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) return null;

  const names =
    process.platform === "win32"
      ? [`${command}.exe`, `${command}.com`, `${command}.bat`, `${command}.cmd`, command]
      : [command];

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Indica si `DOC_PDF_ENGINE` permite usar LibreOffice (por defecto sí). */
export function isLibreOfficeEnabled(): boolean {
  const engine = (process.env.DOC_PDF_ENGINE || "libreoffice").trim().toLowerCase();
  return engine !== "pdf-lib";
}

/**
 * Resuelve el binario de LibreOffice: `LIBREOFFICE_BIN`, rutas típicas del
 * sistema o búsqueda en `PATH`. Devuelve `null` si no lo encuentra.
 */
export function resolveLibreOfficeBinary(): string | null {
  const configured = process.env.LIBREOFFICE_BIN?.trim();
  if (configured) {
    if (existsSync(configured)) return configured;
    const onPath = findOnPath(configured);
    if (onPath) return onPath;
    return null;
  }

  const candidates =
    process.platform === "win32"
      ? WINDOWS_CANDIDATES
      : process.platform === "darwin"
        ? DARWIN_CANDIDATES
        : POSIX_CANDIDATES;
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return findOnPath("soffice");
}

/** `true` si el motor está habilitado y el binario existe. */
export function isLibreOfficeAvailable(): boolean {
  return isLibreOfficeEnabled() && resolveLibreOfficeBinary() !== null;
}

function conversionTimeoutMs(): number {
  return envInt("DOC_CONVERSION_TIMEOUT_MS", 60_000, 5_000, 300_000);
}

function maxConcurrency(): number {
  return envInt("DOC_CONVERSION_CONCURRENCY", 2, 1, 8);
}

// ─── Circuit breaker ────────────────────────────────────────────────────────
//
// LibreOffice puede fallar de forma repetida (perfil corrupto, proceso zombie,
// actualización a medias). Tras un fallo se deja de intentar durante un tiempo
// y se usa el generador pdf-lib como respaldo, en vez de pagar el timeout en
// cada documento.

const DEFAULT_CIRCUIT_COOLDOWN_MS = 60_000;
let circuitOpenUntil = 0;
let circuitWarned = false;

function circuitCooldownMs(): number {
  return envInt(
    "DOC_LIBREOFFICE_COOLDOWN_MS",
    DEFAULT_CIRCUIT_COOLDOWN_MS,
    5_000,
    600_000,
  );
}

/** `true` mientras el circuito esté abierto por un fallo reciente. */
export function isLibreOfficeCircuitOpen(): boolean {
  return circuitOpenUntil > Date.now();
}

function openLibreOfficeCircuit(reason: string): void {
  circuitOpenUntil = Date.now() + circuitCooldownMs();
  if (!circuitWarned) {
    circuitWarned = true;
    console.warn(
      `[docx-to-pdf] Circuito abierto durante ${circuitCooldownMs()} ms: ${reason}`,
    );
  }
}

function resetLibreOfficeCircuit(): void {
  circuitOpenUntil = 0;
  circuitWarned = false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

// ─── Semáforo ───────────────────────────────────────────────────────────────

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
};

let activeConversions = 0;
const waiters: Waiter[] = [];

function abortError(): Error {
  const error = new Error("Conversión a PDF cancelada");
  error.name = "AbortError";
  return error;
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    // El slot pasa directo al siguiente sin bajar el contador.
    next.cleanup();
    next.resolve(releaseSlot);
    return;
  }
  activeConversions = Math.max(0, activeConversions - 1);
}

function acquireSlot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted) return Promise.reject(abortError());

  if (activeConversions < maxConcurrency()) {
    activeConversions += 1;
    return Promise.resolve(releaseSlot);
  }

  return new Promise((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      cleanup: () => undefined,
    };

    const onAbort = () => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(abortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    waiter.cleanup = () => signal?.removeEventListener("abort", onAbort);
    waiters.push(waiter);
  });
}

// ─── Proceso ────────────────────────────────────────────────────────────────

type RunLibreOfficeOptions = {
  binary: string;
  inputPath: string;
  outputDir: string;
  profileDir: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length > MAX_CAPTURED_OUTPUT ? next.slice(-MAX_CAPTURED_OUTPUT) : next;
}

function runLibreOffice(options: RunLibreOfficeOptions): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const args = [
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      `-env:UserInstallation=${pathToFileURL(options.profileDir).href}`,
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      options.outputDir,
      options.inputPath,
    ];

    const child = spawn(options.binary, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: options.profileDir,
        ...(process.platform === "win32" ? {} : { SAL_USE_VCLPLUGIN: "svp" }),
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);

    const onAbort = () => terminate();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const terminate = () => {
      if (!child.pid) return;
      if (process.platform === "win32") {
        // soffice.exe lanza soffice.bin; hay que matar el árbol completo.
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.on("error", () => child.kill());
      } else {
        child.kill("SIGKILL");
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        finish(
          new LibreOfficeUnavailableError(
            `No se pudo ejecutar LibreOffice (${options.binary}). Revisa LIBREOFFICE_BIN o instala LibreOffice.`,
            { cause: error },
          ),
        );
        return;
      }
      finish(new LibreOfficeConversionError(`No se pudo iniciar LibreOffice: ${error.message}`, { cause: error }));
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish(
          new LibreOfficeConversionError(
            `LibreOffice excedió el tiempo límite de ${options.timeoutMs} ms`,
          ),
        );
        return;
      }
      if (options.signal?.aborted) {
        finish(abortError());
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const detail =
        stderr.trim() ||
        stdout.trim() ||
        `código ${code}${signal ? `, señal ${signal}` : ""}`;
      finish(new LibreOfficeConversionError(`LibreOffice falló al convertir el DOCX: ${detail}`));
    });
  });
}

// ─── API pública ────────────────────────────────────────────────────────────

/**
 * Convierte un buffer DOCX en PDF usando LibreOffice headless.
 *
 * Lanza `LibreOfficeUnavailableError` si el motor está deshabilitado o el
 * binario no existe; `LibreOfficeConversionError` si el proceso falla.
 */
export async function convertDocxToPdf(
  docx: Buffer,
  options: ConvertDocxToPdfOptions = {},
): Promise<Buffer> {
  if (!isLibreOfficeEnabled()) {
    throw new LibreOfficeUnavailableError(
      "La conversión con LibreOffice está deshabilitada (DOC_PDF_ENGINE=pdf-lib).",
    );
  }

  if (isLibreOfficeCircuitOpen()) {
    throw new LibreOfficeUnavailableError(
      "LibreOffice está temporalmente deshabilitado tras un fallo reciente. Se usará el generador de respaldo.",
    );
  }

  const binary = resolveLibreOfficeBinary();
  if (!binary) {
    throw new LibreOfficeUnavailableError(
      "No se encontró LibreOffice. Instálalo o define LIBREOFFICE_BIN (Windows: C:\\Program Files\\LibreOffice\\program\\soffice.exe).",
    );
  }

  if (docx.length === 0) {
    throw new LibreOfficeConversionError("El DOCX de entrada está vacío.");
  }

  const release = await acquireSlot(options.signal);
  let tempDir: string | null = null;

  try {
    if (options.signal?.aborted) throw abortError();

    tempDir = await mkdtemp(path.join(os.tmpdir(), "docgen-"));
    const inputPath = path.join(tempDir, "input.docx");
    const outputPath = path.join(tempDir, "input.pdf");
    const profileDir = path.join(tempDir, "lo-profile");

    await mkdir(profileDir, { recursive: true });
    await writeFile(inputPath, docx);

    await runLibreOffice({
      binary,
      inputPath,
      outputDir: tempDir,
      profileDir,
      timeoutMs: options.timeoutMs ?? conversionTimeoutMs(),
      signal: options.signal,
    });

    if (!existsSync(outputPath)) {
      throw new LibreOfficeConversionError(
        "LibreOffice terminó sin generar el PDF. Revisa los logs de conversión.",
      );
    }

    const pdf = await readFile(outputPath);
    resetLibreOfficeCircuit();
    return pdf;
  } catch (error) {
    if (!isAbortError(error) && !options.signal?.aborted) {
      openLibreOfficeCircuit(errorMessage(error));
    }
    throw error;
  } finally {
    release();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(
        () => undefined,
      );
    }
  }
}
