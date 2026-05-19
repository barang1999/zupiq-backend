/**
 * Utility to segment tutoring content into prose and math blocks on the server.
 * This allows the mobile client to skip expensive regex parsing during scroll.
 */

const MATH_TOKEN_REGEX = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\))/g;

function repairBrokenMathDelimiters(content: string): string {
  return `${content ?? ""}`.replace(
    /(?<!\$)\$([^$\n]+?)\$\$\s+\$\$([^$\n]+?)\$(?!\$)/g,
    (_match, first, second) => `$$${first.trim()}$$\n\n$$${second.trim()}$$`
  );
}

export interface MathSegment {
  type: 'text' | 'math';
  content: string;
  display?: boolean;
}

function repairInlineMathNewlines(content: string): string {
  return content.replace(/\$(?!\$)([\s\S]*?)\$(?!\$)/g, (match, inside) => {
    if (inside.includes("\n\n") || !inside.trim() || inside.length > 500) return match;
    if (!inside.includes("\n")) return match;
    return `$${inside.replace(/\r?\n/g, " ")}$`;
  });
}

export function segmentMathContent(content: string): MathSegment[] {
  if (!content || typeof content !== 'string') return [];

  let repairedContent = repairBrokenMathDelimiters(content);
  repairedContent = repairInlineMathNewlines(repairedContent);

  // Split by the math tokens
  const parts = repairedContent.split(MATH_TOKEN_REGEX);
  const segments: MathSegment[] = [];

  parts.forEach((part, index) => {
    if (!part) return;

    if (index % 2 === 0) {
      // Prose segment
      segments.push({
        type: 'text',
        content: part
      });
    } else {
      // Math segment - unwrap delimiters
      let display = false;
      let latex = part;

      if (part.startsWith('$$') && part.endsWith('$$')) {
        display = true;
        latex = part.slice(2, -2);
      } else if (part.startsWith('$') && part.endsWith('$')) {
        display = false;
        latex = part.slice(1, -1);
      } else if (part.startsWith('\\[') && part.endsWith('\\]')) {
        display = true;
        latex = part.slice(2, -2);
      } else if (part.startsWith('\\(') && part.endsWith('\\)')) {
        display = false;
        latex = part.slice(2, -2);
      }

      segments.push({
        type: 'math',
        content: latex.trim(),
        display
      });
    }
  });

  return segments;
}
