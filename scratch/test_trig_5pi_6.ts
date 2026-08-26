import { inferTrigUnitCircleBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Trig Unit Circle 5pi/6 Fallback Test...");

  const trigProblem = "Mark \\theta = \\frac{5\\pi}{6} on the unit circle and determine \\sin \\theta and \\cos \\theta.";
  const trigSolution = `
យើងមានមុំ \\theta = \\frac{5\\pi}{6}។

ដើម្បីកំណត់តម្លៃ \\sin \\theta និង \\cos \\theta សម្រាប់មុំនេះ យើងអាចធ្វើតាមជំហានដូចខាងក្រោម៖
\\sin\\left(\\frac{5\\pi}{6}\\right) = \\frac{1}{2}
\\cos\\left(\\frac{5\\pi}{6}\\right) = -\\frac{\\sqrt{3}}{2}
  `;

  const trigBlocks = inferTrigUnitCircleBlocks(trigProblem, trigSolution);
  console.log("Blocks output:");
  console.log(JSON.stringify(trigBlocks, null, 2));
}

runTest();
