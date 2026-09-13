# Reference Corpus Guide

How to manage the reference corpus used to enrich AI prompts during solution generation.

---

## Overview

The reference corpus is a collection of curated Khmer math textbook and exam content stored as JSON files in `data/reference/`. At startup, all files are loaded into memory and searched algorithmically (no AI, no embeddings) to find relevant chunks for each problem. The top 3 matching chunks are injected into the system prompt to guide the model's explanation style and formulas.

**Key rule: retrieval is always algorithm-based.** Never replace the keyword scoring with an AI or embedding call — the zero token cost is intentional.

---

## File Structure

Each file in `data/reference/` must be named `*.reference.json` and follow this schema:

```json
{
  "schemaVersion": 1,
  "source": { ... },
  "responsePatterns": [ ... ],
  "chunks": [ ... ]
}
```

### `source`

Describes the origin of the content.

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier, matches the filename stem |
| `title` | string | English title |
| `titleKh` | string | Khmer title (optional) |
| `author` | string | Author or publisher (optional) |
| `language` | `"km"` \| `"en"` | Primary language |
| `subject` | `"math"` \| `"physics"` \| ... | Subject |
| `gradeRange` | string[] | e.g. `["11", "12"]` |
| `sourceType` | `"textbook"` \| `"exam"` \| `"notes"` | Content type |
| `topics` | string[] | Topic slugs covered in this file |
| `quality.trusted` | boolean | `true` = chunks from this source get +6 score bonus |

### `responsePatterns`

Optional. Defines explanation style patterns that chunks can reference. The `patternId` is matched via `chunk.responsePatternIds`.

| Field | Description |
|---|---|
| `patternId` | Unique ID, referenced by chunks |
| `name` | Human-readable name |
| `language` | Language this pattern applies to |
| `appliesTo` | Topic slugs this pattern is relevant to |
| `structure` | Ordered list of explanation steps |
| `khmerPhrases` | Useful local phrasing suggestions |
| `avoid` | Things the model should not do |
| `mathFormatting.conclusionPrefix` | Phrase to use before the final answer (e.g., `"ដូច្នេះ"`) |

### `chunks`

The retrievable units. Each chunk is one worked example, formula rule, or concept explanation.

| Field | Type | Required | Description |
|---|---|---|---|
| `chunkId` | string | ✅ | Unique ID — convention: `{sourceId}-p{page}-c{index}` |
| `sourceId` | string | ✅ | Must match `source.id` |
| `language` | string | ✅ | `"km"` or `"en"` |
| `subject` | string | ✅ | e.g. `"math"` |
| `gradeRange` | string[] | ✅ | e.g. `["12"]` |
| `topic` | string | ✅ | Topic slug (used for scoring) |
| `topicKh` | string | | Khmer topic name (used for scoring) |
| `chunkType` | string | ✅ | `"worked_example"`, `"formula_rule"`, or `"concept_explanation"` |
| `text` | string | ✅ | Raw Khmer text from the source |
| `normalizedText` | string | | Clean English summary — prefer this over raw `text` if available |
| `problem` | object | | `{ textKh, text, latex }` — the problem statement |
| `solutionSteps` | array | | Each step: `{ textKh, text, latex, explanationKh, explanation }` |
| `finalAnswer` | object | | `{ textKh, text, latex }` |
| `formulas` | array | | `{ latex, meaning, confidence }` — key formulas in this chunk |
| `keywords` | string[] | | Extra search terms (Khmer and English) |
| `difficulty` | string | | `"high_school"`, `"university"`, etc. |
| `responsePatternIds` | string[] | | Pattern IDs from `responsePatterns` to attach to this chunk |
| `quality` | object | | See quality flags below |

---

## Quality Flags

Quality flags on a chunk control retrieval scoring and filtering.

| Flag | Effect |
|---|---|
| `trusted: true` | +6 score bonus; chunk is preferred over untrusted ones of equal relevance. Set this only after formula and solution have been manually verified. |
| `humanReviewed: true` | +2 score bonus |
| `formulaReviewed: true` | +1 score bonus |
| `solutionReviewed: true` | Informational — no score effect currently |
| `needsCuration: true` | −2 score penalty — use for raw/unverified extractions |
| `excluded: true` | Chunk is completely skipped and never retrieved |

**Recommendation:** mark newly added chunks as `needsCuration: true` and `trusted: false` until someone has verified the formulas. Upgrade to `trusted: true` after review.

---

## How Retrieval Works

1. Query is built from: user's problem text + subject + grade
2. Query is tokenized and expanded via `KHMER_ALIASES` (e.g. "ស្វ៊ីត" expands to `["sequences", "arithmetic_sequence", ...]`)
3. Each chunk is scored:
   - +2 per query term found in chunk text/normalizedText
   - +3 per query term found in `topic` or `topicKh`
   - +2 per query term found in `keywords`
   - +4 if a `KHMER_ALIASES` alias matches the chunk's haystack
   - Quality bonuses applied on top
4. Top 3 trusted chunks are selected (falls back to all chunks if no trusted ones match)
5. Total context is capped at **3,500 characters**

---

## Adding a New Reference File

1. Create `data/reference/{id}.reference.json` following the schema above
2. Set `schemaVersion: 1`
3. Give each chunk a unique `chunkId` in the form `{sourceId}-p{page}-c{index}`
4. Mark new chunks `needsCuration: true`, `trusted: false` initially
5. Add relevant `keywords` in both Khmer and English — this directly drives retrieval quality
6. If the source covers a topic not yet in `KHMER_ALIASES` (in `services/reference-corpus.service.ts`), add an alias entry so Khmer queries can find it

No code change is needed to load new files — the service scans `data/reference/` automatically at startup.

---

## Adding a New `KHMER_ALIAS`

Open `services/reference-corpus.service.ts` and add an entry to the `KHMER_ALIASES` array:

```typescript
const KHMER_ALIASES: Array<[RegExp, string[]]> = [
  // existing entries...
  [/your_regex/i, ["slug1", "ខ្មែរពាក្យ", "english-term"]],
];
```

- The regex matches against the raw query string
- The aliases array lists normalized terms to add to the query token set
- Both Khmer and English aliases are useful — the scorer normalizes everything before comparison

---

## Excluding a Bad Chunk

Set `quality.excluded: true` on the chunk. It will be skipped during retrieval without removing it from the file, preserving history.

```json
"quality": {
  "excluded": true
}
```

---

## Tips

- **`normalizedText` matters** — the scorer searches this field. For Khmer-only chunks, always add a clean English `normalizedText` summary so English-query problems can still retrieve it.
- **Keep `solutionSteps` to 4 or fewer** — the formatter truncates at 4 steps and total context is capped at 3,500 chars. Long steps just get cut off.
- **`chunkType: "formula_rule"` gets a +1 bonus** — use it for pure formula/theorem chunks, not worked examples.
- **Don't rely on source-level `quality.trusted`** — trusted scoring is per-chunk, not per-source. A trusted source can still have individual unverified chunks.
