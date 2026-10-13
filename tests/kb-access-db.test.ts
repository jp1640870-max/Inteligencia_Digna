import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Integración del ACL contra Postgres.
 *
 * A diferencia de `kb-access.test.ts`, aquí importa `lib/db.ts`, que abre un
 * pool real. Por eso carga `.env` a mano (el runner de `npm test` solo inyecta
 * `tests/.env.test`) y hace `skip` si no hay base disponible: el archivo forma
 * parte del glob `tests/*.test.ts` y no debe romper un `npm test` sin servicios.
 *
 * Lo que se comprueba es la propiedad que un test unitario no puede: que el ACL
 * se resuelve dentro de la consulta, sin caché, de modo que una revocación o una
 * desactivación surtan efecto en la siguiente petición.
 */

function loadEnvironment(): void {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = resolve(process.cwd(), fileName);
    if (existsSync(filePath)) process.loadEnvFile(filePath);
  }
}

// A nivel de módulo y no dentro de `before`: la opción `skip` se evalúa al
// declarar el suite, así que para entonces DATABASE_URL ya tiene que estar leída.
loadEnvironment();

const hasDatabase = () => Boolean(process.env.DATABASE_URL);

describe("ACL contra Postgres", { skip: hasDatabase() ? false : "sin DATABASE_URL" }, () => {
  let db: typeof import("../lib/db.js");
  let query: typeof import("../lib/db-connection.js").query;
  let areaId = "";
  let userId = "";
  let adminId = "";
  /** Actor distinto del usuario probado: concede, sube y queda en la auditoría. */
  let otherIdForTest = "";
  let fileId = "";
  let areaName = "";

  /**
   * Restaura los grants de un archivo pase lo que pase.
   *
   * Sin esto, un test que falla entremedio deja la instancia sin acceso a un
   * documento, que es el peor estado posible en una prueba de autorización:
   * parece un fallo de aplicación y no del test.
   */
  const withRestoredGrants = async (fn: () => Promise<void>): Promise<void> => {
    const grants = await db.getKbAccessGrants({ fileId });
    const saved = grants.map((g) => ({
      principalType: g.principal_type,
      principalId: g.principal_id,
    }));
    try {
      await fn();
    } finally {
      for (const g of saved) {
        await db.grantKbFileAccess({
          ...g,
          kbFileId: fileId,
          // `granted_by` tiene FK a users: hay que pasar un id de usuario real.
          // Los grants de la migración lo tienen a NULL, y reinsertar con un id
          // inválido revoca el error y deja el archivo sin acceso.
          grantedBy: adminId,
        });
      }
    }
  };

  before(async () => {
    db = await import("../lib/db.js");
    query = (await import("../lib/db-connection.js")).query;

    const area = await query<{ id: string; name: string }>(
      "SELECT id, name FROM areas ORDER BY created_at LIMIT 1",
    );
    const user = await query<{ id: string }>(
      "SELECT u.id FROM users u JOIN area_members m ON m.user_id = u.id WHERE u.role <> 'super_admin' LIMIT 1",
    );
    const admin = await query<{ id: string }>(
      "SELECT id FROM users WHERE role IN ('super_admin','admin') LIMIT 1",
    );
    const file = await query<{ id: string }>(
      "SELECT id FROM kb_files WHERE status = 'active' ORDER BY created_at LIMIT 1",
    );

    areaId = area.rows[0]?.id ?? "";
    areaName = area.rows[0]?.name ?? "";
    userId = user.rows[0]?.id ?? "";
    adminId = admin.rows[0]?.id ?? "";
    otherIdForTest = admin.rows[0]?.id ?? "";
    fileId = file.rows[0]?.id ?? "";
    if (!areaId || !userId || !adminId || !fileId) {
      // Sin datos de prueba no hay nada que afirmar; se falla en lugar de dejar
      // un falso positivo de "todo pasa".
      assert.fail("La base no tiene área, miembro, admin ni archivo activo para probar");
    }
  });

  after(async () => {
    // Devolver el área a activa pase lo que pase: si el test falla a mitad, el
    // estado de la instancia no debe quedar con el acceso cortado.
    if (areaId) await db.updateArea(areaId, { is_active: true });
  });

  it("un miembro del área lee un archivo con grant", async () => {
    const ids = await db.getAccessibleKbFileIds(userId);
    assert.ok(ids.includes(fileId), "el archivo con grant debería estar entre los accesibles");
    assert.equal(await db.canAccessKbFile(userId, fileId), true);
  });

  it("la revocación surte efecto en la siguiente consulta", async () => {
    const initial = await db.getAccessibleKbFileIds(userId);
    assert.ok(initial.includes(fileId));

    await withRestoredGrants(async () => {
      const grants = await db.getKbAccessGrants({ fileId });
      for (const grant of grants) {
        await db.revokeKbFileAccess({
          principalType: grant.principal_type,
          principalId: grant.principal_id,
          kbFileId: fileId,
        });
      }

      assert.equal(await db.canAccessKbFile(userId, fileId), false);
      const after = await db.getAccessibleKbFileIds(userId);
      assert.equal(
        after.includes(fileId),
        false,
        "tras revocar, el archivo no debe seguir entre los accesibles",
      );
    });

    assert.equal(await db.canAccessKbFile(userId, fileId), true);
  });

  it("un archivo sin ningún grant es inaccesible (fail closed)", async () => {
    await withRestoredGrants(async () => {
      const grants = await db.getKbAccessGrants({ fileId });
      for (const g of grants) {
        await db.revokeKbFileAccess({
          principalType: g.principal_type,
          principalId: g.principal_id,
          kbFileId: fileId,
        });
      }

      const orphans = await db.listKbFilesWithoutGrants();
      assert.ok(
        orphans.some((f) => f.id === fileId),
        "un archivo sin grants debe listarse como huérfano",
      );
      assert.equal(await db.canAccessKbFile(userId, fileId), false);
    });
  });

  it("desactivar el área corta el acceso y reactivarlo lo restaura", async () => {
    // Área y archivo propios, en vez de tomar los primeros que aparezcan: la
    // propiedad que se comprueba es "desactivar el área quita el acceso que el
    // área daba", y con datos ajenos no se puede afirmar, porque el usuario puede
    // tener los mismos archivos por un grupo y entonces desactivar el área no
    // cambia nada de su lista. En la instancia de desarrollo, el área y el grupo
    // concedían exactamente los mismos cuatro archivos, y por eso este test
    // fallaba al pedirle que el acceso quedara en cero.
    const key = `test-area-${Date.now()}`;
    const area = await db.createArea({ key, name: key });
    const fileId = crypto.randomUUID();

    try {
      await db.insertKbFile({
        id: fileId,
        filename: `${key}.txt`,
        format: "txt",
        status: "active",
        content: "contenido",
        checksum: null,
        uploaded_by: otherIdForTest,
      });
      await db.grantKbFileAccess({
        principalType: "area",
        principalId: area.id,
        kbFileId: fileId,
        grantedBy: otherIdForTest,
      });
      await db.addAreaMember(area.id, userId, otherIdForTest);

      assert.equal(await db.canAccessKbFile(userId, fileId), true, "con grant debe leer");
      assert.ok(
        (await db.getAccessibleKbFileIds(userId)).includes(fileId),
        "el archivo debe estar entre los accesibles",
      );

      await db.deactivateArea(area.id);
      assert.equal(
        await db.canAccessKbFile(userId, fileId),
        false,
        "un área desactivada no debe conceder acceso",
      );
      assert.equal(
        (await db.getAccessibleKbFileIds(userId)).includes(fileId),
        false,
      );

      await db.updateArea(area.id, { is_active: true });
      assert.equal(
        await db.canAccessKbFile(userId, fileId),
        true,
        "reactivar el área debe devolver el acceso exactamente como estaba",
      );
    } finally {
      await query("DELETE FROM kb_access_grants WHERE principal_type = 'area' AND principal_id = $1", [area.id]);
      await db.deleteKbFileById(fileId);
      await query("DELETE FROM areas WHERE id = $1", [area.id]);
      if (areaId) await db.updateArea(areaId, { is_active: true });
    }
  });

  it("un archivo pending_review no es buscable aunque tenga grant", async () => {
    const original = (await db.getKbFileById(fileId))?.status;
    if (!original) return;

    await db.updateKbFile(fileId, { status: "pending_review" });
    assert.equal(
      await db.canAccessKbFile(userId, fileId),
      false,
      "pending_review no debe resolver como legible",
    );
    const visible = await db.listKbFilesVisibleTo(userId);
    assert.equal(
      visible.some((f) => f.id === fileId),
      false,
    );

    await db.updateKbFile(fileId, { status: original });
    assert.equal(await db.canAccessKbFile(userId, fileId), true);
  });

  it("no deja degradar ni borrar al último super_admin", async () => {
    const last = await query<{
      id: string;
      email: string;
      name: string | null;
      password_hash: string | null;
      google_id: string | null;
      picture: string | null;
    }>(
      `SELECT id, email, name, password_hash, google_id, picture
         FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1`,
    );
    const snapshot = last.rows[0];
    if (!snapshot) {
      assert.fail("la instancia necesita al menos un super_admin para probar el guard");
    }
    const superId = snapshot.id;

    // Si el guard se rompe, estas llamadas degradan o borran al usuario de verdad
    // y el test deja la instancia sin sucesión. El `finally` restaura con SQL
    // directo (no pasa por updateUserRole, que es justo lo que se prueba) y
    // reinserta la fila si llegó a borrarse: un `UPDATE` sobre una fila que ya
    // no existe no revierte nada y dejaría la instancia sin ningún superadmin.
    try {
      await assert.rejects(
        () => db.updateUserRole(superId, "admin"),
        /super_admin/i,
        "degradar al único super_admin debe fallar",
      );
      await assert.rejects(
        () => db.deleteUserById(superId),
        /super_admin/i,
        "borrar el único super_admin debe fallar",
      );

      const still = await query<{ role: string }>("SELECT role FROM users WHERE id = $1", [superId]);
      assert.equal(still.rows[0]?.role, "super_admin", "el rol no debe haber cambiado");
    } finally {
      await query("UPDATE users SET role = 'super_admin' WHERE id = $1", [superId]);
      await query(
        `INSERT INTO users (id, email, name, password_hash, google_id, picture, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'super_admin')
         ON CONFLICT (id) DO UPDATE SET role = 'super_admin'`,
        [
          snapshot.id,
          snapshot.email,
          snapshot.name,
          snapshot.password_hash,
          snapshot.google_id,
          snapshot.picture,
        ],
      );
    }
  });

  it("la migración sembró el área General con los usuarios existentes", async () => {
    const areas = await db.getAreas();
    const general = areas.find((a) => a.name === areaName);
    assert.ok(general, "el área sembrada debe existir y estar activa");
    assert.ok((general.member_count ?? 0) > 0, "el área debe tener miembros");
  });
});

/**
 * El alcance de lectura del panel, resuelto contra Postgres.
 *
 * Es la diferencia entre lo que un `editor` puede ver en `/admin/knowledge` y lo
 * que puede leer en el chat, y hasta ahora no había nada que la comprobara: los
 * endpoints de contenido admitían `editor` sin mirar el ACL.
 *
 * Los fixtures se crean y se borran dentro de cada test, sin tocar los datos de
 * la instancia más que en el `finally`.
 */
describe("Alcance del panel frente al chat", () => {
  let db: typeof import("../lib/db.js");
  let query: typeof import("../lib/db-connection.js").query;
  let userId = "";
  let otherId = "";

  const TEMP = (suffix: string) => `test-rbac-${suffix}-${Date.now()}`;
  const created: string[] = [];

  const cleanup = async () => {
    for (const id of created.splice(0)) {
      await query("DELETE FROM kb_files WHERE id = $1", [id]);
    }
  };

  const createFile = async (suffix: string, status: string, uploadedBy: string): Promise<string> => {
    // `kb_files.id` es UUID; el sufijo legible va solo en el nombre, que es lo
    // que sirve para reconocer una fila Left Behind si un test se corta a mitad.
    const id = crypto.randomUUID();
    created.push(id);
    await db.insertKbFile({
      id,
      filename: `${TEMP(suffix)}.txt`,
      format: "txt",
      status,
      content: "contenido de prueba para el alcance de lectura",
      checksum: null,
      uploaded_by: uploadedBy,
    });
    return id;
  };

  before(async () => {
    db = await import("../lib/db.js");
    query = (await import("../lib/db-connection.js")).query;

    const user = await query<{ id: string }>(
      "SELECT u.id FROM users u JOIN area_members m ON m.user_id = u.id WHERE u.role <> 'super_admin' ORDER BY u.created_at LIMIT 1",
    );
    // El "otro" tiene que ser alguien distinto: si el miembro elegido resulta ser
    // admin, usar "el primer admin" como segundo actor haría que el autor y el
    // uploader fueran la misma persona y la prueba no probaría nada.
    const other = await query<{ id: string }>(
      `SELECT id FROM users
        WHERE id <> $1
        ORDER BY (role IN ('super_admin', 'admin')) DESC, created_at
        LIMIT 1`,
      [user.rows[0]?.id ?? ""],
    );
    userId = user.rows[0]?.id ?? "";
    otherId = other.rows[0]?.id ?? "";
    if (!userId || !otherId) {
      assert.fail("hace falta al menos un miembro de área y otro usuario para probar el alcance");
    }
  });

  after(async () => {
    await cleanup();
  });

  it("el panel NO muestra un archivo ajeno sin grant, aunque esté activo", async () => {
    const id = await createFile("ajeno", "active", otherId);
    try {
      assert.equal(await db.canAccessKbFile(userId, id), false, "sin grant no es legible");
      const panel = await db.listKbFilesVisibleToPanel(userId);
      assert.equal(
        panel.some((f) => f.id === id),
        false,
        "un archivo ajeno sin grant no debe aparecer en el panel del editor",
      );
      assert.equal(
        await db.canAccessKbFileFromPanel(userId, id),
        false,
        "y el predicado de contenido debe negarlo igual",
      );
    } finally {
      await cleanup();
    }
  });

  it("el panel SÍ muestra la propia subida aunque siga pending_review", async () => {
    const id = await createFile("propia", "pending_review", userId);
    try {
      const panel = await db.listKbFilesVisibleToPanel(userId);
      assert.ok(
        panel.some((f) => f.id === id),
        "el editor debe poder ver lo que acaba de subir para comprobar la extracción",
      );
      assert.equal(await db.canAccessKbFileFromPanel(userId, id), true);

      // Y el chat no: esa es la diferencia que importa.
      const chat = await db.listKbFilesVisibleTo(userId);
      assert.equal(
        chat.some((f) => f.id === id),
        false,
        "un pending_review no puede ser legible desde el chat aunque sea propio",
      );
      assert.equal(await db.canAccessKbFile(userId, id), false);
    } finally {
      await cleanup();
    }
  });

  it("la búsqueda del panel no encuentra texto de archivos ajenos sin grant", async () => {
    const id = await createFile("busqueda", "active", otherId);
    try {
      const panel = await db.listKbFilesVisibleToPanel(userId, {
        search: "contenido de prueba para el alcance",
      });
      assert.equal(
        panel.some((f) => f.id === id),
        false,
        "el buscador no puede confirmar contenido de un documento sin grant",
      );
    } finally {
      await cleanup();
    }
  });

  it("la búsqueda del panel sí encuentra en la propia subida", async () => {
    const id = await createFile("busqueda-propia", "active", userId);
    try {
      const panel = await db.listKbFilesVisibleToPanel(userId, {
        search: "contenido de prueba para el alcance",
      });
      assert.ok(
        panel.some((f) => f.id === id),
        "sobre lo propio, el buscador sí debe responder",
      );
    } finally {
      await cleanup();
    }
  });
});

/**
 * Desactivar un grupo revoca sus grants, y eso no depende de la ruta.
 */
describe("Desactivación de grupos", () => {
  let db: typeof import("../lib/db.js");
  let query: typeof import("../lib/db-connection.js").query;
  let userId = "";
  let otherId = "";
  let areaId = "";

  before(async () => {
    db = await import("../lib/db.js");
    query = (await import("../lib/db-connection.js")).query;

    const user = await query<{ id: string }>(
      "SELECT u.id FROM users u JOIN area_members m ON m.user_id = u.id WHERE u.role <> 'super_admin' ORDER BY u.created_at LIMIT 1",
    );
    const other = await query<{ id: string }>(
      `SELECT id FROM users
        WHERE id <> $1
        ORDER BY (role IN ('super_admin', 'admin')) DESC, created_at
        LIMIT 1`,
      [user.rows[0]?.id ?? ""],
    );
    const area = await query<{ id: string }>("SELECT id FROM areas ORDER BY created_at LIMIT 1");
    userId = user.rows[0]?.id ?? "";
    otherId = other.rows[0]?.id ?? "";
    areaId = area.rows[0]?.id ?? "";
    if (!userId || !otherId || !areaId) {
      assert.fail("hace falta un miembro, otro usuario y un área para probar la revocación de grupos");
    }
  });

  /** Crea grupo + archivo + grant, y devuelve los ids para poder limpiar. */
  const withGroupAndGrant = async (
    fn: (ids: { groupId: string; fileId: string }) => Promise<void>,
  ): Promise<void> => {
    const key = `test-grupo-${Date.now()}`;
    const group = await db.createUserGroup({ key, name: key });
    const fileId = crypto.randomUUID();
    try {
      await db.insertKbFile({
        id: fileId,
        filename: `${key}.txt`,
        format: "txt",
        status: "active",
        content: "contenido",
        checksum: null,
        uploaded_by: otherId,
      });
      await db.grantKbFileAccess({
        principalType: "group",
        principalId: group.id,
        kbFileId: fileId,
        grantedBy: otherId,
      });
      await fn({ groupId: group.id, fileId });
    } finally {
      await db.deleteKbFileById(fileId);
      await query("DELETE FROM user_groups WHERE id = $1", [group.id]);
    }
  };

  it("desactivar el grupo deja la fila y borra sus grants", async () => {
    await withGroupAndGrant(async ({ groupId, fileId }) => {
      await db.addGroupMember(groupId, userId, otherId);
      assert.equal(await db.canAccessKbFile(userId, fileId), true, "con grant y miembro debe leer");

      assert.equal(await db.deactivateUserGroup(groupId), true);

      const after = await db.getKbAccessGrants({ principalType: "group", principalId: groupId });
      assert.equal(after.length, 0, "desactivar un grupo revoca sus grants, no los deja de resolver");
      assert.equal(await db.canAccessKbFile(userId, fileId), false);

      const group = await db.getUserGroupById(groupId);
      assert.equal(group?.is_active, false, "la fila se conserva para el rastro de auditoría");
    });
  });

  it("una edición no puede desactivar el grupo: is_active no es campo editable", async () => {
    // Esta es la invariante estructural. Con `is_active` entre los campos que
    // acepta `updateUserGroup`, un PATCH desactivaba el grupo sin revocar sus
    // grants, y desactivar dejaba de significar "revoca" según por dónde pasara
    // el operador.
    await withGroupAndGrant(async ({ groupId }) => {
      const changed = await db.updateUserGroup(groupId, {
        name: "renombrado",
        is_active: false,
      });
      assert.equal(changed, true, "el nombre sí se actualiza");

      const group = await db.getUserGroupById(groupId);
      assert.equal(group?.name, "renombrado");
      assert.equal(
        group?.is_active,
        true,
        "is_active no debe cambiar por una edición: solo deactivateUserGroup lo baja",
      );
    });
  });

  it("una edición que solo trae is_active no toca nada", async () => {
    await withGroupAndGrant(async ({ groupId }) => {
      const changed = await db.updateUserGroup(groupId, { is_active: false });
      assert.equal(changed, false, "sin campos editables no hay nada que hacer");
      const group = await db.getUserGroupById(groupId);
      assert.equal(group?.is_active, true);
    });
  });
});
