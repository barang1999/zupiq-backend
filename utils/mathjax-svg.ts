import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { AllPackages } from "mathjax-full/js/input/tex/AllPackages.js";

const COMPLEX_DISPLAY_MATH_RE = /\\(?:frac|sqrt|int|sum|prod|lim|begin|left|right|overline|underline|vec|hat|binom)|[_^]\{|\\,/;
const MAX_CACHE_SIZE = 500;

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
  if (!display) return false;
  const source = `${latex ?? ""}`.replace(/\\displaystyle\s+/g, "").trim();
  if (!source) return false;
  return COMPLEX_DISPLAY_MATH_RE.test(source);
}

export function renderMathSvg(latex: string, display: boolean): string | null {
  if (!shouldRenderMathSvg(latex, display)) return null;

  const source = `${latex ?? ""}`.replace(/\\displaystyle\s+/g, "").trim();
  const cacheKey = `${display ? "display" : "inline"}:${source}`;
  const cached = svgCache.get(cacheKey);
  if (cached) {
    svgCache.delete(cacheKey);
    svgCache.set(cacheKey, cached);
    return cached;
  }

  try {
    const { adaptor, html } = getMathJaxContext();
    const node = html.convert(source, { display });
    const svgHtml = adaptor.outerHTML(node);
    const rendered = `<span class="mathjax-svg-display">${svgHtml}</span>`;

    if (svgCache.size >= MAX_CACHE_SIZE) {
      const firstKey = svgCache.keys().next().value;
      if (firstKey) svgCache.delete(firstKey);
    }
    svgCache.set(cacheKey, rendered);
    return rendered;
  } catch (error) {
    console.warn("[MathJaxSvgDebug][backend] render failed", {
      latex: source,
      display,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
