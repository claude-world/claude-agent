/**
 * Language rules for system prompts and message prefixes.
 * Extracted from agent.ts for reuse across modules.
 */

/** Full language rules — injected into system prompt */
export const LANG_RULES_FULL: Record<string, string> = {
  en: "You MUST respond in English only. This is a hard requirement.",
  "zh-TW": "你必須使用繁體中文（Traditional Chinese）回覆。禁止使用簡體中文。這是最高優先級的規則。",
  ja: "必ず日本語で回答してください。これは最優先のルールです。",
};

/** Short language rules — prepended to each user message */
export const LANG_RULES_SHORT: Record<string, string> = {
  en: "IMPORTANT: Respond in English only.",
  "zh-TW": "重要：必須使用繁體中文回覆，禁止使用簡體中文。",
  ja: "重要：日本語のみで回答してください。",
};
