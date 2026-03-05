import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join as pathJoin } from 'path';
import OpenAI from 'openai';
import { getConfig, setGlobalConfig, getGlobalConfig, OCO_AI_PROVIDER_ENUM } from '../commands/config';
import { getEngine } from './engine';
import { getMainCommitPrompt } from '../prompts';
import { buildEvaluatorMessages, BenchmarkEvalResponse, BenchmarkEvalResult } from '../prompts/benchmark';
import { getProviderApiKey } from './providerKeys';

export interface BenchmarkCandidate {
  model: string;
  provider: string;
  temperature?: number;
  max_tokens_input?: number;
  max_tokens_output?: number;
}

export interface BenchmarkConfig {
  eval_model: string;
  eval_provider: string;
  eval_temperature: number;
  eval_max_tokens_input: number;
  eval_max_tokens_output: number;
  candidates: BenchmarkCandidate[];
}

export interface CandidateResult {
  candidate: BenchmarkCandidate;
  message: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cost?: number;
  error?: string;
}

const BENCHMARK_CONFIG_PATH = pathJoin(homedir(), '.opencommitx-data', 'benchmark.json');

export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  eval_model: 'anthropic/claude-opus-4-20250514',
  eval_provider: 'openrouter',
  eval_temperature: 0.1,
  eval_max_tokens_input: 32000,
  eval_max_tokens_output: 8000,
  candidates: []
};

export function readBenchmarkConfig(): BenchmarkConfig | null {
  if (!existsSync(BENCHMARK_CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BENCHMARK_CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeBenchmarkConfig(cfg: BenchmarkConfig): void {
  mkdirSync(pathJoin(homedir(), '.opencommitx-data'), { recursive: true });
  writeFileSync(BENCHMARK_CONFIG_PATH, JSON.stringify(cfg, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  });
}

/** Generate a commit message for a specific candidate model, returning timing + token data. */
export async function runCandidate(
  candidate: BenchmarkCandidate,
  diff: string
): Promise<CandidateResult> {
  const startMs = Date.now();
  const existingConfig = getGlobalConfig();
  const maxIn = candidate.max_tokens_input ?? getConfig().OCO_TOKENS_MAX_INPUT;
  const maxOut = candidate.max_tokens_output ?? getConfig().OCO_TOKENS_MAX_OUTPUT;

  setGlobalConfig({
    ...existingConfig,
    OCO_AI_PROVIDER: candidate.provider as any,
    OCO_MODEL: candidate.model,
    OCO_TOKENS_MAX_INPUT: maxIn,
    OCO_TOKENS_MAX_OUTPUT: maxOut,
    OCO_TEMPERATURE: candidate.temperature ?? 0
  } as any);

  try {
    const engine = getEngine();
    const messages = await getMainCommitPrompt(false, '');
    messages.push({ role: 'user', content: diff });

    const raw = await engine.generateCommitMessage(messages);
    const latencyMs = Date.now() - startMs;

    return {
      candidate,
      message: raw ?? '',
      latencyMs,
      promptTokens: 0,
      completionTokens: 0
    };
  } catch (err: unknown) {
    return {
      candidate,
      message: '',
      latencyMs: Date.now() - startMs,
      promptTokens: 0,
      completionTokens: 0,
      error: String(err)
    };
  } finally {
    setGlobalConfig(existingConfig);
  }
}

/** Call the evaluator model with all candidate messages + diff. */
export async function runEvaluator(
  cfg: BenchmarkConfig,
  diff: string,
  candidateResults: CandidateResult[]
): Promise<BenchmarkEvalResponse> {
  const existingConfig = getGlobalConfig();

  setGlobalConfig({
    ...existingConfig,
    OCO_AI_PROVIDER: cfg.eval_provider as any,
    OCO_MODEL: cfg.eval_model,
    OCO_TOKENS_MAX_INPUT: cfg.eval_max_tokens_input,
    OCO_TOKENS_MAX_OUTPUT: cfg.eval_max_tokens_output,
    OCO_TEMPERATURE: cfg.eval_temperature
  } as any);

  try {
    const candidates = candidateResults
      .filter((r) => !r.error && r.message)
      .map((r) => ({ model: r.candidate.model, message: r.message }));

    const messages = buildEvaluatorMessages(diff, candidates);
    const engine = getEngine();

    // Get raw response — do NOT strip <think> blocks for benchmark output.
    const evalConfig = getConfig();
    let rawApiKey = getProviderApiKey(evalConfig, cfg.eval_provider);
    const baseURL = cfg.eval_provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : undefined;

    const client = new OpenAI({
      apiKey: rawApiKey ?? 'none',
      baseURL,
      defaultHeaders: cfg.eval_provider === 'openrouter'
        ? { 'HTTP-Referer': 'https://github.com/xwberry/opencommitx', 'X-Title': 'OpenCommitX Benchmark' }
        : {}
    });

    const response = await client.chat.completions.create({
      model: cfg.eval_model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: cfg.eval_temperature,
      max_tokens: cfg.eval_max_tokens_output
    });

    const rawContent = response.choices[0]?.message?.content ?? '{"results":[]}';

    // Try to parse JSON from the content (may be wrapped in <think> blocks)
    const jsonMatch = rawContent.match(/\{[\s\S]*"results"[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : rawContent;

    try {
      const parsed = JSON.parse(jsonStr) as BenchmarkEvalResponse;
      // Attach any think block as a property for downstream use
      (parsed as any)._rawContent = rawContent;
      return parsed;
    } catch {
      return { results: [] };
    }
  } finally {
    setGlobalConfig(existingConfig);
  }
}

/** Format results as markdown for benchmark_results.md */
export function formatBenchmarkMarkdown(
  diff: string,
  candidateResults: CandidateResult[],
  evalResults: BenchmarkEvalResponse,
  timestamp: string
): string {
  const evalMap = new Map<string, BenchmarkEvalResult>(
    evalResults.results.map((r) => [r.model, r])
  );

  // Sort by score descending
  const sorted = [...candidateResults].sort((a, b) => {
    const sa = evalMap.get(a.candidate.model)?.score ?? 0;
    const sb = evalMap.get(b.candidate.model)?.score ?? 0;
    return sb - sa;
  });

  const summaryRows = sorted.map((r, i) => {
    const ev = evalMap.get(r.candidate.model);
    return `| ${i + 1} | ${r.candidate.model} | ${ev?.score ?? 'N/A'} | ${ev?.accuracy ?? '-'}/10 | ${ev?.completeness ?? '-'}/10 | ${ev?.hallucinations ? 'Yes' : 'No'} | ${(r.latencyMs / 1000).toFixed(1)}s | ${r.promptTokens}/${r.completionTokens} | ${r.cost != null ? `$${r.cost.toFixed(5)}` : 'N/A'} |`;
  }).join('\n');

  const modelSections = sorted.map((r) => {
    const ev = evalMap.get(r.candidate.model);
    const missing = ev?.missing_key_details?.length
      ? ev.missing_key_details.map((d) => `  - ${d}`).join('\n')
      : '  none';

    return `## Model: ${r.candidate.model}${ev ? ` — Score: ${ev.score}/100` : ''}
${r.error ? `**Error:** ${r.error}` : `**Commit message:**\n\`\`\`\n${r.message}\n\`\`\``}

**Accuracy:** ${ev?.accuracy ?? 'N/A'}/10
**Completeness:** ${ev?.completeness ?? 'N/A'}/10
**Missing key details:**
${missing}
**Hallucinations:** ${ev?.hallucinations ? `Yes — ${ev.hallucination_details}` : 'No'}
**Conventional commit compliance:** ${ev?.conventional_commit_compliance ? 'Yes' : 'No'}
**Pros:** ${ev?.pros?.join(', ') ?? 'N/A'}
**Cons:** ${ev?.cons?.join(', ') ?? 'N/A'}
**Suggested improvement:** ${ev?.suggested_improvement ?? 'N/A'}
**Overall assessment:** ${ev?.overall ?? 'N/A'}

**E2E latency:** ${(r.latencyMs / 1000).toFixed(1)}s
**Tokens (in/out):** ${r.promptTokens} / ${r.completionTokens}
**Cost:** ${r.cost != null ? `$${r.cost.toFixed(5)}` : 'N/A'}`;
  }).join('\n\n---\n\n');

  const rawEval = (evalResults as any)._rawContent ?? '';
  const thinkBlock = rawEval !== JSON.stringify(evalResults)
    ? `\n\n## Evaluator Raw Response (including reasoning)\n\n\`\`\`\n${rawEval}\n\`\`\``
    : '';

  return `# Benchmark Results — ${timestamp}

## Summary
| Rank | Model | Score | Accuracy | Completeness | Hallucinations | Latency | Tokens (in/out) | Cost |
|------|-------|-------|----------|--------------|----------------|---------|-----------------|------|
${summaryRows}

---

${modelSections}${thinkBlock}

---

## Original Diff
\`\`\`diff
${diff}
\`\`\`
`;
}
