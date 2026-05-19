// Dummy test of the quadratic function parser
const test1 = "y = x^2 - 6x + 5";
const test2 = "y = -x^2 + 4";
const test3 = "y = 2x^2 + 4x + 1";

function parseQuadratic(source: string) {
  const qMatch = source.match(
    /=\s*([+-]?\s*\d*(?:\.\d+)?)\s*[a-z]\^2\s*(?:([+-]\s*\d*(?:\.\d+)?)\s*[a-z])?(?:\s*([+-]\s*\d+(?:\.\d+)?))?(?!\s*[a-z])/i
  );
  if (!qMatch) return null;

  const rawA = (qMatch[1] ?? "").replace(/\s/g, "");
  const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : parseFloat(rawA);

  const b = qMatch[2] !== undefined
    ? (() => {
        const rawB = qMatch[2].replace(/\s/g, "");
        return rawB === "" || rawB === "+" ? 1 : rawB === "-" ? -1 : parseFloat(rawB);
      })()
    : 0;

  const c = qMatch[3] ? parseFloat(qMatch[3].replace(/\s/g, "")) : 0;

  return { a, b, c };
}

console.log("TEST 1:", parseQuadratic(test1));
console.log("TEST 2:", parseQuadratic(test2));
console.log("TEST 3:", parseQuadratic(test3));
