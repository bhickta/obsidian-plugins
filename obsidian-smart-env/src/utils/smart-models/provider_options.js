export const provider_options = {
  chat_completion_models: [
    {
      label: 'Open Router (cloud)',
      value: 'open_router',
    },
    {
      label: 'LM Studio (local, requires LM Studio app)',
      value: 'lm_studio',
    },
    {
      label: 'Ollama (local, requires Ollama app)',
      value: 'ollama',
    },
    {
      label: 'OpenAI (cloud)',
      value: 'openai',
    },
    {
      label: 'Google Gemini (cloud)',
      value: 'google',
    },
    {
      label: 'Cohere (cloud)',
      value: 'cohere',
    },
    {
      label: 'Groq (cloud)',
      value: 'groq',
    },
    {
      label: 'xAI Grok (cloud)',
      value: 'xai',
    },
    {
      label: 'Anthropic Claude (cloud)',
      value: 'anthropic',
    },
    {
      label: 'Deepseek (cloud)',
      value: 'deepseek',
    },
    {
      label: 'Azure OpenAI (cloud)',
      value: 'azure',
    },
    {
      label: 'Experimental: Lite LLM (self-hosted proxy)',
      value: 'litellm',
    }
  ],
  embedding_models: [
    {
      label: 'Transformers (easy, local, built-in)',
      value: 'transformers',
    },
    {
      label: 'LM Studio (local, requires LM Studio app)',
      value: 'lm_studio',
    },
    {
      label: 'Ollama (local, requires Ollama app)',
      value: 'ollama',
    },
    {
      label: 'OpenAI (cloud)',
      value: 'openai',
    },
    {
      label: 'Google Gemini (cloud)',
      value: 'gemini',
    },
    {
      label: 'Open Router (cloud)',
      value: 'open_router',
    },
  ],
  ranking_models: [
    {
      label: 'Cohere (cloud)',
      value: 'cohere',
    },
  ],
};
