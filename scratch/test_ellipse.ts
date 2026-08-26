import { inferEllipseBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Ellipse Fallback Test...");

  const ellipseProblem = "Sketch \\frac{x^2}{25} + \\frac{y^2}{9} = 1. Label the center, major axis, minor axis, vertices, and co-vertices.";
  const ellipseSolution = `
**ដំណោះស្រាយ**
សមីការអេលីបគឺ \\frac{x^2}{25} + \\frac{y^2}{9} = 1
ចំណុចកណ្តាល: (0,0)
កំពូល: (5,0) និង (-5,0)
ចំណុចចុងអ័ក្សតូច: (0,3) និង (0,-3)
  `;

  const blocks = inferEllipseBlocks(ellipseProblem, ellipseSolution);
  console.log("Blocks output:");
  console.log(JSON.stringify(blocks, null, 2));

  if (
    blocks.length === 1 &&
    blocks[0].diagramType === "geometry" &&
    blocks[0].spec.shapes.some(s => s.shape === "ellipse" && s.rx === 5 && s.ry === 3) &&
    blocks[0].spec.shapes.some(s => s.shape === "point" && s.labels.includes("V_1 (5,0)"))
  ) {
    console.log("✅ Ellipse test PASSED!");
  } else {
    console.error("❌ Ellipse test FAILED!");
  }
}

runTest();
