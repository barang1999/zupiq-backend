const { normalizeDiagramBlocks } = require("/Users/balehuy/Documents/zupiq/zupiq-backend/dist/utils/diagram-blocks.js");

const problem = `ការស្ទង់មតិមួយបង្ហាញថាៈ
*   $40\\%$ ចូលចិត្តគណិតវិទ្យា
*   $30\\%$ ចូលចិត្តវិទ្យាសាស្ត្រ
*   $20\\%$ ចូលចិត្តភាសាអង់គ្លេស
*   $10\\%$ ចូលចិត្តប្រវត្តិវិទ្យា

គូរគំនូសតាងចំណិតនំ។
គំនូសតាងដែលត្រូវការៈ
*   ចំណិតរង្វង់
*   ស្លាកភាគរយ`;

const finalAnswer = `មុំសម្រាប់ចំណិតនីមួយៗនៃគំនូសតាងចំណិតនំគឺៈ
*   គណិតវិទ្យា (Math): $144^\\circ$
*   វិទ្យាសាស្ត្រ (Science): $108^\\circ$
*   ភាសាអង់គ្លេស (English): $72^\\circ$
*   ប្រវត្តិវិទ្យា (History): $36^\\circ$`;

const problemText = `A survey shows:
*   40% like Math
*   30% like Science
*   20% like English
*   10% like History`;

const solutionText = `ដើម្បីគូរគំនូសតាងចំណិតនំ ...`;

function normalizeDigits(input) {
  const KHMER_DIGITS = {
    "០": "0", "១": "1", "២": "2", "៣": "3", "៤": "4",
    "៥": "5", "៦": "6", "៧": "7", "៨": "8", "៩": "9"
  };
  return `${input ?? ""}`.replace(/[០-៩]/g, (digit) => KHMER_DIGITS[digit] ?? digit);
}

function inferPieChartBlocks(problem, finalAnswer, solutionText) {
  const source = normalizeDigits(`${problem}\n${finalAnswer}\n${solutionText}`);
  const isPieChart = /(pie.?chart|piechart|តារាងចំណិតជុំ|ចំណិតជុំ|រង្វង់ចំណិត|ចំណិតនំ)/i.test(source);

  const sectors = [];
  const lines = source.split("\n");
  for (const line of lines) {
    if (line.includes(",") || (line.match(/%/g) || []).length > 1) {
      continue;
    }

    // 1. Try format: <Label> : <Percentage>%   or   <Label> : <something> ( <Percentage>% )
    const match1 = line.match(/(?:[*+-]|\b)\s*([^:\n]+?)\s*:\s*(?:[^%]*?\(\s*([^)]*?\s+|)(\d+(?:\.\d+)?)\s*\\?%|[^%]*?(\d+(?:\.\d+)?)\s*\\?%)/);
    if (match1) {
      const label = match1[1].replace(/[$*{}]/g, "").trim();
      const pctVal = parseFloat(match1[3] ?? match1[4]);
      if (label && Number.isFinite(pctVal) && pctVal > 0 && pctVal <= 100) {
        if (!/^(min|max|q1|q2|q3|minimum|maximum|total|ភាគរយសរុប|មុំសរុប|មុំ|មេដ្យាន)$/i.test(label)) {
          const dupIdx = sectors.findIndex((s) => {
            const labelOverlap = s.label.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(s.label.toLowerCase());
            const pctMatch = s.percentage === pctVal;
            return labelOverlap || pctMatch;
          });
          if (dupIdx !== -1) {
            const existingHasKhmer = /[\u1780-\u17FF]/.test(sectors[dupIdx].label);
            const newHasKhmer = /[\u1780-\u17FF]/.test(label);
            if (newHasKhmer && !existingHasKhmer) {
              sectors[dupIdx].label = label;
            } else if (newHasKhmer === existingHasKhmer) {
              if (label.length < sectors[dupIdx].label.length) {
                sectors[dupIdx].label = label;
              }
            }
          } else {
            sectors.push({ label, percentage: pctVal });
          }
          continue;
        }
      }
    }

    // 2. Try format: <Percentage>% like <Label>  or  <Percentage>% <Label>
    const match2 = line.match(/(?:[*+-]|\b)\s*(\d+(?:\.\d+)?)\s*\\?%\s*(?:like\s+|of\s+|)\s*([^\n]+)/i);
    if (match2) {
      const pctVal = parseFloat(match2[1]);
      let label = match2[2].replace(/[$*{}]/g, "").trim();
      label = label.replace(/^(like|of)\s+/i, "");
      if (label && Number.isFinite(pctVal) && pctVal > 0 && pctVal <= 100) {
        if (!/^(min|max|q1|q2|q3|minimum|maximum|total|ភាគរយសរុប|មុំសរុប|មុំ|មេដ្យាន)$/i.test(label)) {
          const dupIdx = sectors.findIndex((s) => {
            const labelOverlap = s.label.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(s.label.toLowerCase());
            const pctMatch = s.percentage === pctVal;
            return labelOverlap || pctMatch;
          });
          if (dupIdx !== -1) {
            const existingHasKhmer = /[\u1780-\u17FF]/.test(sectors[dupIdx].label);
            const newHasKhmer = /[\u1780-\u17FF]/.test(label);
            if (newHasKhmer && !existingHasKhmer) {
              sectors[dupIdx].label = label;
            } else if (newHasKhmer === existingHasKhmer) {
              if (label.length < sectors[dupIdx].label.length) {
                sectors[dupIdx].label = label;
              }
            }
          } else {
            sectors.push({ label, percentage: pctVal });
          }
          continue;
        }
      }
    }
  }

  console.log("Parsed Sectors:", sectors);
  const totalPercentage = sectors.reduce((sum, s) => sum + s.percentage, 0);
  if (sectors.length >= 2 && totalPercentage >= 90 && totalPercentage <= 110) {
    return normalizeDiagramBlocks([{
      diagramType: "pie-chart",
      spec: {
        sectors
      }
    }]);
  }

  return [];
}

const result = inferPieChartBlocks(`${problem}\n${problemText}`, finalAnswer, solutionText);
console.log("Inferred Diagram Blocks:", JSON.stringify(result, null, 2));
