import { describe, expect, it } from "vitest";
import { extractTableChunks, containsTableChunk, unescapeCellPipes } from "./table-blocks.js";
import { buildRenderBlocks, enrichRenderBlocks, type RenderBlock } from "./render-blocks.js";

function stringifyCell(cell: RenderBlock[]): string {
  return cell.map((x) => (x.type === "math" ? `$${x.latex}$` : x.type === "text" ? x.content : "")).join("");
}

describe("extractTableChunks", () => {
  it("leaves table-free content as a single prose chunk", () => {
    const chunks = extractTableChunks("just some prose with $x=1$ in it");
    expect(chunks).toEqual([{ kind: "prose", text: "just some prose with $x=1$ in it" }]);
    expect(containsTableChunk(chunks)).toBe(false);
  });

  it("splits a table region from surrounding prose without merging either", () => {
    const raw = [
      "before paragraph",
      "",
      "| $x$ | $0$ |",
      "| :---: | :---: |",
      "| $f(x)$ | $1$ |",
      "",
      "after paragraph",
    ].join("\n");

    const chunks = extractTableChunks(raw);
    expect(chunks.map((c) => c.kind)).toEqual(["prose", "table", "prose"]);
    const table = chunks[1];
    if (table.kind !== "table") throw new Error("expected table chunk");
    expect(table.headerCells).toEqual(["$x$", "$0$"]);
    expect(table.alignments).toEqual(["center", "center"]);
    expect(table.rowCells).toEqual([["$f(x)$", "$1$"]]);
  });

  it("unescapes a backslash-escaped pipe cell for display", () => {
    expect(unescapeCellPipes("\\|")).toBe("|");
    expect(unescapeCellPipes("$+$")).toBe("$+$");
  });
});

describe("buildRenderBlocks with tables", () => {
  it("keeps the reported variation-table sample structurally intact: no leaked prose, no corrupted cells", () => {
    const sample = [
      "តារាងអថេរភាពនៃអនុគមន៍ $f$៖",
      "",
      "| $x$ | $0$ | | $e$ | | $+\\infty$ |",
      "| :---: | :---: | :---: | :---: | :---: | :---: |",
      "| $f'(x)$ | \\| | $+$ | $0$ | $-$ | |",
      "| $f(x)$ | \\| | $\\nearrow$ | $1 + \\frac{2}{e}$ | $\\searrow$ | $1$ |",
      "| | $-\\infty$ | | | | |",
      "",
      "---",
      "",
      "៣. កំណត់កូអរដោនេនៃចំណុចប្រសព្វ $A$",
    ].join("\n");

    const blocks = buildRenderBlocks(sample);
    const tableIndex = blocks.findIndex((b) => b.type === "table");
    expect(tableIndex).toBeGreaterThan(-1);
    const table = blocks[tableIndex];
    if (table.type !== "table") throw new Error("expected table block");

    // Exactly 6 columns, exactly 3 data rows — never reshaped by prose regexes.
    expect(table.headers).toHaveLength(6);
    expect(table.rows).toHaveLength(3);

    expect(table.headers.map(stringifyCell)).toEqual(["$x$", "$0$", "", "$e$", "", "$+\\infty$"]);
    expect(table.rows[0].map(stringifyCell)).toEqual(["$f'(x)$", "|", "$+$", "$0$", "$-$", ""]);
    expect(table.rows[1].map(stringifyCell)).toEqual(["$f(x)$", "|", "$\\nearrow$", "$1 + \\frac{2}{e}$", "$\\searrow$", "$1$"]);
    expect(table.rows[2].map(stringifyCell)).toEqual(["", "$-\\infty$", "", "", "", ""]);

    // No block outside the table (before or after it) ever picks up a "|" —
    // the table's own syntax never bleeds into surrounding prose blocks.
    const nonTableBlocks = blocks.filter((b) => b.type !== "table");
    expect(
      nonTableBlocks.some((b) => (b.type === "text" ? b.content : b.type === "math" ? b.latex : "").includes("|"))
    ).toBe(false);

    // The full sentence before the table survives intact across its own
    // text/math split (the "$f$" math token splits it into two text blocks).
    const proseBefore = blocks
      .slice(0, tableIndex)
      .map((b) => (b.type === "text" ? b.content : b.type === "math" ? `$${b.latex}$` : ""))
      .join("");
    expect(proseBefore).toContain("តារាងអថេរភាពនៃអនុគមន៍ $f$៖");
  });

  it("does not create a table block for prose that merely contains a stray pipe", () => {
    const blocks = buildRenderBlocks("តម្លៃគឺ x | y គ្មានទាក់ទងគ្នា។");
    expect(blocks.some((b) => b.type === "table")).toBe(false);
  });

  it("pads ragged rows to the header's column count", () => {
    const raw = ["| $a$ | $b$ | $c$ |", "| --- | --- | --- |", "| $1$ |"].join("\n");
    const blocks = buildRenderBlocks(raw);
    const table = blocks.find((b) => b.type === "table");
    if (!table || table.type !== "table") throw new Error("expected table block");
    expect(table.rows[0]).toHaveLength(3);
    expect(stringifyCell(table.rows[0][1])).toBe("");
    expect(stringifyCell(table.rows[0][2])).toBe("");
  });

  it("segments math inside a cell the same way top-level content is segmented", () => {
    const raw = ["| $x$ | label |", "| --- | --- |", "| $1$ | some $y=2x$ text |"].join("\n");
    const blocks = buildRenderBlocks(raw);
    const table = blocks.find((b) => b.type === "table");
    if (!table || table.type !== "table") throw new Error("expected table block");
    const cell = table.rows[0][1];
    expect(cell.some((b) => b.type === "math" && b.latex === "y=2x")).toBe(true);
    expect(cell.some((b) => b.type === "text" && b.content.includes("some"))).toBe(true);
  });

  it("parses left/right/center alignment from the delimiter row", () => {
    const raw = ["| a | b | c |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"].join("\n");
    const blocks = buildRenderBlocks(raw);
    const table = blocks.find((b) => b.type === "table");
    if (!table || table.type !== "table") throw new Error("expected table block");
    expect(table.alignments).toEqual(["left", "center", "right"]);
  });
});

describe("enrichRenderBlocks preserves table blocks across a re-serve", () => {
  // attachRenderBlocksToPayload's `Array.isArray(payload.solutionBlocks)`
  // branch runs enrichRenderBlocks on blocks that were ALREADY built by
  // buildRenderBlocks on a previous serve (e.g. a cached session response
  // re-served on reload) — a real, observed case: the table rendered on
  // first generation, then vanished entirely after a reload because
  // enrichRenderBlocks had no case for "table" and silently dropped it.
  it("does not drop a table block on a second pass through enrichRenderBlocks", () => {
    const raw = ["| $x$ | $0$ |", "| :---: | :---: |", "| $f(x)$ | \\| |"].join("\n");
    const firstPass = buildRenderBlocks(raw);
    expect(firstPass.some((b) => b.type === "table")).toBe(true);

    // Simulate the JSON round-trip a cached response actually goes through.
    const roundTripped = JSON.parse(JSON.stringify(firstPass));
    const secondPass = enrichRenderBlocks(roundTripped);

    const table = secondPass.find((b) => b.type === "table");
    expect(table).toBeTruthy();
    if (!table || table.type !== "table") throw new Error("expected table block");
    expect(table.headers).toHaveLength(2);
    expect(table.rows).toHaveLength(1);
  });
});
