# AI Cost Guide

Cost optimization decisions for the Gemini API integration. Reference this before adding or changing AI calls.

---

## Pricing (gemini-3.5-flash)

| Token type | Rate |
|---|---|
| Input (prompt) | $1.50 / 1M tokens |
| Output (completion) | $9.00 / 1M tokens |
| Thinking | $9.00 / 1M tokens — same as output, billed separately |

Thinking tokens are the most dangerous cost driver. A single uncapped call can produce 3,000–6,000 thinking tokens, costing more than the visible completion.

---

## Per-call Cost Breakdown (photo scan, typical problem)

| Call | Prompt | Billable output | Cost | Notes |
|---|---|---|---|---|
| `generateRawSolution` | ~3,600 | ~2,000 (1,027 completion + 966 thinking) | ~$0.023 | Phase 1 free-form solve |
| `breakdownProblem` | ~3,600 | ~1,300 | ~$0.017 | Step-by-step explanation |
| `extractDiagramBlocksForSolution` | ~5,000 | ~275 | ~$0.005 | On-demand only |

**Typical session total (solve + breakdown + diagram): ~$0.045**

---

## Rules

### 1. Always set `noThinking: true` for structured extraction tasks

Any call that takes existing text and converts it to a fixed JSON schema is a structured extraction task. Thinking adds no value — the answer is deterministic given the input.

Apply `noThinking: true` to:
- JSON extraction from an existing solution or text
- Field classification (subject, topic, intent)
- Node/tree decomposition of an already-solved problem
- Diagram spec generation from a known solution
- Table, insight, or formula extraction

Do NOT apply `noThinking: true` to:
- `generateRawSolution` — free-form solve where reasoning improves quality
- `solveProblemSolutionFirst` fallback — structured solve from scratch
- `solveFromImageDirect` fallback — vision solve from scratch

### 2. Cap thinking on primary solve calls

`generateRawSolution` uses `thinkingConfig: { thinkingBudget: 1024 }`. This caps internal reasoning at 1,024 tokens (enough for high-school math) instead of the model's natural 2,000–3,000 token deliberation.

Do not remove the cap without benchmarking. Lower to 512 if quality holds. Raise only if specific problem types regress.

### 3. Never pass context to sub-calls

Use `withoutContext(options)` when calling extraction functions (`extractDiagramBlocksForSolution`, etc.) inside a primary solve. The reference corpus, user knowledge context, and step context are only useful for the primary solve — passing them to sub-calls wastes ~1,800 tokens per call with no quality benefit.

```typescript
// Good
const subOptions = withoutContext({ ...options, subject });
await extractDiagramBlocksForSolution(problem, rawSolution, subOptions, ...);

// Bad — sends reference context to an extraction call
await extractDiagramBlocksForSolution(problem, rawSolution, options, ...);
```

### 4. Embed metadata in Phase 1 output instead of a second call

`extractSolutionMetadata` was eliminated. Instead, the Phase 1 prompt asks the model to end with terminal marker lines:

```
**Title:** [...]
**Subject:** [Math | Physics | Chemistry]
**Topic:** [slug]
**Problem Intent:** [...]
**Final Answer:** [...]
```

These are regex-extracted by `extractMetadataFromPhase1()` at zero token cost. This saved ~2,700 tokens (~$0.004) per solve.

When adding new metadata fields to the solve flow: extend the Phase 1 prompt markers and update `extractMetadataFromPhase1()` — do not add a second AI call.

### 5. Defer diagram generation to on-demand

`extractDiagramBlocksForSolution` is NOT called during the initial solve. The frontend shows a "Generate diagram" button when `diagramBlocks.length === 0`. Users trigger it explicitly via `POST /api/ai/session-diagram`.

Do not re-add diagram generation to the solve path. The 5,000-token prompt cost is only justified when the user actually wants a diagram.

### 6. Use `GEMINI_SIMPLE_MODEL` for non-primary calls

The `/api/ai/session-diagram` endpoint explicitly sets `aiOptions.aiModel = env.GEMINI_SIMPLE_MODEL`. Apply the same pattern to any new non-primary extraction endpoint.

---

## Debugging Token Cost

Every `generateStructuredJson` and `generateRawSolution` call logs a `💰 [token-task]` line:

```
💰 [token-task] breakdownProblem attempt=1 noThinking=true {
  prompt: 3598,
  completion: 1300,
  thinking: 0,
  billableOutput: 1300,
  total: 4898
}
```

`billableOutput = completion + thinking`. Both are billed at the output rate ($9/M).

The route-level `[token-usage] consumed` log shows the aggregated total after `consumeTokenBudget` runs. Use the `💰 [token-task]` lines to identify which specific call is expensive.

---

## Historical Optimization Log

| Date | Change | Savings |
|---|---|---|
| 2026-09-11 | Removed thinking from `extractSolutionMetadata`, `extractDiagramBlocksForSolution`, `expandNode`, `regenerateBranchNode`, `getNodeInsight`, `generateVisualTable` | ~$0.030/session |
| 2026-09-11 | Moved diagram generation to on-demand button | ~5,000 prompt tokens/solve |
| 2026-09-11 | Eliminated `extractSolutionMetadata` call (regex extraction from Phase 1 markers) | ~2,700 tokens, ~$0.004/solve |
| 2026-09-11 | Added `thinkingBudget: 1024` cap to `generateRawSolution` | Thinking 2,552 → ~966, ~$0.014/solve |
| 2026-09-11 | Added `noThinking: true` to `breakdownProblem` | Thinking 5,736 → 0, ~$0.052/breakdown |
| 2026-09-11 | Reduced `DEFAULT_REFERENCE_LIMIT` 5→3, `MAX_REFERENCE_CONTEXT_CHARS` 5200→3500 | ~500 prompt tokens/call |

**Net result: ~$0.126 → ~$0.040 per full session (solve + breakdown + diagram), 68% reduction.**
