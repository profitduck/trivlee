// Quick test to see what error Anthropic returns when we ask Sonnet to use web_search.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

try {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "You are a helpful assistant. Use web_search to verify facts.",
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        allowed_domains: ["wikipedia.org"],
        max_uses: 1,
      },
    ],
    messages: [
      {
        role: "user",
        content: "What year was the Always Sunny in Philadelphia TV show first aired?",
      },
    ],
  });
  console.log("SUCCESS");
  console.log("Content blocks:", response.content.map((b) => b.type));
  const textBlock = response.content.filter((b) => b.type === "text").pop();
  console.log("Final text:", textBlock?.text?.slice(0, 300));
} catch (err) {
  console.log("ERROR:");
  console.log("  status:", err?.status);
  console.log("  message:", err?.message);
  console.log("  error:", JSON.stringify(err?.error, null, 2));
}
