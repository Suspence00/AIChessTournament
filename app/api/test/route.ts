import { NextRequest } from "next/server";
import { streamText } from "ai";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const gatewayKey =
    process.env.AI_GATEWAY_API_KEY ||
    process.env.AI_GATEWAY_TOKEN ||
    process.env.OPENAI_API_KEY;

export async function GET(req: NextRequest) {
    console.log("=== AI Gateway Test ===");
    console.log("API Key present:", !!gatewayKey);
    console.log("API Key prefix:", gatewayKey?.substring(0, 10) + "...");

    if (!gatewayKey) {
        return new Response(
            JSON.stringify({
                error: "Missing API key",
                checked: ["AI_GATEWAY_API_KEY", "AI_GATEWAY_TOKEN", "OPENAI_API_KEY"]
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    const testModel = "openai/gpt-4o-mini";
    const testPrompt = "Say only the word 'e2e4' and nothing else.";

    try {
        console.log(`Testing model: ${testModel}`);
        console.log(`Prompt: ${testPrompt}`);

        const { textStream } = await streamText({
            model: testModel,
            prompt: testPrompt,
            temperature: 0.7
        });

        let response = "";
        for await (const chunk of textStream) {
            response += chunk;
        }

        console.log(`Response: "${response}"`);

        return new Response(
            JSON.stringify({
                success: true,
                model: testModel,
                prompt: testPrompt,
                response: response.trim(),
                keyPresent: true
            }),
            { headers: { "Content-Type": "application/json" } }
        );
    } catch (err: any) {
        console.error("Test failed:", err);
        return new Response(
            JSON.stringify({
                error: err.message || String(err),
                model: testModel,
                stack: err.stack
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
