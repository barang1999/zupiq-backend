import { inferVennDiagramBlocks } from "../services/ai/gemini.service.ts";

function runTest() {
  console.log("Running Venn Fallback Test...");

  const vennProblem = "In a group of 40 students, 23 study English, 18 study French, and 9 study both. Draw a Venn diagram and find how many study neither.";
  const vennSolution = `
យើងមាន៖
ចំនួនសិស្សសរុប |U| = 40
ចំនួនសិស្សរៀនភាសាអង់គ្លេស |E| = 23
ចំនួនសិស្សរៀនភាសាបារាំង |F| = 18
ចំនួនសិស្សរៀនទាំងពីរ |E ∩ F| = 9

ចំនួនសិស្សមិនរៀនទាំងពីរ = 8
  `;

  const mockEmptyBlocks = [{
    diagramType: "venn-diagram",
    spec: {
      sets: [
        { label: "E" },
        { label: "F" }
      ]
    }
  }];
  const vennBlocks = inferVennDiagramBlocks(vennProblem, vennSolution, mockEmptyBlocks as any);
  console.log("Venn Blocks output:");
  console.log(JSON.stringify(vennBlocks, null, 2));

  if (
    vennBlocks.length === 1 &&
    vennBlocks[0].diagramType === "venn-diagram" &&
    vennBlocks[0].spec.universalTotal === 40 &&
    vennBlocks[0].spec.regions.neither === 8
  ) {
    console.log("✅ Venn Fallback test PASSED!");
  } else {
    console.error("❌ Venn Fallback test FAILED!");
  }
}

runTest();
