import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

// Increased to handle all display math (not just complex expressions)
const MAX_CACHE_SIZE = 2000;

const svgCache = new Map<string, string>();

let documentCache: ReturnType<typeof mathjax.document> | null = null;
let adaptorCache: ReturnType<typeof liteAdaptor> | null = null;

function getMathJaxContext() {
  if (documentCache && adaptorCache) {
    return { adaptor: adaptorCache, html: documentCache };
  }

  adaptorCache = liteAdaptor();
  RegisterHTMLHandler(adaptorCache);

  const tex = new TeX({
    packages: AllPackages,
    inlineMath: [["$", "$"], ["\\(", "\\)"]],
    displayMath: [["$$", "$$"], ["\\[", "\\]"]],
  });
  const svg = new SVG({ fontCache: "none" });
  documentCache = mathjax.document("", { InputJax: tex, OutputJax: svg });

  return { adaptor: adaptorCache, html: documentCache };
}

export function shouldRenderMathSvg(latex: string, display: boolean): boolean {
  const source = `${latex ?? ""}`.replace(/\\displaystyle\s+/g, "").trim();
  return source.length > 0;
}

// Strip common AI-output artifacts before a retry attempt
function stripForRetry(latex: string): string {
  return latex
    .replace(/\\{2,}([a-zA-Z])/g, "\\$1")   // over-escaped backslashes: \\frac → \frac
    .replace(/\t([a-zA-Z]+)/g, "\\$1")        // tab artifacts: \tfrac → \frac
    .replace(/\\displaystyle\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderOnce(source: string, display: boolean, adaptor: any, html: any): string | null {
  try {
    const node = html.convert(source, { display });
    const svgHtml = adaptor.outerHTML(node);
    const className = display ? "mathjax-svg-display" : "mathjax-svg-inline";
    return `<span class="${className}">${svgHtml}</span>`;
  } catch {
    return null;
  }
}

function setCached(key: string, value: string): void {
  if (svgCache.size >= MAX_CACHE_SIZE) {
    const firstKey = svgCache.keys().next().value;
    if (firstKey) svgCache.delete(firstKey);
  }
  svgCache.set(key, value);
}

export function renderMathSvg(latex: string, display: boolean): string | null {
  if (!shouldRenderMathSvg(latex, display)) return null;

  const source = `${latex ?? ""}`.replace(/\\displaystyle\s+/g, "").trim();
  const cacheKey = `${display ? "display" : "inline"}:${source}`;

  const cached = svgCache.get(cacheKey);
  if (cached) {
    // LRU: move to end
    svgCache.delete(cacheKey);
    svgCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const { adaptor, html } = getMathJaxContext();

    // First attempt: render as-is
    let rendered = renderOnce(source, display, adaptor, html);

    // Second attempt: strip common serialization artifacts and retry
    if (!rendered) {
      const cleaned = stripForRetry(source);
      if (cleaned !== source) {
        rendered = renderOnce(cleaned, display, adaptor, html);
      }
    }

    if (!rendered) {
      console.warn("[MathJaxSvg] render failed after retry", {
        latex: source.slice(0, 120),
        display,
      });
      return null;
    }

    setCached(cacheKey, rendered);
    return rendered;
  } catch (error) {
    console.warn("[MathJaxSvg] context error", {
      latex: source.slice(0, 120),
      display,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
