import { randomUUID } from "node:crypto";
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "./env";

let client: S3Client | null = null;

type StorageConfig = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

const PLACEHOLDER_SECRETS = new Set([
  "cambiar-esta-clave-minio",
  "cambiar-esta-clave",
  "change-me",
  "changeme",
  "minioadmin",
]);

function requireAccessKey(value: string | undefined, variable: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`Falta ${variable} en la configuración de storage (S3/MinIO).`);
  }
  return normalized;
}

function requireSecretKey(value: string | undefined, variable: string): string {
  const normalized = requireAccessKey(value, variable);
  if (PLACEHOLDER_SECRETS.has(normalized.toLowerCase())) {
    throw new Error(`${variable} sigue usando un valor de ejemplo. Genera una credencial real.`);
  }
  return normalized;
}

function config(): StorageConfig {
  const endpoint = env.MINIO_ENDPOINT || `http://${env.MINIO_HOST || "127.0.0.1"}:${env.MINIO_PORT || "9000"}`;
  const accessKeyId = env.MINIO_ACCESS_KEY || env.MINIO_ROOT_USER;
  const secretAccessKey = env.MINIO_SECRET_KEY || env.MINIO_ROOT_PASSWORD;
  return {
    endpoint,
    bucket: env.MINIO_BUCKET || "attachments",
    region: env.MINIO_REGION || "us-east-1",
    accessKeyId: requireAccessKey(accessKeyId, "MINIO_ACCESS_KEY (o MINIO_ROOT_USER)"),
    secretAccessKey: requireSecretKey(secretAccessKey, "MINIO_SECRET_KEY (o MINIO_ROOT_PASSWORD)"),
    forcePathStyle: String(env.MINIO_FORCE_PATH_STYLE ?? "true") !== "false",
  };
}

function getClient(): S3Client {
  if (!client) {
    const current = config();
    client = new S3Client({
      endpoint: current.endpoint,
      region: current.region,
      forcePathStyle: current.forcePathStyle,
      credentials: {
        accessKeyId: current.accessKeyId,
        secretAccessKey: current.secretAccessKey,
      },
    });
  }
  return client;
}

export function objectKey(prefix: string, filename: string): string {
  const safeName = filename.normalize("NFC").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `${prefix.replace(/^\/+|\/+$/g, "")}/${randomUUID()}-${safeName}`;
}

export async function putObject(key: string, body: Buffer, contentType: string, metadata: Record<string, string> = {}): Promise<void> {
  const current = config();
  await getClient().send(new PutObjectCommand({
    Bucket: current.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  const current = config();
  const response = await getClient().send(new GetObjectCommand({ Bucket: current.bucket, Key: key }));
  if (!response.Body) throw new Error("El objeto no tiene contenido");
  return Buffer.from(await response.Body.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  const current = config();
  await getClient().send(new DeleteObjectCommand({ Bucket: current.bucket, Key: key }));
}

export async function checkBucket(): Promise<boolean> {
  const current = config();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: current.bucket }));
    return true;
  } catch {
    return false;
  }
}

export async function ensureBucket(): Promise<void> {
  const current = config();
  try {
    await getClient().send(new HeadBucketCommand({ Bucket: current.bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw error;
    await getClient().send(new CreateBucketCommand({ Bucket: current.bucket }));
  }
}

export function getStorageConfig(): StorageConfig {
  return config();
}
