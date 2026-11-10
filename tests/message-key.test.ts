import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { messageKey } from "../lib/message-key.js";

describe("messageKey", () => {
  it("no colisiona entre ids de BD e índices locales", () => {
    // Reproduce el bug: 8 mensajes de BD (ids 5..12) + mensajes optimistas
    // en los índices 8..12, que antes usaban `m.id ?? i`.
    const persisted = [5, 6, 7, 8, 9, 10, 11, 12].map((id) => messageKey({ id }, 0));
    const local = [8, 9, 10, 11, 12].map((index) => messageKey({}, index));
    const all = [...persisted, ...local];

    assert.equal(new Set(all).size, all.length);
  });

  it("distingue un id de BD de un localId con el mismo valor", () => {
    assert.notEqual(messageKey({ id: 8 }, 0), messageKey({ localId: "8" }, 8));
  });

  it("prefiere el id persistido sobre el índice", () => {
    assert.equal(messageKey({ id: 21 }, 8), "msg-21");
  });

  it("usa localId cuando existe", () => {
    assert.equal(messageKey({ localId: "abc" }, 99), "local-abc");
  });

  it("cae al índice solo como último recurso", () => {
    assert.equal(messageKey({}, 3), "tmp-3");
  });
});
