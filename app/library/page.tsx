import { redirect } from "next/navigation";

/**
 * La biblioteca vive ahora como vista interna del shell (`/?view=library`)
 * para conservar el sidebar y el tema. Esta ruta se mantiene para enlaces
 * antiguos y bookmarks.
 */
export default function LibraryLegacyPage() {
  redirect("/?view=library");
}
