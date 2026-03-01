import OpenAI from 'openai';
import { normalizeEngineError } from '../utils/engineErrorHandler';
import { removeContentTags } from '../utils/removeContentTags';
import { AiEngine, AiEngineConfig } from './Engine';

interface OpenRouterConfig extends AiEngineConfig {}

/**
 * OpenRouter engine using the OpenAI-compatible API.
 * Supports all models available on https://openrouter.ai including free tiers
 * (append :free to model name, e.g. google/gemma-3-27b-it:free).
 */
export class OpenRouterEngine implements AiEngine {
  client: OpenAI;

  constructor(public config: OpenRouterConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://github.com/xwberry/opencommitx',
        'X-Title': 'OpenCommitX',
        ...(config.customHeaders || {})
      }
    });
  }

  public generateCommitMessage = async (
    messages: Array<OpenAI.Chat.Completions.ChatCompletionMessageParam>
  ): Promise<string | null> => {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages,
        temperature: 0,
        top_p: 0.1,
        max_tokens: this.config.maxTokensOutput
      });

      const content = response.choices[0]?.message?.content;
      return removeContentTags(content ?? '', 'think');
    } catch (error) {
      throw normalizeEngineError(error, 'openrouter', this.config.model);
    }
  };
}
