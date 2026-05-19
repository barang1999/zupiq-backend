import { getGeminiClient } from "../services/ai/core/client.js";

async function testConfig() {
  try {
    const client = getGeminiClient();
    const response = await client.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        temperature: 0.2,
        frequencyPenalty: 0.35,
        presencePenalty: 0.35,
      },
      contents: "Hello! Just say OK."
    });
    console.log("SUCCESS:", response.text);
  } catch (err) {
    console.error("FAILED:", err);
  }
}

testConfig();
