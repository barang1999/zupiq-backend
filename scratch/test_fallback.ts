import { inferSolidGeometryBlocks, inferVectorRightTriangleBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running fallback inference tests...");

  // 1. Cylinder test
  const cylinderProblem = "A cylinder has radius 4 cm and height 10 cm. Draw and label the cylinder, then calculate its volume.";
  const cylinderBlocks = inferSolidGeometryBlocks(cylinderProblem, "");
  console.log("\nCylinder Test:");
  if (
    cylinderBlocks.length === 1 &&
    cylinderBlocks[0].spec.shape === "cylinder" &&
    cylinderBlocks[0].spec.params.r === 4 &&
    cylinderBlocks[0].spec.params.h === 10
  ) {
    console.log("✅ Cylinder test PASSED!");
  } else {
    console.error("❌ Cylinder test FAILED!", JSON.stringify(cylinderBlocks, null, 2));
  }

  // 2. Vector Magnitude and Angle (Type B) Test
  const vectorProblem = "A vector has magnitude 10 and forms an angle of 30° with the positive x-axis. Draw the vector and its horizontal and vertical components.";
  const vectorSolution = "សមាសធាតុដេក $V_x = 5\\sqrt{3}$ (ប្រហែល 8.66) និងសមាសធាតុឈរគឺ $5$ ។";
  const vectorBlocks = inferVectorRightTriangleBlocks(vectorProblem, vectorSolution);
  console.log("\nVector Magnitude/Angle Test:");
  
  if (
    vectorBlocks.length === 1 &&
    vectorBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "V_x = 5\\sqrt{3}") &&
    vectorBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "V_y = 5") &&
    vectorBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "\\vec{V} = 10") &&
    vectorBlocks[0].spec.shapes.some(s => s.shape === "angle" && s.label === "30°")
  ) {
    console.log("✅ Vector Magnitude/Angle test PASSED!");
  } else {
    console.error("❌ Vector Magnitude/Angle test FAILED!", JSON.stringify(vectorBlocks, null, 2));
  }

  // 3. Forces Right Triangle (Type A) Test
  const forceProblem = "A force of 3 N acts East and a force of 4 N acts North. Draw the resultant force.";
  const forceBlocks = inferVectorRightTriangleBlocks(forceProblem, "");
  console.log("\nForce Right Triangle Test:");

  if (
    forceBlocks.length === 1 &&
    forceBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "3 N (East)") &&
    forceBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "4 N (North)") &&
    forceBlocks[0].spec.shapes.some(s => s.shape === "arrow" && s.label === "5 N (Resultant)")
  ) {
    console.log("✅ Force Right Triangle test PASSED!");
  } else {
    console.error("❌ Force Right Triangle test FAILED!", JSON.stringify(forceBlocks, null, 2));
  }
}

runTest();
