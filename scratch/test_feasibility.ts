import { inferInequalityFeasibleRegionBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Feasible Region Fallback Test...");

  const problem = "Graph x+y \\le 6, x \\ge 1, y \\ge 2. Shade the feasible region and identify all of its vertices.";
  const solution = `
**ដំណោះស្រាយ**
វិសមភាពទាំងបី៖
1. x+y \\le 6
2. x \\ge 1
3. y \\ge 2
ចំណុចកំពូលនៃតំបន់ដែលអាចធ្វើទៅបានគឺ: (1,2), (1,5), (4,2)
  `;
  const finalAnswer = "$(1,2)$, $(1,5)$ និង $(4,2)$";

  const blocks = inferInequalityFeasibleRegionBlocks(problem, solution, [], finalAnswer);
  console.log("Blocks output:");
  console.log(JSON.stringify(blocks, null, 2));

  if (
    blocks.length === 1 &&
    blocks[0].diagramType === "geometry" &&
    blocks[0].spec.shapes.some(s => s.shape === "polygon") &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("(1,2)")) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("(1,5)")) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("(4,2)")) &&
    blocks[0].spec.options.grid === true &&
    blocks[0].spec.options.showOrigin === true
  ) {
    console.log("✅ Feasible Region test PASSED!");
  } else {
    console.error("❌ Feasible Region test FAILED!");
  }
}

runTest();
