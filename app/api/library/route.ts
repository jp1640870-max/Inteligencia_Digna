export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth";
import { listGeneratedDocuments } from "@/lib/db";
import { toGeneratedDocumentMeta } from "@/lib/generated-document";
import type {
  DocumentLibraryFilters,
  GeneratedDocumentFormat,
  GeneratedDocumentStatus,
} from "@/types";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePageSize(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function parsePage(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function asFormat(value: string | null): GeneratedDocumentFormat | null {
  if (!value) return null;
  switch (value.toLowerCase()) {
    case "pdf":
    case "docx":
    case "xlsx":
      return value.toLowerCase() as GeneratedDocumentFormat;
    default:
      return null;
  }
}

function asStatus(value: string | null): GeneratedDocumentStatus | null {
  if (!value) return null;
  switch (value.toLowerCase()) {
    case "pending":
    case "ready":
    case "failed":
      return value.toLowerCase() as GeneratedDocumentStatus;
    default:
      return null;
  }
}

/**
 * Lista los documentos generados del usuario autenticado.
 *
 * Query params:
 *  - search: filtra por título o nombre de archivo (ILIKE)
 *  - format: pdf | docx | xlsx
 *  - status: pending | ready | failed
 *  - page: número de página (default 1)
 *  - pageSize: elementos por página (default 20, máximo 100)
 */
export async function GET(req: Request) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const filters: DocumentLibraryFilters = {
    search: searchParams.get("search") || undefined,
    format: asFormat(searchParams.get("format")),
    status: asStatus(searchParams.get("status")),
    page: parsePage(searchParams.get("page")),
    pageSize,
  };

  try {
    const { rows, total } = await listGeneratedDocuments({
      userId,
      search: filters.search ?? null,
      format: filters.format ?? null,
      status: filters.status ?? null,
      page: filters.page,
      pageSize: filters.pageSize,
    });

    const items = rows.map((row) => toGeneratedDocumentMeta(row));
    const totalPages = Math.ceil(total / filters.pageSize!);

    return NextResponse.json({
      items,
      total,
      page: filters.page,
      pageSize: filters.pageSize!,
      totalPages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[library] Error listando documentos:", message);
    return NextResponse.json(
      { error: "No se pudieron listar los documentos." },
      { status: 500 },
    );
  }
}
