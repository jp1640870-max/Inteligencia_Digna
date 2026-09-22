import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { colLettersToIndex, colIndexToLetters } from "../lib/editors/excel-editor.js";

describe("colLettersToIndex", () => {
  it("columnas de una letra", () => {
    assert.equal(colLettersToIndex("A"), 1);
    assert.equal(colLettersToIndex("C"), 3);
    assert.equal(colLettersToIndex("Z"), 26);
  });

  it("columnas más allá de Z (bug original: charCodeAt(0))", () => {
    assert.equal(colLettersToIndex("AA"), 27);
    assert.equal(colLettersToIndex("AZ"), 52);
    assert.equal(colLettersToIndex("BA"), 53);
    assert.equal(colLettersToIndex("ZZ"), 702);
    assert.equal(colLettersToIndex("AAA"), 703);
  });

  it("insensible a mayúsculas", () => {
    assert.equal(colLettersToIndex("aa"), 27);
    assert.equal(colLettersToIndex("az"), 52);
  });
});

describe("colIndexToLetters", () => {
  it("invierte índices conocidos", () => {
    assert.equal(colIndexToLetters(1), "A");
    assert.equal(colIndexToLetters(26), "Z");
    assert.equal(colIndexToLetters(27), "AA");
    assert.equal(colIndexToLetters(52), "AZ");
    assert.equal(colIndexToLetters(702), "ZZ");
    assert.equal(colIndexToLetters(703), "AAA");
  });

  it("round-trip 1..2000", () => {
    for (let i = 1; i <= 2000; i++) {
      assert.equal(colLettersToIndex(colIndexToLetters(i)), i);
    }
  });
});
