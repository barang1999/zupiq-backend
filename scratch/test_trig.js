const problem = "Draw the unit circle and mark $\\theta = \\frac{2\\pi}{3}$. Determine the exact values of $\\sin \\theta$ and $\\cos \\theta$.";
const solutionText = `**ដំណោះស្រាយ**

ដើម្បីរកតម្លៃពិតប្រាកដនៃ $\\sin \\theta$ និង $\\cos \\theta$ សម្រាប់ $\\theta = \\frac{2\\pi}{3}$ យើងប្រើរង្វង់ត្រីកោណមាត្រឯកតា។

យើងមានៈ
មុំ $\\theta = \\frac{2\\pi}{3}$

ដំបូង យើងបំប្លែងមុំពី រ៉ាដ្យង់ ទៅ ដឺក្រេ ដើម្បីងាយស្រួលមើលៈ
$$ \\theta = \\frac{2\\pi}{3} \\text{ រ៉ាដ្យង់} = \\frac{2 \\times 180^\\circ}{3} = 2 \\times 60^\\circ = 120^\\circ $$

**ការគូររង្វង់ត្រីកោណមាត្រឯកតា និងសម្គាល់មុំ:**
1.  គូរប្រព័ន្ធកូអរដោនេដេកាត (អ័ក្ស $x$ និងអ័ក្ស $y$)។
2.  គូររង្វង់មួយដែលមានផ្ចិតនៅត្រង់គល់កូអរដោនេ $(0,0)$ និងកាំស្មើនឹង $1$ ឯកតា។ នេះគឺជារង្វង់ត្រីកោណមាត្រឯកតា។
3.  សម្គាល់ផ្នែកដំបូងនៃមុំ (initial side) នៅតាមអ័ក្ស $x$ វិជ្ជមាន។
4.  បង្វិលច្រាសទ្រនិចនាឡិកាចាប់ពីផ្នែកដំបូងនៃមុំ ដោយមុំ $120^\\circ$ (ឬ $\\frac{2\\pi}{3}$ រ៉ាដ្យង់)។
5.  សម្គាល់ផ្នែកចុងក្រោយនៃមុំ (terminal side)។ ផ្នែកចុងក្រោយនេះនឹងស្ថិតនៅក្នុងត្រីមាសទីពីរ។
6.  ចំណុចដែលផ្នែកចុងក្រោយនៃមុំកាត់រង្វង់ត្រីកោណមាត្រឯកតា គឺជាចំណុច $P(x,y)$ ដែល $x = \\cos \\theta$ និង $y = \\sin \\theta$។

**ការកំណត់តម្លៃពិតប្រាកដនៃ $\\sin \\theta$ និង $\\cos \\theta$:**
មុំ $\\theta = 120^\\circ$ ស្ថិតនៅក្នុងត្រីមាសទីពីរ។
មុំយោង (reference angle) សម្រាប់ $120^\\circ$ គឺ $180^\\circ - 120^\\circ = 60^\\circ$ (ឬ $\\pi - \\frac{2\\pi}{3} = \\frac{\\pi}{3}$ រ៉ាដ្យង់)។

យើងដឹងតម្លៃត្រីកោណមាត្រសម្រាប់មុំ $60^\\circ$ គឺៈ
$$ \\cos\\left(\\frac{\\pi}{3}\\right) = \\frac{1}{2} $$
$$ \\sin\\left(\\frac{\\pi}{3}\\right) = \\frac{\\sqrt{3}}{2} $$

នៅក្នុងត្រីមាសទីពីរ តម្លៃកូស៊ីនុសអវិជ្ជមាន ហើយតម្លៃស៊ីនុសវិជ្ជមាន។
ដូចនេះ សម្រាប់ $\\theta = \\frac{2\\pi}{3}$ (ឬ $120^\\circ$) គឺៈ
$$ \\cos\\left(\\frac{2\\pi}{3}\\right) = -\\cos\\left(\\frac{\\pi}{3}\\right) = -\\frac{1}{2} $$
$$ \\sin\\left(\\frac{2\\pi}{3}\\right) = \\sin\\left(\\frac{\\pi}{3}\\right) = \\frac{\\sqrt{3}}{2} $$`;

function parseAngle(prob, sol) {
  const text = `${prob}\n${sol}`;
  const radFracRegex = /\\theta\s*=\s*(?:-\\frac|\\frac)?\s*\{\s*(?:(\d+)?\\pi|\\pi)\s*\}\s*\{\s*(\d+)\}/i;
  const radSlashRegex = /\\theta\s*=\s*(?:-)?(\d+)?\\pi\s*\/\s*(\d+)/i;
  const degRegex = /(\d+)\s*(?:°|\\circ|degree|ដឺក្រេ)/gi;

  const mFrac = text.match(radFracRegex);
  if (mFrac) {
    const num = mFrac[1] ? Number(mFrac[1]) : 1;
    const den = Number(mFrac[2]);
    const deg = (num / den) * 180;
    return { deg, label: `\\frac{${num === 1 ? '' : num}\\pi}{${den}}` };
  }

  const mSlash = text.match(radSlashRegex);
  if (mSlash) {
    const num = mSlash[1] ? Number(mSlash[1]) : 1;
    const den = Number(mSlash[2]);
    const deg = (num / den) * 180;
    return { deg, label: `\\frac{${num === 1 ? '' : num}\\pi}{${den}}` };
  }

  const degMatches = Array.from(text.matchAll(degRegex)).map(m => Number(m[1]));
  const commonTrigAngles = [30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
  const matchedAngle = degMatches.find(d => commonTrigAngles.includes(d));
  if (matchedAngle) {
    return { deg: matchedAngle, label: `${matchedAngle}^\\circ` };
  }

  return null;
}

function parseTrigCoords(sol) {
  const cosLines = Array.from(sol.matchAll(/\\cos\s*(?:\\left\()?[^\n$]+=[^\n$]+/gi)).map(m => m[0]);
  const sinLines = Array.from(sol.matchAll(/\\sin\s*(?:\\left\()?[^\n$]+=[^\n$]+/gi)).map(m => m[0]);

  const cleanVal = (v) => v.replace(/\s*[\$]+$/, '').trim();
  const isClean = (v) => {
    const normalized = cleanVal(v);
    if (/\\cos|\\sin|\\tan|\\theta|\\pi/i.test(normalized)) return false;
    return true;
  };

  const getFinalValue = (lines) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const parts = lines[i].split("=");
      const lastPart = parts[parts.length - 1];
      const cleaned = cleanVal(lastPart);
      if (isClean(cleaned)) return cleaned;
    }
    return null;
  };

  const cosVal = getFinalValue(cosLines);
  const sinVal = getFinalValue(sinLines);

  if (cosVal && sinVal) {
    return { cos: cosVal, sin: sinVal };
  }
  return null;
}

function inferTrigUnitCircleBlocks(prob, sol) {
  const parsedAngle = parseAngle(prob, sol);
  if (!parsedAngle) return [];

  const angleDeg = parsedAngle.deg;
  const angleLabel = parsedAngle.label;

  const rad = (angleDeg * Math.PI) / 180;
  const x = Number(Math.cos(rad).toFixed(4));
  const y = Number(Math.sin(rad).toFixed(4));

  let cosLabel = String(Number(x.toFixed(2)));
  let sinLabel = String(Number(y.toFixed(2)));

  const parsedCoords = parseTrigCoords(sol);
  if (parsedCoords) {
    cosLabel = parsedCoords.cos;
    sinLabel = parsedCoords.sin;
  }

  const pLabel = `P\\left(${cosLabel}, ${sinLabel}\\right)`;

  const O = [0, 0];
  const P = [x, y];
  const Px = [x, 0];
  const Py = [0, y];
  const InitEnd = [1, 0];
  const PAngleFrom = [0.35, 0];

  return {
    diagramType: "geometry",
    mathFamily: "trigonometric",
    shapes: [
      { shape: "circle", center: O, radius: 1, fill: "none", color: "primary" },
      { shape: "arrow", start: O, end: InitEnd, label: "", color: "muted" },
      { shape: "arrow", start: O, end: P, label: pLabel, color: "primary" },
      { shape: "line", start: P, end: Px, color: "muted" },
      { shape: "line", start: P, end: Py, color: "muted" },
      { shape: "angle", vertex: O, from: PAngleFrom, to: P, label: angleLabel, radius: 26, color: "red" },
    ],
    options: {
      xMin: -1.3,
      xMax: 1.3,
      yMin: -1.3,
      yMax: 1.3,
      grid: false,
      showOrigin: true,
      xAxisLabel: "\\cos \\theta",
      yAxisLabel: "\\sin \\theta"
    }
  };
}

const spec = inferTrigUnitCircleBlocks(problem, solutionText);
console.log(JSON.stringify(spec, null, 2));
