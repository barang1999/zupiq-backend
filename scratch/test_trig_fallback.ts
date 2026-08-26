import { inferTrigUnitCircleBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Trig Unit Circle Fallback Test...");

  const trigProblem = "Draw the unit circle and mark \\theta = \\frac{2\\pi}{3}. Determine the exact values of \\sin \\theta and \\cos \\theta.";
  const trigSolution = `
**ដំណោះស្រាយ**
មុំ \\theta = \\frac{2\\pi}{3} (ឬ 120°)
\\cos\\left(\\frac{2\\pi}{3}\\right) = -\\frac{1}{2}
\\sin\\left(\\frac{2\\pi}{3}\\right) = \\frac{\\sqrt{3}}{2}
  `;

  const trigBlocks = inferTrigUnitCircleBlocks(trigProblem, trigSolution);
  console.log("Blocks output:");
  console.log(JSON.stringify(trigBlocks, null, 2));

  if (
    trigBlocks.length === 1 &&
    trigBlocks[0].spec.mathFamily === "trigonometric" &&
    trigBlocks[0].spec.shapes.some(s => s.shape === "circle" && s.radius === 1) &&
    trigBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label.includes("-\\frac{1}{2}")) &&
    trigBlocks[0].spec.shapes.some(s => s.shape === "angle" && s.label === "\\frac{2\\pi}{3}")
  ) {
    console.log("✅ Trig Unit Circle test PASSED!");
  } else {
    console.error("❌ Trig Unit Circle test FAILED!");
  }
}

runTest();
