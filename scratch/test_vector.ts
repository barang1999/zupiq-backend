import { normalizeDiagramBlocks } from "../utils/diagram-blocks.js";

function normalizeDigits(text: string): string {
  const map: Record<string, string> = {
    "០": "0", "១": "1", "២": "2", "៣": "3", "៤": "4",
    "៥": "5", "៦": "6", "៧": "7", "៨": "8", "៩": "9",
  };
  return text.replace(/[០-៩]/g, (c) => map[c] || c);
}

function inferVectorRightTriangleBlocks(
  problem: string,
  solutionText: string,
  emptyBlocks: any[] = [],
): any[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  const wantsGeometry = emptyBlocks.some((b) => b.diagramType === "geometry")
    || /(force|forces|east|north|resultant|vector|magnitude|កម្លាំង|ខាងកើត|ខាងជើង|កម្លាំងសរុប|ពីតាហ្គ័រ|ត្រីកោណកែង)/i.test(source);
  if (!wantsGeometry) return [];

  // Try to find forces/magnitudes in Newtons (N)
  const matches = Array.from(source.matchAll(/(\d+(?:\.\d+)?)\s*(?:N|\\text\{N\}|\bNewtons?\b)/gi));
  let f1 = 0;
  let f2 = 0;
  let fR = 0;

  if (matches.length >= 2) {
    const numbers = matches.map(m => Number(m[1]));
    const uniqueNumbers = [...new Set(numbers)];
    uniqueNumbers.sort((a, b) => a - b);
    
    if (uniqueNumbers.length === 2) {
      f1 = uniqueNumbers[0];
      f2 = uniqueNumbers[1];
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    } else if (uniqueNumbers.length >= 3) {
      f1 = uniqueNumbers[0];
      f2 = uniqueNumbers[1];
      fR = uniqueNumbers[2];
      
      const diff = Math.abs(f1 * f1 + f2 * f2 - fR * fR);
      if (diff > 10) {
        f1 = uniqueNumbers[0];
        f2 = uniqueNumbers[1];
        fR = Math.sqrt(f1 * f1 + f2 * f2);
      }
    }
  }

  // Double check with east/north parsing if we don't have valid forces
  if (f1 <= 0 || f2 <= 0) {
    const eastMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:N|Newtons?)?[^\n]*(?:east|ខាងកើត)/i);
    const northMatch = source.match(/(\d+(?:\.\d+)?)\s*(?:N|Newtons?)?[^\n]*(?:north|ខាងជើង)/i);
    if (eastMatch && northMatch) {
      f1 = Number(eastMatch[1]);
      f2 = Number(northMatch[1]);
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    }
  }

  // Check if we still don't have forces, look for generic right triangle sides
  if (f1 <= 0 || f2 <= 0) {
    const numbers = Array.from(source.matchAll(/(?:side|c|a|b|\bប្រវែង\b)[^\d]*?(\d+(?:\.\d+)?)/gi))
      .map(m => Number(m[1]));
    const unique = [...new Set(numbers)];
    if (unique.length >= 2) {
      unique.sort((a, b) => a - b);
      f1 = unique[0];
      f2 = unique[1];
      fR = Math.sqrt(f1 * f1 + f2 * f2);
    }
  }

  if (f1 <= 0 || f2 <= 0 || !Number.isFinite(f1) || !Number.isFinite(f2) || !Number.isFinite(fR)) return [];

  const O: [number, number] = [0, 0];
  const P1: [number, number] = [f1, 0];
  const P2: [number, number] = [f1, f2];

  const paddingX = f1 * 0.15 || 1;
  const paddingY = f2 * 0.15 || 1;

  return normalizeDiagramBlocks([{
    diagramType: "geometry",
    shapes: [
      { shape: "polygon", vertices: [O, P1, P2], labels: ["", "", ""] },
      { shape: "arrow", start: O, end: P1, label: `${f1} N (East)`, color: "muted" },
      { shape: "arrow", start: P1, end: P2, label: `${f2} N (North)`, color: "muted" },
      { shape: "arrow", start: O, end: P2, label: `${Number(fR.toFixed(1))} N (Resultant)`, color: "primary" },
      { shape: "angle", vertex: P1, from: O, to: P2, label: "90°", radius: 18, color: "muted" },
    ],
    options: {
      xMin: -paddingX,
      xMax: f1 + paddingX,
      yMin: -paddingY,
      yMax: f2 + paddingY,
    }
  }]);
}

// Test Case
const problemText = `Two forces act on an object:
*   5N east
*   12N north
Find the magnitude of the resultant force.`;

const solutionText = `យើងត្រូវគណនាតម្លៃដាច់ខាតនៃកម្លាំងសរុប។

យើងមានៈ
កម្លាំងទី១ $F_1 = 5N$ (ទិសខាងកើត)
កម្លាំងទី២ $F_2 = 12N$ (ទិសខាងជើង)

ដោយសារកម្លាំងទាំងពីរធ្វើសកម្មភាពកែងគ្នា (ទិសខាងកើត និងទិសខាងជើង) យើងអាចប្រើទ្រឹស្តីបទពីតាហ្គ័រ ដើម្បីរកតម្លៃដាច់ខាតនៃកម្លាំងសរុប $F_R$។

តាមទ្រឹស្តីបទពីតាហ្គ័រៈ
$$F_R^2 = F_1^2 + F_2^2$$
នាំអោយ
$$\\begin{aligned} F_R^2 &= (5N)^2 + (12N)^2 \\\\ F_R^2 &= 25N^2 + 144N^2 \\\\ F_R^2 &= 169N^2 \\end{aligned}$$
នាំអោយ
$$\\begin{aligned} F_R &= \\sqrt{169N^2} \\\\ F_R &= 13N \\end{aligned}$$
ដូចនេះ តម្លៃដាច់ខាតនៃកម្លាំងសរុបគឺ $13N$។`;

const result = inferVectorRightTriangleBlocks(problemText, solutionText);
console.log("INFERRED BLOCKS:\n", JSON.stringify(result, null, 2));
