import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  ALL_CAPABILITIES,
  can,
  canAccessAdminPanel,
  capabilitiesFor,
  rolesWith,
} from "../lib/permissions.js";
import type { Capability } from "../lib/permissions.js";
import { canAssignRole } from "../lib/auth.js";
import { ADMIN_ROLES, assignableRolesFor } from "../types/index.js";
import type { UserRole } from "../types/index.js";

/**
 * La matriz de capacidades es la política de autorización del panel.
 *
 * Este archivo la fija por escrito. Si mañana se añade una capability y nadie
 * decide quién la tiene, falla aquí; si se le da a un rol por descuido, también.
 * Ese es el motivo de que la tabla esté en un módulo y no en cada ruta: una
 * copia por ruta sobrevive a muchas más revisiones que una copia por test.
 */

/** Lo que este archivo afirma que es la política. Si cambia, cambia aquí. */
const ESPERADO: Record<UserRole, Capability[]> = {
  super_admin: [...ALL_CAPABILITIES],
  admin: ALL_CAPABILITIES.filter(
    (capability) => capability !== "config.destroy" && capability !== "impersonate",
  ),
  editor: [
    "admin.access",
    "kb.read",
    "kb.upload",
    "kb.manage",
    "org.read",
    "users.read",
    "users.write",
    "panel.read",
    "config.read",
    "announcements.read",
  ],
  user: [],
};

describe("matriz de capacidades", () => {
  for (const role of Object.keys(ESPERADO) as UserRole[]) {
    it(`los roles de ${role} son los esperados`, () => {
      assert.deepEqual([...capabilitiesFor(role)].sort(), [...ESPERADO[role]].sort());
    });

    it(`capabilitiesFor deniega lo que no sea un rol para ${role}`, () => {
      // El filtro de la UI no debe recibir capacidades inventadas por un rol
      // que ya no existe, como `viewer` antes de la migración 003.
      assert.deepEqual(capabilitiesFor("viewer"), []);
      assert.deepEqual(capabilitiesFor(undefined), []);
      assert.deepEqual(capabilitiesFor(null), []);
    });
  }

  it("no hay capabilities duplicadas en ALL_CAPABILITIES", () => {
    assert.deepEqual(
      ALL_CAPABILITIES.length,
      new Set(ALL_CAPABILITIES).size,
      "una capability repetida haría que una fila de la matriz la ocultara",
    );
  });

  it("toda capability de la matriz se puede consultar para todos los roles", () => {
    for (const capability of ALL_CAPABILITIES) {
      for (const role of ["super_admin", "admin", "editor", "user", "viewer"] as UserRole[]) {
        assert.equal(
          typeof can(role, capability),
          "boolean",
          `can(${role}, ${capability}) debe devolver booleano`,
        );
      }
    }
  });

  it("capabilitiesFor y can no se contradicen", () => {
    for (const capability of ALL_CAPABILITIES) {
      for (const role of ["super_admin", "admin", "editor", "user"] as UserRole[]) {
        assert.equal(
          can(role, capability),
          capabilitiesFor(role).includes(capability),
          `${role}/${capability}`,
        );
      }
    }
  });

  it("rolesWith es la inversa de la matriz", () => {
    for (const capability of ALL_CAPABILITIES) {
      const esperados = (Object.keys(ESPERADO) as UserRole[]).filter((role) =>
        ESPERADO[role].includes(capability),
      );
      assert.deepEqual([...rolesWith(capability)].sort(), esperados.sort(), capability);
    }
  });

  it("super_admin tiene todas las capabilities y user ninguna", () => {
    assert.equal(capabilitiesFor("super_admin").length, ALL_CAPABILITIES.length);
    assert.equal(capabilitiesFor("user").length, 0);
  });
});

describe("capacidades reservadas al perímetro", () => {
  /** Del perímetro (admin y super_admin), pero no del resto. */
  const SOLO_PERIMETRO: Capability[] = [
    "kb.read.all",
    "kb.publish",
    "kb.delete",
    "kb.grants",
    "org.read.detail",
    "org.manage",
    "users.delete",
    "audit.read",
    "sessions.read",
    "backups.manage",
    "hearts.manage",
    "chats.read_content",
    "announcements.write",
  ];

  for (const capability of SOLO_PERIMETRO) {
    it(`${capability} es de admin y super_admin, y de nadie más`, () => {
      assert.equal(can("admin", capability), true, "admin debería poder");
      assert.equal(can("super_admin", capability), true, "super_admin debería poder");
      assert.equal(can("editor", capability), false, "editor no debería poder");
      assert.equal(can("user", capability), false, "user no debería poder");
    });
  }

  it("impersonate y config.destroy son solo de super_admin", () => {
    // La diferencia entre super_admin y admin es vertical y se reduce a esto:
    // administrar a los otros administradores y borrar la configuración.
    for (const capability of ["impersonate", "config.destroy"] as Capability[]) {
      assert.equal(can("admin", capability), false, "admin no debería poder");
      assert.equal(can("super_admin", capability), true);
      assert.equal(can("editor", capability), false);
      assert.equal(can("user", capability), false);
    }
  });

  it("el perímetro no se distingue por capabilities de lectura del panel", () => {
    // `admin` y `super_admin` hacen lo mismo salvo en lo de arriba: el bypass
    // de la KB y la gestión de usuarios son de los dos.
    for (const capability of ["kb.read.all", "users.write", "users.delete", "org.manage"] as Capability[]) {
      assert.equal(can("admin", capability), true, capability);
      assert.equal(can("super_admin", capability), true, capability);
    }
  });
});

describe("canAccessAdminPanel", () => {
  it("deja entrar a los tres roles del panel y a nadie más", () => {
    assert.deepEqual(
      ADMIN_ROLES.filter((role) => canAccessAdminPanel(role)).sort(),
      ["admin", "editor", "super_admin"],
    );
    assert.equal(canAccessAdminPanel("user"), false);
    assert.equal(canAccessAdminPanel("viewer"), false);
    assert.equal(canAccessAdminPanel(undefined), false);
  });

  it("equivale a admin.access", () => {
    for (const role of ["super_admin", "admin", "editor", "user"] as UserRole[]) {
      assert.equal(canAccessAdminPanel(role), can(role, "admin.access"), role);
    }
  });
});

describe("coherencia con la asignación de roles", () => {
  it("la tabla de roles asignables y canAssignRole no se contradicen", () => {
    for (const actor of ["super_admin", "admin", "editor", "user"] as UserRole[]) {
      const puedeAsignar = canAssignRole(actor, "super_admin");
      const listed = assignableRolesFor(actor).includes("super_admin");
      assert.equal(puedeAsignar, listed, actor);
    }
  });
});

/**
 * Guard de regresión sobre las rutas.
 *
 * El bypass del `editor` llegó por una ruta que declaraba sus propios roles, y
 * nadie lo notó porque esa declaración era tan legítima como las otras
 * cuarenta. Este test falla en cuanto vuelve a aparecer una lista literal de
 * roles en una ruta del panel, que es la forma que tenía de colarse.
 */
describe("las rutas del panel piden capacidades, no roles literales", () => {
  const adminApiDir = resolve(process.cwd(), "app/api/admin");

  it("ninguna ruta declara requireRole con roles literales", async () => {
    const offenders: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = await readFile(full, "utf8");
        // Se ignoran los imports: lo que importa es la llamada.
        const calls = source.match(/requireRole\(\s*\[/g) ?? [];
        if (calls.length > 0) offenders.push(`${full} (${calls.length})`);
      }
    }

    await walk(adminApiDir);
    assert.deepEqual(
      offenders,
      [],
      "usa requireCapability: las listas de roles por ruta ya no son la política",
    );
  });

  it("ninguna ruta compara el rol contra literales para autorizar", async () => {
    const offenders: string[] = [];
    // Comparaciones de este tipo son la política escondida en la ruta, que es
    // justo lo que `can()` viene a sustituir.
    const patron = /role\s*(===|!==)\s*"(super_admin|admin|editor|user)"/g;

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = await readFile(full, "utf8");
        if (patron.test(source)) offenders.push(full);
        patron.lastIndex = 0;
      }
    }

    await walk(adminApiDir);
    assert.deepEqual(
      offenders,
      [],
      "autoriza con can(role, capability) en vez de comparar el rol a mano",
    );
  });
});
