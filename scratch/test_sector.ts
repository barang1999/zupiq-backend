import { inferSectorBlocks, inferTrigUnitCircleBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Sector Fallback Test...");

  const problem = "A circle has radius 6 cm and central angle 120°. Draw the sector and find its area.";
  const solution = `
**ដំណោះស្រាយ**
កាំនៃរង្វង់ r = 6 cm
មុំផ្ចិត \\theta = 120^\\circ
  `;

  // 1. Verify trig unit circle fallback does NOT trigger (since sector keyword is present)
  const trigCircleBlocks = inferTrigUnitCircleBlocks(problem, solution, []);
  console.log("Trig Unit Circle output length (should be 0):", trigCircleBlocks.length);

  // 2. Verify sector fallback triggers and returns valid spec
  const sectorBlocks = inferSectorBlocks(problem, solution, []);
  console.log("Sector Blocks output:");
  console.log(JSON.stringify(sectorBlocks, null, 2));

  if (
    trigCircleBlocks.length === 0 &&
    sectorBlocks.length === 1 &&
    sectorBlocks[0].diagramType === "geometry" &&
    sectorBlocks[0].spec.shapes.some(s => s.shape === "sector" && s.radius === 1 && s.endAngle === 120 && s.label === "120^\\circ") &&
    sectorBlocks[0].spec.shapes.some(s => s.shape === "line" && s.label === "6 cm")
  ) {
    console.log("✅ Sector fallback test PASSED!");
  } else {
    console.error("❌ Sector fallback test FAILED!");
  }
}

runTest();
