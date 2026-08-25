const problem = "A vector has magnitude 10 and forms an angle of 30° with the positive x-axis. Draw the vector and its horizontal and vertical components.";
const solutionText = "ដើម្បីដោះស្រាយបញ្ហានេះ យើងត្រូវរកសមាសធាតុដេក (horizontal component) និងសមាសធាតុឈរ (vertical component) នៃវ៉ិចទ័រដែលបានផ្ដល់ឱ្យ រួចពិពណ៌នាអំពីរបៀបគូរវា។\n\nយើងមានៈ\n*   រង្វាស់នៃវ៉ិចទ័រ $|\\vec{V}| = 10$\n*   មុំដែលវ៉ិចទ័របង្កើតជាមួយអ័ក្ស $x$ វិជ្ជមាន $\\theta = 30^\\circ$\n\nតាមរូបមន្តសម្រាប់សមាសធាតុនៃវ៉ិចទ័រ៖\n*   សមាសធាតុដេក (តាមអ័ក្ស $x$) គឺ $V_x = |\\vec{V}| \\cos \\theta$\n*   សមាសធាតុឈរ (តាមអ័ក្ស $y$) គឺ $V_y = |\\vec{V}| \\sin \\theta$\n\nយើងជំនួសតម្លៃដែលបានផ្ដល់ឱ្យទៅក្នុងរូបមន្ត៖\n\nសម្រាប់សមាសធាតុដេក $V_x$:\n$$V_x = 10 \\cos(30^\\circ)$$\nយើងដឹងថា $\\cos(30^\\circ) = \\frac{\\sqrt{3}}{2}$\n$$V_x = 10 \\times \\frac{\\sqrt{3}}{2}$$\n$$V_x = 5\\sqrt{3}$$\n$$V_x \\approx 5 \\times 1.732$$\n$$V_x \\approx 8.66$$\n\nសម្រាប់សមាសធាតុឈរ $V_y$:\n$$V_y = 10 \\sin(30^\\circ)$$\nយើងដឹងថា $\\sin(30^\\circ) = \\frac{1}{2}$\n$$V_y = 10 \\times \\frac{1}{2}$$\n$$V_y = 5$$\n\n**ការគូរវ៉ិចទ័រ និងសមាសធាតុរបស់វា:**\n1.  គូរប្រព័ន្ធកូអរដោនេដេក (អ័ក្ស $x$) និងឈរ (អ័ក្ស $y$)。\n2.  ពីចំណុចគល់ (0,0) គូរវ៉ិចទ័រដើម $\\vec{V}$ ដែលមានប្រវែង 10 ឯកតា ដោយបង្កើតមុំ $30^\\circ$ ជាមួយអ័ក្ស $x$ វិជ្ជមាន។\n3.  ដើម្បីគូរសមាសធាតុដេក $V_x$: ពីចុងវ៉ិចទ័រ $\\vec{V}$ គូរបន្ទាត់ដាច់ៗកាត់កែងទៅអ័ក្ស $x$ ។ ចំណុចប្រសព្វនៅលើអ័ក្ស $x$ គឺជាចុងនៃសមាសធាតុដេក។ គូរវ៉ិចទ័រ $V_x$ ពីចំណុចគល់ទៅចំណុចប្រសព្វនេះ។\n4.  ដើម្បីគូរសមាសធាតុឈរ $V_y$: ពីចុងវ៉ិចទ័រ $\\vec{V}$ គូរបន្ទាត់ដាច់ៗកាត់កែងទៅអ័ក្ស $y$ ។ ចំណុចប្រសព្វនៅលើអ័ក្ស $y$ គឺជាចុងនៃសមាសធាតុឈរ។ គូរវ៉ិចទ័រ $V_y$ ពីចំណុចគល់ទៅចំណុចប្រសព្វនេះ។\n\nដូចនេះ សមាសធាតុដេកនៃវ៉ិចទ័រគឺ $5\\sqrt{3}$ (ប្រហែល 8.66) និងសមាសធាតុឈរគឺ $5$ ។";

// Helper to mimic firstNumberAfter
function firstNumberAfter(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const raw = match[1] ?? match[2] ?? match[0];
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

const source = `${problem}\n${solutionText}`;

const magnitude = firstNumberAfter(source, [
  /(?:\bmagnitude\b|\blength\b|ម៉ូឌុល|រង្វាស់)\s*(?:=|ស្មើ|:|នៃ)?[^\d]*?(\d+(?:\.\d+)?)/i,
]);
const angle = firstNumberAfter(source, [
  /(\d+(?:\.\d+)?)\s*(?:°|\\?circ|degree|ដឺក្រេ)/i,
  /(?:\btheta\b|angle|មុំ)\s*(?:=|ស្មើ|:)?[^\d]*?(\d+(?:\.\d+)?)/i,
]);

console.log("Parsed Magnitude:", magnitude);
console.log("Parsed Angle:", angle);

if (Number.isFinite(magnitude) && Number.isFinite(angle)) {
  const rad = (angle * Math.PI) / 180;
  const vx = Number((magnitude * Math.cos(rad)).toFixed(4));
  const vy = Number((magnitude * Math.sin(rad)).toFixed(4));

  const vxMatches = Array.from(solutionText.matchAll(/\bV_?x\s*(?:=|\\approx)\s*([^$\n]+)/gi)).map(m => m[1]);
  const vyMatches = Array.from(solutionText.matchAll(/\bV_?y\s*(?:=|\\approx)\s*([^$\n]+)/gi)).map(m => m[1]);

  const isValuable = (c) => {
    const normalized = c.trim();
    if (/\\vec|\\cos|\\sin|\\theta|\\times|\\cdot|\*|\|/i.test(normalized)) return false;
    const containsLetters = /[a-zA-Z]/.test(normalized.replace(/\\sqrt|\\frac|\\approx/g, ""));
    if (containsLetters) return false;
    return true;
  };

  const getBestLabel = (candidates, fallback) => {
    const clean = candidates.map(c => c.trim()).filter(isValuable);
    if (!clean.length) return fallback;
    const mathy = clean.find(c => c.includes('\\sqrt') || c.includes('\\frac'));
    if (mathy) return mathy;
    return clean[0];
  };

  const vxLabelRaw = getBestLabel(vxMatches, String(Number(vx.toFixed(2))));
  const vyLabelRaw = getBestLabel(vyMatches, String(Number(vy.toFixed(2))));

  const vxLabel = `V_x = ${vxLabelRaw}`;
  const vyLabel = `V_y = ${vyLabelRaw}`;
  const vLabel = `\\vec{V} = ${magnitude}`;

  const O = [0, 0];
  const Px = [vx, 0];
  const Pxy = [vx, vy];
  const PAngleFrom = [Math.abs(vx) * 0.4 || 1, 0];

  const paddingX = Math.abs(vx) * 0.25 || 2;
  const paddingY = Math.abs(vy) * 0.25 || 2;

  const xMin = vx >= 0 ? -paddingX : vx - paddingX;
  const xMax = vx >= 0 ? vx + paddingX : paddingX;
  const yMin = vy >= 0 ? -paddingY : vy - paddingY;
  const yMax = vy >= 0 ? vy + paddingY : paddingY;

  const spec = {
    diagramType: "geometry",
    shapes: [
      { shape: "polygon", vertices: [O, Px, Pxy], labels: ["", "", ""] },
      { shape: "arrow", start: O, end: Px, label: vxLabel, color: "muted" },
      { shape: "arrow", start: Px, end: Pxy, label: vyLabel, color: "muted" },
      { shape: "arrow", start: O, end: Pxy, label: vLabel, color: "primary" },
      { shape: "angle", vertex: O, from: PAngleFrom, to: Pxy, label: `${angle}°`, radius: 30, color: "red" },
    ],
    options: {
      xMin,
      xMax,
      yMin,
      yMax,
      grid: false,
      showOrigin: true,
      xAxisLabel: "x",
      yAxisLabel: "y"
    }
  };

  console.log("Built Spec:");
  console.log(JSON.stringify(spec, null, 2));
}
