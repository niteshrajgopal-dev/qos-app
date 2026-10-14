/** Labeled OpenAI chat completion fixtures for adapter contract tests (no network). */

export const FIXTURE_OPENAI_COMPLETED = {
  id: "chatcmpl-fixture",
  object: "chat.completion",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: '{"ok":true}' },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
};

export const FIXTURE_OPENAI_RATE_LIMITED = {
  error: { message: "rate limited", type: "rate_limit", code: "rate_limit_exceeded" },
};

export const FIXTURE_OPENAI_INVALID_EMPTY = {
  id: "chatcmpl-empty",
  object: "chat.completion",
  choices: [],
  usage: null,
};
