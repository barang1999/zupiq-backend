import { solveFromImageDirect } from "../services/ai/gemini.service";

// Dummy test of the exponential growth function parser
const problem = "A population follows:\n$P(t) = 500(1.08)^t$\n1. Find population after 5 years.\n2. Sketch the graph.";
const solutionText = `យើងមានអនុគមន៍ចំនួនប្រជាជនដូចខាងក្រោមៈ
$$P(t) = 500(1.08)^t$$

**1. ស្វែងរកចំនួនប្រជាជនបន្ទាប់ពី 5 ឆ្នាំ។**
យើងជំនួស t=5: P(5) = 500 * (1.08)^5 ≈ 735.
**2. គូសក្រាហ្វ។**`;

function firstNumberAfter(source: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

const source = `${problem}\n${solutionText}`.replace(/\s+/g, " ");

const expoMatch = source.match(
  /(?:([a-z]+)\s*\(\s*([a-z])\s*\)|([a-z]+))\s*=\s*(\d+(?:\.\d+)?)\s*(?:\*|\\times|\\cdot|\\s*|\s*)\(?\s*(\d+(?:\.\d+)?)\s*\)?\^(?:([a-z])|\{([a-z])\})/i
);

console.log("EXPO MATCH FOUND:", !!expoMatch);
if (expoMatch) {
  console.log("yAxisLabel:", expoMatch[1] || expoMatch[3]);
  console.log("xAxisLabel:", expoMatch[2] || expoMatch[6] || expoMatch[7]);
  console.log("a (initial):", parseFloat(expoMatch[4]));
  console.log("b (base):", parseFloat(expoMatch[5]));
  
  const a = parseFloat(expoMatch[4]);
  const b = parseFloat(expoMatch[5]);
  const targetVal = firstNumberAfter(source, [
    /(?:after|បន្ទាប់ពី|រយៈពេល)\s*(\d+(?:\.\d+)?)\s*(?:years|months|days|hours|ឆ្នាំ|ខែ|ថ្ងៃ|ម៉ោង)/i,
    /(\d+(?:\.\d+)?)\s*(?:years|months|days|hours|ឆ្នាំ|ខែ|ថ្ងៃ|ម៉ោង)/i,
  ]) || 5;
  console.log("parsed targetVal:", targetVal);
  console.log("domainMax:", Math.max(8, Math.ceil(targetVal * 1.6)));
  console.log("value at 5:", a * Math.pow(b, 5));
}
