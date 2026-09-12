import { describe, it } from "vitest";
import { buildRenderBlocks } from "./render-blocks.js";
import { writeFileSync } from "fs";

describe("_bullet_probe", () => {
  it("check section 6 bullet list rendering", () => {
    const section6 = "**៦. ក្រាបនៃអនុគមន៍**\n- ក្រាបមានអាស៊ីមតូតឈរគឺបន្ទាត់ $x = 0$ (អ័ក្សអរដោនេ)។\n- ក្រាបកាត់តាមចំណុច $A(1, 0)$។\n- កាលណា $x \\to 0^+$ ក្រាបខិតជិតអាស៊ីមតូតឈរ $x = 0$ ទៅរក $-\\infty$។\n- កាលណា $x \\to +\\infty$ ក្រាបកើនឡើងទៅរក $+\\infty$។";
    const blocks = buildRenderBlocks(section6);
    writeFileSync("/tmp/_bullet_blocks.json", JSON.stringify(blocks, null, 2));
    blocks.forEach((b: any, i: number) => {
      console.log(i, b.type, b.type === 'math' ? JSON.stringify(b.latex) : JSON.stringify(b.content));
    });
  });
});
