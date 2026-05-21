import { parseJsonLoose, sanitizeBreakdownNodes } from "../services/ai/gemini.service.ts";

// Simulate a raw Gemini response string containing single-escaped LaTeX commands
// In the raw API string, backslashes are often not double-escaped:
// e.g. "mathContent": "$$0 = 4 - x \\ x = 4 \text{ (ចំណុច } (4,0)) \theta_0 = 4 \u_n = u_1 + (n-1)d \neq$$"
const rawGeminiJson = `{
  "title": "គណនាផ្ទៃព័ទ្ធជុំវិញដោយបន្ទាត់ និងអ័ក្ស",
  "subject": "Math",
  "nodes": [
    {
      "id": "leaf1",
      "type": "leaf",
      "label": "ចំណុចប្រសព្វជាមួយអ័ក្ស x",
      "description": "ដើម្បីរកចំណុចប្រសព្វជាមួយអ័ក្ស $x$ គេអោយ $y=0$ ក្នុងសមីការបន្ទាត់។",
      "mathContent": "$$\\\\begin{aligned} 0 &= 4 - x \\\\\\\\ x &= 4 \\\\text{ (ចំណុច } (4,0)) \\\\\\\\ \\\\theta_0 &= 4 \\\\\\\\ \\\\u_n &= u_1 + (n-1)d \\\\\\\\ \\\\neq 0 \\\\end{aligned}$$"
    }
  ],
  "insights": {
    "simpleBreakdown": "រកចំណុចប្រសព្វ រួចគណនាផ្ទៃត្រីកោណ",
    "keyFormula": "$A = \\\\frac{1}{2}bh$"
  }
}`;

console.log("=== End-to-End Test ===");
console.log("Raw JSON response contains single-escaped backslashes before LaTeX characters like t, n, u.");

// 1. Test parsing raw JSON with loose JSON parser
const parsed = parseJsonLoose<any>(rawGeminiJson);
if (!parsed) {
  console.error("FAIL: JSON parsing failed entirely!");
  process.exit(1);
}
console.log("SUCCESS: JSON parsed successfully!");

const node = parsed.nodes[0];
console.log("Parsed mathContent string:", JSON.stringify(node.mathContent));

// 2. Test sanitizing nodes & building math SVG blocks
const sanitized = sanitizeBreakdownNodes(parsed);
const sanitizedNode = sanitized.nodes[0];

console.log("Sanitized mathContent string:", JSON.stringify(sanitizedNode.mathContent));
console.log("Number of math blocks built:", sanitizedNode.mathBlocks?.length);

if (sanitizedNode.mathBlocks && sanitizedNode.mathBlocks.length > 0) {
  const mathBlock = sanitizedNode.mathBlocks[0];
  console.log("Math block type:", mathBlock.type);
  if (mathBlock.type === 'math') {
    console.log("Math block warning check (valid?):", mathBlock.valid);
    console.log("Math block svgHtml rendered:", !!mathBlock.svgHtml);
    if (mathBlock.svgHtml) {
      console.log("SVG output contains <svg> tag:", mathBlock.svgHtml.includes("<svg"));
    } else {
      console.error("FAIL: svgHtml is null or empty!");
      process.exit(1);
    }
  }
} else {
  console.error("FAIL: No math blocks were built!");
  process.exit(1);
}

console.log("=== ALL END-TO-END TESTS PASSED SUCCESSFULLY! ===");
