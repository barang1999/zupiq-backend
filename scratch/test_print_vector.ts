import { inferVectorRightTriangleBlocks } from "../services/ai/gemini.service.ts";

const vectorProblem = "A vector has magnitude 10 and forms an angle of 30° with the positive x-axis. Draw the vector and its horizontal and vertical components.";
const vectorSolution = "សមាសធាតុដេក $V_x = 5\\sqrt{3}$ (ប្រហែល 8.66) និងសមាសធាតុឈរគឺ $5$ ។";
const vectorBlocks = inferVectorRightTriangleBlocks(vectorProblem, vectorSolution);

console.log(JSON.stringify(vectorBlocks, null, 2));
