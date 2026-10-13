import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPerimeterRole } from "../lib/kb-access.js";
import { can } from "../lib/permissions.js";
import {
  canAssignRole,
  canManageUser,
  canViewUser,
  filterVisibleUsers,
  matchesMembershipFilters,
} from "../lib/auth.js";
import {
  ADMIN_ROLES,
  PERIMETER_ROLES,
  SIN_AREA,
  assignableRolesFor,
} from "../types/index.js";

/**
 * Tests de la lógica de decisión de acceso.
 *
 * Son unitarios a propósito: no tocan la base de datos ni servicios reales
 * (`tests/.env.test` apunta Ollama a un puerto muerto). Lo que se comprueba aquí
 * es la política, que es donde un error se traduce en fuga de datos.
 *
 * La resolución real contra Postgres (que un grant revoca de inmediato, que un
 * área desactivada deja de dar acceso) está en `kb-access-db.test.ts`, marcado
 * como live porque necesita la instancia.
 */
describe("isPerimeterRole", () => {
  it("reconoce admin y super_admin", () => {
    assert.equal(isPerimeterRole("admin"), true);
    assert.equal(isPerimeterRole("super_admin"), true);
  });

  it("no incluye a editor ni user", () => {
    assert.equal(isPerimeterRole("editor"), false);
    assert.equal(isPerimeterRole("user"), false);
  });

  it("rechaza valores inventados y no-cadenas", () => {
    for (const value of [null, undefined, "", "ADMIN", "root", 1, {}, []]) {
      assert.equal(isPerimeterRole(value), false, `debía rechazar ${JSON.stringify(value)}`);
    }
  });
});

/**
 * La política de lectura tiene dos capas y aquí se comprueba la de arriba.
 *
 * Antes estas comprobaciones vivían sobre `canReadKbFile(role, hasGrant)`, un
 * predicado booleano sin base de datos. Ya no existe: el ACL se resuelve en SQL
 * (`lib/db.ts`), y lo que decide el papel es la capability. El alcance real de
 * un `editor` sobre un archivo concreto — granted o subida propia — lo comprueba
 * `kb-access-db.test.ts` contra Postgres.
 */
describe("lectura de la KB por capability", () => {
  it("el perímetro entra a kb.read y también al bypass kb.read.all", () => {
    assert.equal(can("admin", "kb.read"), true);
    assert.equal(can("super_admin", "kb.read"), true);
    assert.equal(can("admin", "kb.read.all"), true);
  });

  it("editor entra a kb.read pero NO al bypass", () => {
    // Es la diferencia que se escapaba por los endpoints de contenido: tener
    // `kb.read` le abría la puerta, pero sin ACL detrás leía la KB entera.
    assert.equal(can("editor", "kb.read"), true);
    assert.equal(can("editor", "kb.read.all"), false);
  });

  it("editor NO reparte acceso", () => {
    assert.equal(can("editor", "kb.grants"), false);
  });

  it("editor NO aprueba", () => {
    assert.equal(can("editor", "kb.publish"), false);
  });

  it("editor sí sube y reclasifica", () => {
    assert.equal(can("editor", "kb.upload"), true);
    assert.equal(can("editor", "kb.manage"), true);
  });

  it("user no entra al panel ni tiene ninguna capacidad", () => {
    assert.equal(can("user", "admin.access"), false);
    assert.equal(can("user", "kb.read"), false);
    assert.equal(can("user", "kb.read.all"), false);
  });

  it("el detalle de área o grupo (con sus grants) es del perímetro", () => {
    // El catálogo no incluye la ACL, así que editor lo ve; el detalle sí.
    assert.equal(can("editor", "org.read"), true);
    assert.equal(can("editor", "org.read.detail"), false);
    assert.equal(can("admin", "org.read.detail"), true);
  });

  it("un rol desconocido no tiene ninguna capacidad", () => {
    assert.equal(can("viewer", "kb.read"), false);
    assert.equal(can("power_user", "kb.read"), false);
    assert.equal(can("restricted", "kb.read"), false);
    assert.equal(can(undefined, "kb.read"), false);
  });
});

describe("conjunto de roles administrativos", () => {
  it("no expone los roles eliminados", () => {
    assert.deepEqual([...ADMIN_ROLES].sort(), ["admin", "editor", "super_admin"]);
  });

  it("no incluye a user en el panel", () => {
    assert.equal(ADMIN_ROLES.includes("user"), false);
  });

  it("PERIMETER_ROLES son admin y super_admin", () => {
    assert.deepEqual([...PERIMETER_ROLES].sort(), ["admin", "super_admin"]);
  });

  it("editor no es parte del perímetro", () => {
    assert.equal(PERIMETER_ROLES.includes("editor"), false);
  });
});

describe("assignableRolesFor", () => {
  it("coincide con canAssignRole para todos los roles", () => {
    const roles = ["super_admin", "admin", "editor", "user", undefined];
    const targets = ["user", "editor", "admin", "super_admin", "viewer", undefined];
    for (const actor of roles) {
      for (const target of targets) {
        const fromTable = assignableRolesFor(actor).includes(target as never);
        const fromPolicy = canAssignRole(actor as string, target);
        assert.equal(
          fromTable,
          fromPolicy,
          `discrepancia para actor=${String(actor)} target=${String(target)}`,
        );
      }
    }
  });

  it("no inventa roles fuera de los cuatro válidos", () => {
    for (const actor of ["super_admin", "admin", "editor", "user"]) {
      for (const role of assignableRolesFor(actor)) {
        assert.ok(
          ["user", "editor", "admin", "super_admin"].includes(role),
          `${actor} no debería asignar ${role}`,
        );
      }
    }
  });
});

describe("canAssignRole", () => {
  it("solo super_admin puede crear super_admin", () => {
    assert.equal(canAssignRole("super_admin", "super_admin"), true);
    assert.equal(canAssignRole("admin", "super_admin"), false);
    assert.equal(canAssignRole("editor", "super_admin"), false);
    assert.equal(canAssignRole("user", "super_admin"), false);
  });

  it("admin no puede otorgar roles que no se auto-otorgaría", () => {
    assert.equal(canAssignRole("admin", "admin"), true);
    assert.equal(canAssignRole("admin", "editor"), true);
    assert.equal(canAssignRole("admin", "user"), true);
    assert.equal(canAssignRole("admin", "super_admin"), false);
  });

  it("editor solo puede promover a user", () => {
    assert.equal(canAssignRole("editor", "user"), true);
    assert.equal(canAssignRole("editor", "editor"), false);
    assert.equal(canAssignRole("editor", "admin"), false);
  });

  it("user no asigna nada", () => {
    for (const role of ["user", "editor", "admin", "super_admin"]) {
      assert.equal(canAssignRole("user", role), false);
    }
  });

  it("rechaza roles que ya no existen", () => {
    // Si estos volvieran a ser válidos, alguien podría reactivar un ACL relying
    // en ellos sin que el conjunto de roles los contemple.
    for (const gone of ["viewer", "power_user", "restricted"]) {
      assert.equal(canAssignRole("super_admin", gone), false, `${gone} no debe ser asignable`);
      assert.equal(canAssignRole("admin", gone), false, `${gone} no debe ser asignable`);
    }
  });
});

describe("canManageUser", () => {
  it("admin no gestiona super_admin", () => {
    assert.equal(canManageUser("admin", "super_admin"), false);
  });

  it("super_admin gestiona a admin", () => {
    assert.equal(canManageUser("super_admin", "admin"), true);
  });

  it("nadie se gestiona a sí mismo con una regla de rango", () => {
    // La protección real del último super_admin es transaccional y vive en
    // lib/db.ts; aquí se comprueba solo la jerarquía de roles.
    assert.equal(canManageUser("admin", "admin"), true);
  });

  it("editor solo gestiona usuarios del rol user", () => {
    assert.equal(canManageUser("editor", "user"), true);
    assert.equal(canManageUser("editor", "editor"), false);
    assert.equal(canManageUser("editor", "admin"), false);
    assert.equal(canManageUser("editor", "super_admin"), false);
  });

  it("user no gestiona a nadie", () => {
    for (const target of ["user", "editor", "admin", "super_admin"]) {
      assert.equal(canManageUser("user", target), false);
    }
  });
});

describe("canViewUser", () => {
  it("un admin no ve al super_admin", () => {
    assert.equal(canViewUser("admin", "super_admin", "a", "b"), false);
  });

  it("un admin sí ve a un admin y a un user", () => {
    assert.equal(canViewUser("admin", "admin", "a", "b"), true);
    assert.equal(canViewUser("admin", "user", "a", "b"), true);
  });

  it("un super_admin ve a cualquiera salvo a otro super_admin", () => {
    assert.equal(canViewUser("super_admin", "user", "a", "b"), true);
    assert.equal(canViewUser("super_admin", "admin", "a", "b"), true);
    // La regla es "super_admin es invisible salvo para sí mismo", así que dos
    // super_admin no se ven entre sí. Consecuencia asumida: ninguno puede
    // gestionar al otro, y la única red de seguridad es el guard transaccional
    // del último super_admin.
    assert.equal(canViewUser("super_admin", "super_admin", "a", "b"), false);
    assert.equal(canViewUser("super_admin", "super_admin", "a", "a"), true);
  });

  it("rechaza roles que ya no existen", () => {
    assert.equal(canViewUser("admin", "viewer", "a", "b"), false);
    assert.equal(canViewUser("viewer", "user", "a", "b"), false);
  });
});

describe("filterVisibleUsers", () => {
  const roster = [
    { id: "u1", role: "super_admin" },
    { id: "u2", role: "admin" },
    { id: "u3", role: "user" },
  ];

  it("oculta a los super_admin a quien no lo es", () => {
    assert.deepEqual(
      filterVisibleUsers(roster, { id: "u2", role: "admin" }).map((u) => u.id),
      ["u2", "u3"],
    );
  });

  it("a un super_admin le oculta a su par, no a los demás", () => {
    // La lista y la vista de detalle usan la misma regla: si la lista lo
    // mostrara y el detalle lo rechazara, la UI daría un 403 inesperado.
    assert.deepEqual(
      filterVisibleUsers(roster, { id: "u1", role: "super_admin" }).map((u) => u.id),
      ["u1", "u2", "u3"],
    );
  });

  it("coincide con canViewUser elemento a elemento", () => {
    for (const caller of roster) {
      const visible = filterVisibleUsers(roster, caller);
      for (const target of roster) {
        const expected = canViewUser(caller.role, target.role, caller.id, target.id);
        assert.equal(
          visible.some((u) => u.id === target.id),
          expected,
          `inconsistencia para ${caller.id} -> ${target.id}`,
        );
      }
    }
  });
});

describe("matchesMembershipFilters", () => {
  const legal = { id: "a", area_ids: ["legal"], group_ids: ["onleave"] };
  const sales = { id: "b", area_ids: ["sales"], group_ids: [] };
  const both = { id: "c", area_ids: ["legal", "sales"], group_ids: ["onleave", "all"] };
  const orphan = { id: "d", area_ids: [], group_ids: [] };
  const roster = [legal, sales, both, orphan];

  const only = (areaId?: string | null, groupId?: string | null) =>
    roster.filter((u) => matchesMembershipFilters(u, { areaId, groupId })).map((u) => u.id);

  it("sin filtros no restringe", () => {
    assert.deepEqual(only(), ["a", "b", "c", "d"]);
    assert.deepEqual(only(null, null), ["a", "b", "c", "d"]);
  });

  it("filtra por área", () => {
    assert.deepEqual(only("legal"), ["a", "c"]);
  });

  it("filtra por grupo, excluyendo a quien no tiene ninguno", () => {
    // `sales` y el huérfano no están en ningún grupo: el filtro es "pertenece a
    // `onleave`", así que quedan fuera. Una lista vacía no es un comodín.
    assert.deepEqual(only(undefined, "onleave"), ["a", "c"]);
  });

  it("combina área y grupo con AND, no con OR", () => {
    assert.deepEqual(only("legal", "onleave"), ["a", "c"]);
    // Y no debe colarse quien cumple solo una de las dos.
    assert.deepEqual(only("sales", "onleave"), ["c"]);
    assert.deepEqual(only("legal", "all"), ["c"]);
  });

  it("el centinela SIN_AREA selecciona a quien no tiene ninguna", () => {
    assert.deepEqual(only(SIN_AREA), ["d"]);
    // Y con grupo activo, AND: solo quien cumple las dos.
    assert.deepEqual(only(SIN_AREA, "onleave"), []);
  });

  it("un id desconocido devuelve vacío, no todo el padrón", () => {
    // Quien filtró por un área borrada buscaba a sus miembros; no hay ninguno.
    // Devolver la lista entera sugeriría que el área existe y que estos son
    // sus miembros.
    assert.deepEqual(only("area-borrada"), []);
    assert.deepEqual(only(undefined, "grupo-borrado"), []);
  });
});
