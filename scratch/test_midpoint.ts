import { inferMidpointSegmentBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Midpoint Segment Fallback Test...");

  const problem = "6. Coordinate Geometry – Midpoint Given A(-2, 3), B(6, 7), plot the points, draw \\overline{AB}, and find the midpoint.";
  const solution = `
**ដំណោះស្រាយ**
យើងមានចំណុច A(-2, 3) និង B(6, 7)។
តាមរូបមន្តចំណុចកណ្តាល គឺ M(2, 5)។
  `;
  const finalAnswer = "$M(2, 5)$";

  const blocks = inferMidpointSegmentBlocks(problem, solution, [], finalAnswer);
  console.log("Blocks output:");
  console.log(JSON.stringify(blocks, null, 2));

  if (
    blocks.length === 1 &&
    blocks[0].diagramType === "geometry" &&
    blocks[0].spec.shapes.some(s => s.shape === "line" && s.start[0] === -2 && s.start[1] === 3 && s.end[0] === 6 && s.end[1] === 7) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("A(-2, 3)")) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("B(6, 7)")) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("M(2, 5)") && s.color === "red")
  ) {
    console.log("✅ Midpoint Segment fallback test PASSED!");
  } else {
    console.error("❌ Midpoint Segment fallback test FAILED!");
  }
}

runTest();
