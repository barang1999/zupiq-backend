import { buildRenderBlocks } from "../utils/render-blocks.js";

function runTest() {
  console.log("Running Bullet Points Preservation Test...");

  const text = `
យើងមាន៖
*   តម្លៃអប្បបរមា (Minimum value) = $4$
*   ក្វាទិលទីមួយ ($Q_1$) = $8$
*   មេដ្យាន (Median ឬ $Q_2$) = $12$
  `;

  const blocks = buildRenderBlocks(text);
  console.log("Parsed Blocks content:");
  console.log(JSON.stringify(blocks, null, 2));

  const hasBulletText = blocks.some(
    (b) => b.type === "text" && b.content.includes("*")
  );

  if (hasBulletText) {
    console.log("✅ Bullet points preservation test PASSED!");
  } else {
    console.error("❌ Bullet points preservation test FAILED!");
  }
}

runTest();
