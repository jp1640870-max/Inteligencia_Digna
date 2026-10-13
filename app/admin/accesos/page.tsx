"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Users,
  Shield,
  ShieldOff,
  FileText,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import type { Area, KbAccessGrant, UserGroup } from "@/types";

/**
 * Panel de accesos a la Knowledge Base.
 *
 * Es la pantalla donde el perímetro delega lectura, así que conviene hacer
 * explícita una cosa que el resto del panel da por hecha: `admin` puede
 * otorgarse acceso a cualquier documento. No es un fallo del diseño, es la
 * consecuencia de que `admin` y `super_admin` compartan perímetro.
 *
 * El control es detective: cada cambio queda en `audit_log` y un `super_admin`
 * revisa mensualmente esta lista. Por eso cada fila muestra quién lo aprobó
 * grant y cuándo, no solo que existe.
 *
 * Ojo: ocultar este enlace no sería el control. Cada API revalida el rol; esto
 * solo evita mostrar una sección que devolvería 403.
 */

type Member = { id: string; email: string; name: string | null; role: string };
type Principal = { type: "area" | "group"; id: string; name: string };
type KbFileLite = {
  id: string;
  filename: string;
  status: string;
  category_label: string | null;
  chunk_count?: number;
  grant_count?: number;
};

const PANEL =
  "bg-[#0d131d] border border-[#202938] rounded-lg";

export default function AdminAccesos() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [files, setFiles] = useState<KbFileLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedArea, setSelectedArea] = useState<string>("");
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const [newArea, setNewArea] = useState({ name: "", description: "" });
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });

  const [members, setMembers] = useState<Member[]>([]);
  const [grants, setGrants] = useState<KbAccessGrant[]>([]);

  // Los cargadores encadenan `.then()` en vez de ser `async`: un `async` hace
  // `setLoading(true)` de forma síncrona al entrar, y eso dispara un render en
  // cascada dentro del efecto (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    setError(null);
    return Promise.all([
      fetch("/api/admin/areas").then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch("/api/admin/groups").then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
      fetch("/api/admin/knowledge/files").then((r) => r.json().then((d) => ({ ok: r.ok, d }))),
    ])
      .then(([areasRes, groupsRes, filesRes]) => {
        if (!areasRes.ok) throw new Error(areasRes.d.error ?? "No se pudieron cargar las áreas");
        if (!groupsRes.ok) throw new Error(groupsRes.d.error ?? "No se pudieron cargar los grupos");
        if (!filesRes.ok) throw new Error(filesRes.d.error ?? "No se pudieron cargar los archivos");
        setAreas(areasRes.d.areas ?? []);
        setGroups(groupsRes.d.groups ?? []);
        // El listado ya no trae `content`: solo metadatos. Menos peso y sin
        // exponer el texto completo a cualquier vista de la lista.
        setFiles(filesRes.d.files ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Fetch diferido a una macrotarea, igual que en app/admin/usuarios: evita el
  // setState síncrono dentro del efecto (react-hooks/set-state-in-effect) sin
  // cambiar el comportamiento.
  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const loadDetail = useCallback(() => {
    if (!selectedArea && !selectedGroup) {
      setMembers([]);
      setGrants([]);
      return Promise.resolve();
    }
    const base = selectedArea
      ? `/api/admin/areas/${selectedArea}`
      : `/api/admin/groups/${selectedGroup}`;
    const type = selectedArea ? "area" : "group";
    const id = selectedArea || selectedGroup;
    return Promise.all([
      fetch(`${base}/members`).then((r) => r.json()),
      fetch(`/api/admin/access/grants?principalId=${id}&principalType=${type}`).then((r) => r.json()),
    ])
      .then(([detail, grantsData]) => {
        setMembers(detail.members ?? []);
        setGrants(grantsData.grants ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [selectedArea, selectedGroup]);

  useEffect(() => {
    const id = setTimeout(() => void loadDetail(), 0);
    return () => clearTimeout(id);
  }, [loadDetail]);

  const principal: Principal | null = selectedArea
    ? { type: "area", id: selectedArea, name: areas.find((a) => a.id === selectedArea)?.name ?? "" }
    : selectedGroup
      ? { type: "group", id: selectedGroup, name: groups.find((g) => g.id === selectedGroup)?.name ?? "" }
      : null;

  const run = async (fn: () => Promise<Response>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "La operación falló");
      await load();
      await loadDetail();
      setError(null);
      return successMessage;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createArea = () =>
    run(
      () =>
        fetch("/api/admin/areas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newArea),
        }),
      "Área creada",
    ).then((message) => {
      if (message) setNewArea({ name: "", description: "" });
    });

  const createGroup = () =>
    run(
      () =>
        fetch("/api/admin/groups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newGroup),
        }),
      "Grupo creado",
    ).then((message) => {
      if (message) setNewGroup({ name: "", description: "" });
    });

  const toggleFile = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyGrants = (action: "grant" | "revoke") => {
    if (!principal) return;
    const fileIds = [...selectedFiles];
    if (fileIds.length === 0) {
      setError("Selecciona al menos un archivo.");
      return;
    }
    void run(
      () =>
        fetch("/api/admin/access/grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            principalType: principal.type,
            principalId: principal.id,
            fileIds,
          }),
        }),
      action === "grant" ? "Acceso concedido" : "Acceso revocado",
    ).then(() => setSelectedFiles(new Set()));
  };

  const toggleMember = async (userId: string, isMember: boolean) => {
    if (!principal) return;
    setBusy(true);
    setError(null);
    try {
      const base = principal.type === "area" ? `/api/admin/areas/${principal.id}` : `/api/admin/groups/${principal.id}`;
      const res = isMember
        ? await fetch(`${base}/members?userId=${encodeURIComponent(userId)}`, { method: "DELETE" })
        : await fetch(`${base}/members`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudo modificar la pertenencia");
      await loadDetail();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = (kind: "area" | "group", id: string) =>
    run(
      () => fetch(`/api/admin/${kind === "area" ? "areas" : "groups"}/${id}`, { method: "DELETE" }),
      `${kind === "area" ? "Área" : "Grupo"} desactivado`,
    );

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-gray-400">
        <Loader2 size={18} className="animate-spin" /> Cargando accesos...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Accesos a la Knowledge Base</h1>
        <p className="text-sm text-gray-400 mt-1">
          Quién puede leer cada documento. Sin un grant explícito, nadie lo lee.
        </p>
      </div>

      {error && (
        <div className={`${PANEL} p-3 text-sm text-red-300 border-red-500/30 bg-red-500/5`}>
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ─── Áreas ─── */}
        <section className={`${PANEL} p-4`}>
          <h2 className="flex items-center gap-2 font-semibold text-white mb-3">
            <Building2 size={16} className="text-green-400" /> Áreas
          </h2>
          <ul className="space-y-1 mb-4">
            {areas.map((area) => (
              <li key={area.id} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedArea(area.id);
                    setSelectedGroup("");
                  }}
                  className={`flex-1 text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedArea === area.id
                      ? "bg-green-600/20 text-green-300 border border-green-500/30"
                      : "text-gray-300 hover:bg-[#1e293b]"
                  }`}
                >
                  <span className="font-medium">{area.name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {area.member_count ?? 0} miembros · {area.grant_count ?? 0} documentos
                  </span>
                </button>
                <button
                  onClick={() => void deactivate("area", area.id)}
                  disabled={busy}
                  title="Desactivar (deja de conceder acceso, conserva el histórico)"
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {areas.length === 0 && <li className="text-sm text-gray-500">Sin áreas.</li>}
          </ul>

          <div className="flex gap-2">
            <input
              value={newArea.name}
              onChange={(e) => setNewArea({ ...newArea, name: e.target.value })}
              placeholder="Nombre del área"
              className="flex-1 bg-[#0a0f18] border border-[#202938] rounded px-3 py-2 text-sm text-white outline-none focus:border-green-500/50"
            />
            <button
              onClick={createArea}
              disabled={busy || !newArea.name.trim()}
              className="px-3 py-2 rounded bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30 disabled:opacity-40"
            >
              <Plus size={14} />
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-2">
            Desactivar un área corta el acceso al instante y conserva sus grants, de modo que
            reactivarla restaura el acceso previo.
          </p>
        </section>

        {/* ─── Grupos ─── */}
        <section className={`${PANEL} p-4`}>
          <h2 className="flex items-center gap-2 font-semibold text-white mb-3">
            <Users size={16} className="text-purple-400" /> Grupos
          </h2>
          <ul className="space-y-1 mb-4">
            {groups.map((group) => (
              <li key={group.id} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setSelectedGroup(group.id);
                    setSelectedArea("");
                  }}
                  className={`flex-1 text-left px-3 py-2 rounded text-sm transition-colors ${
                    selectedGroup === group.id
                      ? "bg-purple-600/20 text-purple-300 border border-purple-500/30"
                      : "text-gray-300 hover:bg-[#1e293b]"
                  }`}
                >
                  <span className="font-medium">{group.name}</span>
                  <span className="text-xs text-gray-500 ml-2">
                    {group.member_count ?? 0} miembros · {group.grant_count ?? 0} documentos
                  </span>
                </button>
                {!group.is_system && (
                  <button
                    onClick={() => void deactivate("group", group.id)}
                    disabled={busy}
                    title="Desactivar y revocar sus grants"
                    className="text-gray-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
            {groups.length === 0 && (
              <li className="text-sm text-gray-500">
                Sin grupos. Un grupo sirve para compartir un documento entre áreas distintas.
              </li>
            )}
          </ul>

          <div className="flex gap-2">
            <input
              value={newGroup.name}
              onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
              placeholder="Nombre del grupo"
              className="flex-1 bg-[#0a0f18] border border-[#202938] rounded px-3 py-2 text-sm text-white outline-none focus:border-purple-500/50"
            />
            <button
              onClick={createGroup}
              disabled={busy || !newGroup.name.trim()}
              className="px-3 py-2 rounded bg-purple-600/20 text-purple-400 border border-purple-500/30 hover:bg-purple-600/30 disabled:opacity-40"
            >
              <Plus size={14} />
            </button>
          </div>
        </section>
      </div>

      {principal && (
        <>
          {/* ─── Miembros ─── */}
          <section className={`${PANEL} p-4`}>
            <h2 className="flex items-center gap-2 font-semibold text-white mb-1">
              <Users size={16} className="text-green-400" /> Miembros de {principal.name}
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              Estar en {principal.name} da acceso a los documentos que el área tiene concedidos, y
              solo a esos. Un miembro sin ningún grant se queda sin leer la KB.
            </p>
            {members.length === 0 ? (
              <p className="text-sm text-gray-500">Sin miembros.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-[#1e293b] text-sm"
                  >
                    <span className="text-gray-200">{member.email}</span>
                    <span className="text-[10px] text-gray-500">{member.role}</span>
                    <button
                      onClick={() => void toggleMember(member.id, true)}
                      disabled={busy}
                      className="text-gray-500 hover:text-red-400"
                      title="Quitar del grupo"
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ─── Documentos ─── */}
          <section className={`${PANEL} p-4`}>
            <h2 className="flex items-center gap-2 font-semibold text-white mb-1">
              <FileText size={16} className="text-green-400" /> Documentos
            </h2>
            <p className="text-xs text-gray-500 mb-3">
              Solo se pueden conceder sobre archivos activos. Un documento sin grant es invisible
              para todos salvo para el perímetro.
            </p>

            <div className="flex gap-2 mb-3">
              <button
                onClick={() => applyGrants("grant")}
                disabled={busy || selectedFiles.size === 0}
                className="flex items-center gap-2 px-3 py-2 rounded text-sm bg-green-600/20 text-green-400 border border-green-500/30 hover:bg-green-600/30 disabled:opacity-40"
              >
                <Shield size={14} /> Conceder ({selectedFiles.size})
              </button>
              <button
                onClick={() => applyGrants("revoke")}
                disabled={busy || selectedFiles.size === 0}
                className="flex items-center gap-2 px-3 py-2 rounded text-sm bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 disabled:opacity-40"
              >
                <ShieldOff size={14} /> Revocar ({selectedFiles.size})
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1">
              {files.map((file) => {
                const granted = grants.some((g) => g.kb_file_id === file.id);
                return (
                  <label
                    key={file.id}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[#1e293b] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.id)}
                      onChange={() => toggleFile(file.id)}
                      disabled={file.status !== "active"}
                      className="accent-green-500"
                    />
                    <span className="flex-1 text-sm text-gray-200 truncate">{file.filename}</span>
                    {file.category_label && (
                      <span className="text-[10px] text-gray-500">{file.category_label}</span>
                    )}
                    {file.status !== "active" && (
                      <span className="text-[10px] text-amber-400">{file.status}</span>
                    )}
                    {granted ? (
                      <span className="text-[10px] text-green-400">concedido</span>
                    ) : (
                      <span className="text-[10px] text-gray-600">sin acceso</span>
                    )}
                  </label>
                );
              })}
              {files.length === 0 && (
                <p className="text-sm text-gray-500">No hay archivos en la base de conocimiento.</p>
              )}
            </div>
          </section>

          {/* ─── Grants vigentes, para la revisión mensual ─── */}
          <section className={`${PANEL} p-4`}>
            <h2 className="font-semibold text-white mb-1">Accesos vigentes</h2>
            <p className="text-xs text-gray-500 mb-3">
              Esta es la lista que hay que revisar cada mes: si algún grant ya no corresponde a una
              necesidad real, se revoca.
            </p>
            {grants.length === 0 ? (
              <p className="text-sm text-gray-500">
                {principal.name} no tiene ningún documento concedido.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-[#202938]">
                    <th className="pb-2 font-medium">Documento</th>
                    <th className="pb-2 font-medium">Categoría</th>
                    <th className="pb-2 font-medium">Concedido por</th>
                    <th className="pb-2 font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((grant) => (
                    <tr key={grant.id} className="border-b border-[#202938]/50">
                      <td className="py-2 text-gray-200">{grant.filename}</td>
                      <td className="py-2 text-gray-500">{grant.category_label ?? "—"}</td>
                      <td className="py-2 text-gray-500">{grant.granted_by_name ?? "migración"}</td>
                      <td className="py-2 text-gray-500">
                        {new Date(grant.created_at).toLocaleDateString("es-ES")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
