import { OpenAiConfig, OpenAiEngine } from './openAi';

type GroqConfig = OpenAiConfig;

export class GroqEngine extends OpenAiEngine {
  constructor(config: GroqConfig) {
    config.baseURL = 'https://api.groq.com/openai/v1';
    super(config);
  }
}
