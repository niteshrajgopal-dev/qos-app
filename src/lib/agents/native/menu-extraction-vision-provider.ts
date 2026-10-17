import type { NativeModelConfig } from "@/lib/agents/native/native-model-config";
import { redactOpenAiSecrets } from "@/lib/agents/native/openai-redaction";
import { menuExtractionResultJsonSchema } from "@/lib/catalogue/menu-extraction/result";

export type MenuExtractionVisionPage = {
  pageNumber: number;
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  width: number;
  height: number;
};

export type MenuExtractionVisionRequest = {
  modelId: string;
  correlationId?: string;
  instructions: string;
  input: string;
  pages: readonly MenuExtractionVisionPage[];
};

export type MenuExtractionVisionResult = {
  text: string;
  usage: Record<string, number> | null;
};

export type MenuExtractionVisionProvider = {
  readonly kind: "openai" | "mock";
  complete(request: MenuExtractionVisionRequest): Promise<MenuExtractionVisionResult>;
};

export function createOpenAiMenuExtractionVisionProvider(
  config: NativeModelConfig,
): MenuExtractionVisionProvider {
  if (config.provider !== "openai" || !config.openAiApiKey) {
    throw new Error("OpenAI vision provider is not configured.");
  }

  const responseJsonSchema = menuExtractionResultJsonSchema();

  return {
    kind: "openai",
    async complete(request) {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({
        apiKey: config.openAiApiKey,
        maxRetries: 0,
        timeout: 120_000,
      });

      const userContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string; detail: "high" } }
      > = [{ type: "text", text: request.input }];

      for (const page of request.pages) {
        userContent.push({
          type: "text",
          text: `Page ${page.pageNumber} (${page.width}x${page.height}).`,
        });
        userContent.push({
          type: "image_url",
          image_url: {
            url: `data:${page.mimeType};base64,${page.base64}`,
            detail: "high",
          },
        });
      }

      try {
        const response = await client.chat.completions.create({
          model: request.modelId,
          messages: [
            { role: "system", content: request.instructions },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "menu_extraction_result",
              strict: true,
              schema: responseJsonSchema,
            },
          },
        });
        const text = response.choices[0]?.message?.content ?? "";
        const usage = response.usage
          ? {
              input_tokens: response.usage.prompt_tokens ?? 0,
              output_tokens: response.usage.completion_tokens ?? 0,
              total_tokens: response.usage.total_tokens ?? 0,
            }
          : null;
        return { text, usage };
      } catch (error) {
        const message = redactOpenAiSecrets(
          error instanceof Error ? error.message : "Vision request failed.",
        );
        throw new Error(message);
      }
    },
  };
}

let visionOverride: MenuExtractionVisionProvider | null = null;

export function setMenuExtractionVisionProviderForTesting(
  provider: MenuExtractionVisionProvider | null,
) {
  visionOverride = provider;
}

export function getMenuExtractionVisionProvider(
  config: NativeModelConfig,
): MenuExtractionVisionProvider {
  if (visionOverride) {
    return visionOverride;
  }
  if (config.provider === "mock") {
    throw new Error("Mock vision provider must be injected in tests.");
  }
  return createOpenAiMenuExtractionVisionProvider(config);
}
