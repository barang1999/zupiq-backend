// Temporary test file to test the elevation right-triangle fallback parser logic.

function firstNumberAfter(text: string, regexes: RegExp[]): number | null {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function normalizeDigits(text: string): string {
  return text.replace(/[០-៩]/g, (d) => String(d.charCodeAt(0) - 6096));
}

function inferRightTriangleTrigBlocks(
  problem: string,
  solutionText: string
): any[] {
  const source = normalizeDigits(`${problem}\n${solutionText}`);
  
  const hasTrigElevation = /(elevation|depression|building|tree|tower|cliff|height|shadow|មុំងើប|មុំបន្ទាប|កម្ពស់|អគារ|ដើមឈើ|បង្គោល|ប្រវែងស្រមោល)/i.test(source)
    && /(tan|cos|sin|តង់សង់|កូតង់សង់|ស៊ីនុស|កូស៊ីនុស)/i.test(source);
    
  if (!hasTrigElevation) return [];

  // 1. Find all angle candidates
  const angleCandidates = Array.from(source.matchAll(/(\d+(?:\.\d+)?)\s*(?:\^\{?\\?circ\}?|\^\{?\\?text\{o\}\}?|\^\{?o\}?|\\circ|°|degree|ដឺក្រេ)/gi))
    .map(m => Number(m[1]))
    .filter(a => a > 0 && a < 90);
  const angle = angleCandidates[0] || 30; // default 30

  // 2. Find all distance/length candidates
  const lengthCandidates = Array.from(source.matchAll(/(\d+(?:\.\d+)?)\s*(?:m|meters|ម៉ែត្រ|ម៉ែត)\b/gi))
    .map(m => Number(m[1]))
    .filter(n => n > 0 && n < 1000);
    
  const problemNumbers = Array.from(problem.matchAll(/(\d+(?:\.\d+)?)/g))
    .map(m => Number(m[0]))
    .filter(n => n > 0 && n !== 90 && n !== 45 && n !== 30 && n !== 60 && n < 1000);

  const allLengths = [...new Set([...lengthCandidates, ...problemNumbers])];

  let base = 25;
  let height = 0;

  if (allLengths.length >= 1) {
    const parsedBase = firstNumberAfter(source, [
      /(?:stands|distance|ចម្ងាយ|ឆ្ងាយ)\s*(?:of|ពី)?\s*(\d+(?:\.\d+)?)/i,
    ]);
    if (parsedBase && allLengths.includes(parsedBase)) {
      base = parsedBase;
    } else {
      base = allLengths[0];
    }
  }

  const expectedHeight = Number((base * Math.tan((angle * Math.PI) / 180)).toFixed(2));
  
  const foundHeight = allLengths.find(l => l !== base && Math.abs(l - expectedHeight) < expectedHeight * 0.15);
  height = foundHeight || expectedHeight;

  const O: [number, number] = [0, 0];
  const Px: [number, number] = [base, 0];
  const Pxy: [number, number] = [base, height];
  
  const paddingX = base * 0.15 || 2;
  const paddingY = height * 0.15 || 2;

  const xMin = -paddingX;
  const xMax = base + paddingX;
  const yMin = -paddingY;
  const yMax = height + paddingY;

  return [{
    diagramType: "geometry",
    shapes: [
      { shape: "polygon", vertices: [O, Px, Pxy], labels: ["", "", ""] },
      { shape: "line", start: O, end: Px, label: `${base} m`, color: "muted" },
      { shape: "line", start: Px, end: Pxy, label: `h ≈ ${height} m`, color: "primary" },
      { shape: "line", start: O, end: Pxy, label: "", color: "muted" },
      { shape: "angle", vertex: O, from: Px, to: Pxy, label: `${angle}°`, radius: 24, color: "red" },
      { shape: "angle", vertex: Px, from: O, to: Pxy, label: "90°", radius: 10, color: "muted" },
    ],
    options: {
      xMin,
      xMax,
      yMin,
      yMax,
      grid: false,
      showOrigin: false,
      xAxisLabel: "",
      yAxisLabel: ""
    }
  }];
}

function runTest() {
  const prob = "សិស្សម្នាក់ឈរនៅចម្ងាយ 25 m ពីអគារមួយ។ មុំងើបទៅកាន់ដំបូលអគារគឺ 48°។ គូររូបភាពនៃស្ថានភាពនេះហើយរកកម្ពស់អគារ។";
  const sol = "ចម្ងាយពីសិស្សទៅអគារគឺ 25 m. មុំងើប 48°. h = 25 * tan(48°) = 27.77 m. កម្ពស់អគារគឺប្រហែល 27.77 ម៉ែត្រ។";
  console.log(JSON.stringify(inferRightTriangleTrigBlocks(prob, sol), null, 2));
}

runTest();
