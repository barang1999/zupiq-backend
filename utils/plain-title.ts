/**
 * Guarantees session titles never leak raw LaTeX/markdown-math syntax
 * (e.g. `$2x + 3 = ...$`) into what is a plain-text UI label.
 *
 * Unlike `solutionBlocks` / `descriptionBlocks` / `mathBlocks`, a session's
 * `title` is never run through the render-block pipeline (utils/render-blocks.ts)
 * and never pre-rendered to SVG (utils/mathjax-svg.ts) — the mobile client shows
 * it verbatim in a plain RN <Text> inside history list rows. If the AI echoes
 * `$...$` delimiters or backslash commands into the title (which happens when it
 * lifts text straight out of the problem/solution), those raw characters render
 * as-is. Run every AI-produced title through this before it is stored or returned.
 */
const GREEK_LETTERS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", theta: "θ", lambda: "λ", mu: "μ",
  pi: "π", sigma: "σ", omega: "ω", phi: "φ", psi: "ψ", rho: "ρ", eta: "η",
  epsilon: "ε", delta: "δ", Delta: "Δ",
};

export function toPlainTitleText(input: unknown, maxLen = 70): string {
  let text = `${input ?? ""}`.trim();
  if (!text) return "";

  text = text
    // Unwrap math delimiters, keeping their contents.
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\$([\s\S]*?)\$/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
    // Strip styling/text wrappers down to their inner content.
    .replace(/\\(vec|hat|overline|underline|mathbf|mathit|mathrm|mathbb|text)\{([^{}]*)\}/g, "$2")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√$1")
    .replace(/\\sqrt\b/g, "√")
    // Common operators/symbols → readable unicode.
    .replace(/\\times\b/g, "×")
    .replace(/\\div\b/g, "÷")
    .replace(/\\cdot\b/g, "·")
    .replace(/\\pm\b/g, "±")
    .replace(/\\neq\b/g, "≠")
    .replace(/\\leq\b/g, "≤")
    .replace(/\\geq\b/g, "≥")
    .replace(/\\approx\b/g, "≈")
    .replace(/\\infty\b/g, "∞")
    .replace(/\\(?:Rightarrow|Longrightarrow|implies)\b/g, "⇒")
    .replace(/\\(?:rightarrow|to)\b/g, "→")
    .replace(/\\(?:leftrightarrow|Leftrightarrow|iff)\b/g, "⇔")
    .replace(/\\(alpha|beta|gamma|theta|lambda|mu|pi|sigma|omega|phi|psi|rho|eta|epsilon|delta|Delta)\b/g, (_m, name: string) => GREEK_LETTERS[name] ?? name)
    // Sub/superscripts: drop the marker, keep the content plain.
    .replace(/[\^_]\{([^{}]+)\}/g, "$1")
    .replace(/[\^_]([A-Za-z0-9])/g, "$1")
    // Any remaining backslash command: drop the backslash, keep the bare word.
    .replace(/\\([a-zA-Z]+)/g, "$1")
    // Leftover LaTeX punctuation that has no plain-text meaning in a title.
    .replace(/[{}$]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen - 1).trimEnd()}…`;
  }
  return text;
}
