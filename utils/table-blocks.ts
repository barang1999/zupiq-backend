/**
 * Structural (parse-first) markdown-table extraction for solution/final-answer text.
 *
 * Why this exists: `segmentMathContent` only knows about "$...$"-delimited math
 * tokens vs. everything else. A markdown table's pipes, its `:---:` delimiter
 * row, and its escaped "\|" cell markers all fall into the generic "everything
 * else" text bucket, get merged with adjacent prose by `compactTextBlocks`, and
 * then get run through `normalizeTextBlockContent`'s prose-shaped repair
 * regexes (bullet/heading line-breaking, the "\ " separator-to-newline rule,
 * etc.) — none of which know they're looking at tabular data. That's the root
 * cause of prose leaking into a table's header row / table rows losing cells:
 * the table was never a distinct structural unit, just a string that happened
 * to contain pipes.
 *
 * This module extracts table regions BEFORE any prose normalization runs, so a
 * table's rows/cells live in their own array slots from the moment the raw
 * text is parsed — no later regex pass (backend or frontend) can ever merge a
 * table row into a sentence or vice versa, because they're no longer part of
 * the same string.
 */

export type TableAlignment = "left" | "center" | "right";

export interface RawTableChunk {
  kind: "table";
  headerCells: string[];
  alignments: TableAlignment[];
  rowCells: string[][];
}

export interface ProseChunk {
  kind: "prose";
  text: string;
}

export type ExtractedChunk = ProseChunk | RawTableChunk;

// A "|" not immediately preceded by "\" is a real column delimiter; one that
// is (e.g. the literal "$\|$" undefined/discontinuity marker some Khmer
// variation tables use) stays part of the cell's own content until it's
// unescaped for display later.
const UNESCAPED_PIPE_RE = /(?<!\\)\|/;

function hasUnescapedPipe(line: string): boolean {
  return UNESCAPED_PIPE_RE.test(line);
}

function splitTableRowCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split(new RegExp(UNESCAPED_PIPE_RE, "g")).map((cell) => cell.trim());
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !hasUnescapedPipe(trimmed)) return false;
  const cells = splitTableRowCells(trimmed);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseAlignment(delimiterCell: string): TableAlignment {
  const trimmed = delimiterCell.trim();
  const startsColon = trimmed.startsWith(":");
  const endsColon = trimmed.endsWith(":");
  if (startsColon && endsColon) return "center";
  if (endsColon) return "right";
  return "left";
}

/**
 * Splits raw solution/answer text into an ordered sequence of prose and table
 * chunks. Runs purely on line shape (GFM-style: a pipe-row immediately
 * followed by a `:---:`-style delimiter row starts a table; the table ends at
 * the first following line with no unescaped pipe) — no prose-repair regex
 * runs here, so nothing has had a chance to corrupt line boundaries yet.
 */
export function extractTableChunks(raw: string): ExtractedChunk[] {
  const lines = `${raw ?? ""}`.replace(/\r\n?/g, "\n").split("\n");
  const chunks: ExtractedChunk[] = [];
  let proseLines: string[] = [];

  const flushProse = () => {
    if (proseLines.length > 0) {
      chunks.push({ kind: "prose", text: proseLines.join("\n") });
      proseLines = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : "";

    if (hasUnescapedPipe(line) && isTableDelimiterLine(nextLine)) {
      flushProse();
      const headerCells = splitTableRowCells(line);
      const alignments = splitTableRowCells(nextLine).map(parseAlignment);
      const rowCells: string[][] = [];
      let j = i + 2;
      while (j < lines.length && hasUnescapedPipe(lines[j])) {
        rowCells.push(splitTableRowCells(lines[j]));
        j += 1;
      }
      chunks.push({ kind: "table", headerCells, alignments, rowCells });
      i = j;
      continue;
    }

    proseLines.push(line);
    i += 1;
  }

  flushProse();
  return chunks;
}

/**
 * Whether `raw` contains at least one table region — lets callers skip the
 * chunk round-trip entirely for the common no-table case and fall through to
 * the exact pre-existing behavior (avoids any risk of subtly changing
 * whitespace/line-join behavior for content that never had a table).
 */
export function containsTableChunk(chunks: ExtractedChunk[]): boolean {
  return chunks.some((chunk) => chunk.kind === "table");
}

// The backslash before a table-delimiter pipe (e.g. the literal "\|"
// undefined/discontinuity marker) only existed to keep that pipe from being
// mistaken for a column separator. Now that extraction has already isolated
// it into its own cell, the backslash is never meant to be visible — unescape
// it before the cell's content is handed off for display/math segmentation.
export function unescapeCellPipes(cell: string): string {
  return `${cell ?? ""}`.replace(/\\\|/g, "|");
}
