import { OpenAI } from 'openai';

export interface BenchmarkEvalResult {
  model: string;
  score: number;
  accuracy: number;
  completeness: number;
  missing_key_details: string[];
  hallucinations: boolean;
  hallucination_details: string;
  conventional_commit_compliance: boolean;
  pros: string[];
  cons: string[];
  suggested_improvement: string;
  overall: string;
}

export interface BenchmarkEvalResponse {
  results: BenchmarkEvalResult[];
}

/** Build the evaluator prompt for a benchmark run. */
export function buildEvaluatorMessages(
  diff: string,
  candidates: Array<{ model: string; message: string }>
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const candidateList = candidates
    .map(
      (c, i) =>
        `### Candidate ${i + 1}: ${c.model}\n\`\`\`\n${c.message}\n\`\`\``
    )
    .join('\n\n');

  const systemPrompt = `You are an expert code reviewer evaluating AI-generated git commit messages.
You will be given a git diff and N candidate commit messages, each from a different AI model.
Grade each candidate on the following criteria and return a JSON object matching this schema exactly:

{
  "results": [
    {
      "model": "<model id string>",
      "score": <0-100 overall score>,
      "accuracy": <0-10: does the message accurately describe what changed?>,
      "completeness": <0-10: does it cover all meaningful changes?>,
      "missing_key_details": ["<detail A not mentioned>", ...],
      "hallucinations": <true if message claims something not in the diff>,
      "hallucination_details": "<what was hallucinated, or empty string>",
      "conventional_commit_compliance": <true if follows conventional commit spec>,
      "pros": ["<strength 1>", ...],
      "cons": ["<weakness 1>", ...],
      "suggested_improvement": "<one sentence on what would make it better>",
      "overall": "<2-3 sentence narrative assessment>"
    }
  ]
}

Return ONLY valid JSON. No markdown fences, no preamble.
Do NOT omit the <think> tag if you use one — include all reasoning in the response.`;

  const userPrompt = `## Git Diff\n\`\`\`diff\n${diff}\n\`\`\`\n\n## Candidate Commit Messages\n\n${candidateList}\n\nEvaluate all ${candidates.length} candidates and return the JSON results array.`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];
}
