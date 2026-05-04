import base from 'smart-models/collections/chat_completion_models.js';
import anthropic from 'smart-models/adapters/chat-completion/anthropic.js';
import azure from 'smart-models/adapters/chat-completion/azure.js';
import cohere from 'smart-models/adapters/chat-completion/cohere.js';
import deepseek from 'smart-models/adapters/chat-completion/deepseek.js';
import google from 'smart-models/adapters/chat-completion/google.js';
import groq from 'smart-models/adapters/chat-completion/groq.js';
import litellm from 'smart-models/adapters/chat-completion/litellm.js';
import lm_studio from 'smart-models/adapters/chat-completion/lm_studio.js';
import ollama from 'smart-models/adapters/chat-completion/ollama.js';
import openai from 'smart-models/adapters/chat-completion/openai.js';
import open_router from 'smart-models/adapters/chat-completion/open_router.js';
import xai from 'smart-models/adapters/chat-completion/xai.js';

base.providers = {
  anthropic,
  azure,
  cohere,
  deepseek,
  google,
  groq,
  litellm,
  lm_studio,
  ollama,
  openai,
  open_router,
  xai,
};

export default base;
