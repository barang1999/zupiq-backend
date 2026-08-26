import { inferWeightedGraphBlocks } from "../services/ai/gemini.service.js";

function runTest() {
  console.log("Running Weighted Graph Fallback Test...");

  const problem = "20. Graph Theory – Weighted Graph Four cities A, B, C, D are connected with distances: AB = 4, AC = 7, BC = 2, BD = 5, CD = 3. Draw the weighted graph and find the shortest path from A to D.";
  const solutionText = `
យើងមានៈ
ទីក្រុងចំនួនបួន A, B, C, D តភ្ជាប់ដោយចម្ងាយដូចខាងក្រោម៖
AB = 4
AC = 7
BC = 2
BD = 5
CD = 3
  `;

  const blocks = inferWeightedGraphBlocks(problem, solutionText);
  console.log("Inferred Blocks:");
  console.log(JSON.stringify(blocks, null, 2));

  if (blocks.length > 0 && blocks[0].diagramType === "geometry") {
    console.log("✅ Weighted graph fallback test PASSED!");
  } else {
    console.error("❌ Weighted graph fallback test FAILED!");
  }
}

runTest();
