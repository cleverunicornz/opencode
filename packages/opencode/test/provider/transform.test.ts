import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "../../src/provider/transform"

const OUTPUT_TOKEN_MAX = 32000

describe("ProviderTransform.options", () => {
  test("merges providerOptions into result", () => {
    const providerOptions = {
      thinking: {
        type: "enabled",
        budgetTokens: 20000,
      },
    }
    const result = ProviderTransform.options(
      "anthropic",
      "claude-opus-4-5",
      "@ai-sdk/anthropic",
      "session-123",
      providerOptions,
    )
    expect(result.thinking).toEqual({
      type: "enabled",
      budgetTokens: 20000,
    })
  })

  test("computed options take precedence over providerOptions", () => {
    const providerOptions = {
      promptCacheKey: "user-provided-key",
    }
    const result = ProviderTransform.options("openai", "gpt-4", "@ai-sdk/openai", "session-123", providerOptions)
    expect(result.promptCacheKey).toBe("session-123")
  })

  test("returns only computed options when providerOptions is undefined", () => {
    const result = ProviderTransform.options("openai", "gpt-4", "@ai-sdk/openai", "session-123")
    expect(result.promptCacheKey).toBe("session-123")
  })
})

describe("ProviderTransform.maxOutputTokens", () => {
  test("returns 32k when modelLimit > 32k", () => {
    const modelLimit = 100000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(OUTPUT_TOKEN_MAX)
  })

  test("returns modelLimit when modelLimit < 32k", () => {
    const modelLimit = 16000
    const result = ProviderTransform.maxOutputTokens("@ai-sdk/openai", {}, modelLimit, OUTPUT_TOKEN_MAX)
    expect(result).toBe(16000)
  })

  describe("azure", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/azure", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/azure", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("bedrock", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/amazon-bedrock", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/amazon-bedrock", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("anthropic without thinking options", () => {
    test("returns 32k when modelLimit > 32k", () => {
      const modelLimit = 100000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit when modelLimit < 32k", () => {
      const modelLimit = 16000
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", {}, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(16000)
    })
  })

  describe("anthropic with thinking options", () => {
    test("returns 32k when budgetTokens + 32k <= modelLimit", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })

    test("returns modelLimit - budgetTokens when budgetTokens + 32k > modelLimit", () => {
      const modelLimit = 50000
      const options = {
        thinking: {
          type: "enabled",
          budgetTokens: 30000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(20000)
    })

    test("returns 32k when thinking type is not enabled", () => {
      const modelLimit = 100000
      const options = {
        thinking: {
          type: "disabled",
          budgetTokens: 10000,
        },
      }
      const result = ProviderTransform.maxOutputTokens("@ai-sdk/anthropic", options, modelLimit, OUTPUT_TOKEN_MAX)
      expect(result).toBe(OUTPUT_TOKEN_MAX)
    })
  })
})
