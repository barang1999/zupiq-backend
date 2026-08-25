import { inferSolidGeometryBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running fallback inference tests...");

  // 1. Cylinder test (the user's scenario)
  const cylinderProblem = "A cylinder has radius 4 cm and height 10 cm. Draw and label the cylinder, then calculate its volume.";
  const cylinderBlocks = inferSolidGeometryBlocks(cylinderProblem, "");
  console.log("\nCylinder Test:");
  console.log(JSON.stringify(cylinderBlocks, null, 2));

  if (
    cylinderBlocks.length === 1 &&
    cylinderBlocks[0].spec.shape === "cylinder" &&
    cylinderBlocks[0].spec.params.r === 4 &&
    cylinderBlocks[0].spec.params.h === 10
  ) {
    console.log("✅ Cylinder test PASSED!");
  } else {
    console.error("❌ Cylinder test FAILED!");
  }

  // 2. Cuboid space diagonal test
  const cuboidProblem = "គណនាប្រវែងអង្កត់ទ្រូងលំហនៃប្រអប់គូបូអ៊ីតដែលមាន length = 8, width = 6, height = 3 cm";
  const cuboidBlocks = inferSolidGeometryBlocks(cuboidProblem, "");
  console.log("\nCuboid Test:");
  console.log(JSON.stringify(cuboidBlocks, null, 2));

  if (
    cuboidBlocks.length === 1 &&
    cuboidBlocks[0].spec.shape === "cuboid" &&
    cuboidBlocks[0].spec.params.l === 8 &&
    cuboidBlocks[0].spec.params.w === 6 &&
    cuboidBlocks[0].spec.params.h === 3
  ) {
    console.log("✅ Cuboid test PASSED!");
  } else {
    console.error("❌ Cuboid test FAILED!");
  }

  // 3. Cone test
  const coneProblem = "កោនមានកាំ r = 3 cm និងកម្ពស់ h = 12 cm";
  const coneBlocks = inferSolidGeometryBlocks(coneProblem, "");
  console.log("\nCone Test:");
  console.log(JSON.stringify(coneBlocks, null, 2));

  if (
    coneBlocks.length === 1 &&
    coneBlocks[0].spec.shape === "cone" &&
    coneBlocks[0].spec.params.r === 3 &&
    coneBlocks[0].spec.params.h === 12
  ) {
    console.log("✅ Cone test PASSED!");
  } else {
    console.error("❌ Cone test FAILED!");
  }
}

runTest();
