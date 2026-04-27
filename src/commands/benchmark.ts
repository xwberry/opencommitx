import {
  intro,
  outro,
  select,
  text,
  confirm,
  isCancel,
  note,
  spinner
} from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';
import { writeFileSync } from 'fs';
import { join as pathJoin } from 'path';
import { COMMANDS } from './ENUMS';
import {
  CONFIG_KEYS,
  OCO_AI_PROVIDER_ENUM,
  PROVIDER_API_KEY_URLS,
  getConfig,
  setGlobalConfig,
  getGlobalConfig,
  setConfig
} from './config';
import {
  BenchmarkCandidate,
  BenchmarkConfig,
  DEFAULT_BENCHMARK_CONFIG,
  CandidateResult,
  formatBenchmarkMarkdown,
  readBenchmarkConfig,
  runCandidate,
  runEvaluator,
  writeBenchmarkConfig
} from '../utils/benchmarkRunner';
import { getDiff, getStagedFiles, assertGitRepo } from '../utils/git';
import { getProviderApiKey } from '../utils/providerKeys';

const parseNumberOrDefault = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const benchmarkCandidateKey = (candidate: BenchmarkCandidate): string =>
  `${candidate.model}@${candidate.provider}`;

// ── Setup wizard ────────────────────────────────────────────────────────────

async function runBenchmarkSetup(): Promise<void> {
  intro(chalk.bgMagenta(' OpenCommitX Benchmark Setup '));

  const existing = readBenchmarkConfig() ?? { ...DEFAULT_BENCHMARK_CONFIG };

  // Evaluator model
  console.log(chalk.bold('\n── Evaluator Model ──'));
  console.log(
    chalk.dim('  The evaluator grades all candidate messages in one request.')
  );
  console.log(
    chalk.dim(
      '  Use a capable model (e.g. claude-opus, gpt-4o). Costs more tokens.\n'
    )
  );

  const evalModel = await text({
    message: `Evaluator model (current: ${existing.eval_model}):`,
    placeholder: 'anthropic/claude-opus-4-20250514',
    defaultValue: existing.eval_model
  });
  if (isCancel(evalModel)) {
    outro('Setup cancelled');
    return;
  }

  const evalProvider = await select({
    message: `Evaluator provider (current: ${existing.eval_provider}):`,
    options: Object.values(OCO_AI_PROVIDER_ENUM)
      .filter((p) => p !== 'test')
      .map((p) => ({
        value: p,
        label:
          p === existing.eval_provider ? `${p} ${chalk.dim('(current)')}` : p
      }))
  });
  if (isCancel(evalProvider)) {
    outro('Setup cancelled');
    return;
  }

  const evalTemp = await text({
    message: `Evaluator temperature (current: ${existing.eval_temperature}):`,
    placeholder: '0.1',
    defaultValue: String(existing.eval_temperature)
  });
  if (isCancel(evalTemp)) {
    outro('Setup cancelled');
    return;
  }

  const evalMaxIn = await text({
    message: `Evaluator max input tokens (current: ${existing.eval_max_tokens_input}):`,
    placeholder: '32000',
    defaultValue: String(existing.eval_max_tokens_input)
  });
  if (isCancel(evalMaxIn)) {
    outro('Setup cancelled');
    return;
  }

  const evalMaxOut = await text({
    message: `Evaluator max output tokens (current: ${existing.eval_max_tokens_output}):`,
    placeholder: '8000',
    defaultValue: String(existing.eval_max_tokens_output)
  });
  if (isCancel(evalMaxOut)) {
    outro('Setup cancelled');
    return;
  }

  // Candidate models (up to 10)
  console.log(chalk.bold('\n── Candidate Models (up to 10) ──'));
  const candidates: BenchmarkCandidate[] = [...(existing.candidates ?? [])];

  const addAnother = async (): Promise<void> => {
    if (candidates.length >= 10) return;

    const shouldAdd = await confirm({
      message: `Add${candidates.length > 0 ? ' another' : ' a'} candidate model? (${candidates.length}/10 configured)`
    });
    if (isCancel(shouldAdd) || !shouldAdd) return;

    const cModel = await text({
      message: 'Candidate model ID:',
      placeholder: 'e.g. meta-llama/llama-4-maverick:free'
    });
    if (isCancel(cModel) || !cModel) return;

    const cProvider = await select({
      message: 'Provider for this candidate:',
      options: Object.values(OCO_AI_PROVIDER_ENUM)
        .filter((p) => p !== 'test')
        .map((p) => ({ value: p, label: p }))
    });
    if (isCancel(cProvider)) return;

    const cTemp = await text({
      message: 'Temperature (Enter for 0):',
      placeholder: '0',
      defaultValue: '0'
    });
    if (isCancel(cTemp)) return;

    const parsedTemp = Number(cTemp);
    candidates.push({
      model: String(cModel),
      provider: cProvider as OCO_AI_PROVIDER_ENUM,
      temperature: !isNaN(parsedTemp) ? parsedTemp : 0
    });

    await addAnother();
  };

  if (candidates.length === 0) {
    await addAnother();
  } else {
    console.log(
      chalk.dim(
        `\n  Existing candidates: ${candidates.map((c) => c.model).join(', ')}`
      )
    );
    const keepOrReset = await select({
      message: 'Candidates:',
      options: [
        { value: 'keep', label: `Keep existing (${candidates.length} models)` },
        { value: 'reset', label: 'Start fresh' },
        { value: 'add', label: 'Add more' }
      ]
    });
    if (!isCancel(keepOrReset)) {
      if (keepOrReset === 'reset') candidates.length = 0;
      if (keepOrReset === 'reset' || keepOrReset === 'add') await addAnother();
    }
  }

  const cfg: BenchmarkConfig = {
    eval_model: String(evalModel),
    eval_provider: evalProvider as OCO_AI_PROVIDER_ENUM,
    eval_temperature: parseNumberOrDefault(evalTemp, 0.1),
    eval_max_tokens_input: parseNumberOrDefault(evalMaxIn, 32000),
    eval_max_tokens_output: parseNumberOrDefault(evalMaxOut, 8000),
    candidates
  };

  writeBenchmarkConfig(cfg);
  outro(
    `${chalk.green('✔')} Benchmark config saved to ~/.opencommitx-data/benchmark.json`
  );
}

// ── Benchmark run ────────────────────────────────────────────────────────────

async function runBenchmark(): Promise<void> {
  await assertGitRepo();

  const cfg = readBenchmarkConfig();
  if (!cfg || cfg.candidates.length === 0) {
    note(
      'No benchmark configuration found. Run `ocox benchmark setup` first.',
      chalk.yellow('Setup required')
    );
    return;
  }

  intro(
    chalk.bgMagenta(
      ` OpenCommitX Benchmark — ${cfg.candidates.length} candidates `
    )
  );

  // Get diff
  const staged = await getStagedFiles();
  const diff = staged.length > 0 ? await getDiff({ files: staged }) : '';

  if (!diff.trim()) {
    outro(chalk.yellow('No staged diff found. Stage some files first.'));
    return;
  }

  // Token count estimate
  const diffLines = diff.split('\n').length;
  const estimatedInputTokens = Math.ceil(diffLines * 4 * cfg.candidates.length);
  const evalEstimate = Math.ceil(diffLines * 4 + cfg.candidates.length * 200);

  note(
    `Diff: ~${diffLines} lines\n` +
      `Candidates: ${cfg.candidates.length} models × ~${Math.ceil(diffLines * 4)} tokens each\n` +
      `Evaluator call: ~${evalEstimate} input tokens\n` +
      `This will use real API tokens and incur costs.`,
    chalk.yellow('⚠  Token usage estimate')
  );

  const proceed = await confirm({ message: 'Proceed with benchmark?' });
  if (isCancel(proceed) || !proceed) {
    outro('Benchmark cancelled');
    return;
  }

  // Run each candidate
  const candidateResults: CandidateResult[] = [];
  const runSpinner = spinner();

  for (const candidate of cfg.candidates) {
    runSpinner.start(`Generating: ${candidate.model}`);
    const result = await runCandidate(candidate, diff);
    candidateResults.push(result);

    if (result.error) {
      runSpinner.stop(
        chalk.red(`✖ ${candidate.model}: ${result.error.slice(0, 60)}`)
      );
    } else {
      runSpinner.stop(
        `${chalk.green('✔')} ${candidate.model} (${(result.latencyMs / 1000).toFixed(1)}s)`
      );
    }
  }

  // Show generated messages
  const successful = candidateResults.filter((r) => !r.error && r.message);
  if (successful.length === 0) {
    outro(chalk.red('All candidates failed. Check model names and API keys.'));
    return;
  }

  console.log('\n' + chalk.bold('── Generated Commit Messages ──'));
  for (const r of successful) {
    console.log(chalk.cyan(`\n  ${r.candidate.model}:`));
    console.log(chalk.grey('  ——————————————————'));
    console.log('  ' + r.message.split('\n').join('\n  '));
    console.log(chalk.grey('  ——————————————————'));
  }

  // Run evaluator
  const evalSpinner = spinner();
  evalSpinner.start(`Evaluating with ${cfg.eval_model}...`);

  let evalResults;
  try {
    evalResults = await runEvaluator(cfg, diff, candidateResults);
    evalSpinner.stop(`${chalk.green('✔')} Evaluation complete`);
  } catch (err: unknown) {
    evalSpinner.stop(
      chalk.red(`✖ Evaluator failed: ${String(err).slice(0, 80)}`)
    );
    evalResults = { results: [] };
  }

  // Display ranked results
  if (evalResults.results.length > 0) {
    const ranked = [...evalResults.results].sort((a, b) => b.score - a.score);
    console.log('\n' + chalk.bold('── Evaluation Results (ranked) ──'));
    for (const [i, ev] of ranked.entries()) {
      console.log(
        chalk.bold(`\n  ${i + 1}. ${ev.model}`) +
          chalk.cyan(` — Score: ${ev.score}/100`) +
          chalk.dim(
            ` (accuracy: ${ev.accuracy}/10, completeness: ${ev.completeness}/10)`
          )
      );
      if (ev.missing_key_details?.length) {
        console.log(
          chalk.yellow(`     Missing: ${ev.missing_key_details.join(', ')}`)
        );
      }
      console.log(chalk.grey(`     ${ev.overall}`));
    }
  }

  // Write results file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultsFile = pathJoin(
    process.cwd(),
    `benchmark_results_${timestamp}.md`
  );
  const markdown = formatBenchmarkMarkdown(
    diff,
    candidateResults,
    evalResults,
    new Date().toISOString()
  );
  writeFileSync(resultsFile, markdown, 'utf-8');
  console.log('\n' + chalk.dim(`  Results written to: ${resultsFile}`));

  // Prompt to select winner — use index as value so duplicate model names don't collide
  const winnerOptions = [
    ...successful.map((r, idx) => ({
      value: String(idx),
      label: `${r.candidate.model} [${r.candidate.provider}]${evalResults.results.find((e) => e.model === benchmarkCandidateKey(r.candidate)) ? ` (score: ${evalResults.results.find((e) => e.model === benchmarkCandidateKey(r.candidate))!.score})` : ''}`
    })),
    { value: '__skip__', label: "Don't change current model" }
  ];

  const winner = await select({
    message: 'Select a model to set as your default (or skip):',
    options: winnerOptions
  });

  if (!isCancel(winner) && winner !== '__skip__') {
    const winnerCandidate = successful[Number(winner)].candidate;
    const existingConfig = getGlobalConfig();
    setGlobalConfig({
      ...existingConfig,
      OCO_AI_PROVIDER: winnerCandidate.provider as OCO_AI_PROVIDER_ENUM,
      OCO_MODEL: winnerCandidate.model
    });
    outro(
      `${chalk.green('✔')} Default model set to ${winnerCandidate.model} (provider: ${winnerCandidate.provider})`
    );
  } else {
    outro(`${chalk.green('✔')} Benchmark complete — no config change`);
  }
}

// ── Command registration ─────────────────────────────────────────────────────

export const benchmarkCommand = command(
  {
    name: COMMANDS.benchmark,
    parameters: ['[mode]'],
    help: {
      description: 'Benchmark multiple AI models against a single diff',
      examples: [
        'Run benchmark on staged diff: ocox benchmark',
        'Configure benchmark models: ocox benchmark setup'
      ]
    }
  },
  async (argv) => {
    const mode = argv._.mode;
    if (mode === 'setup') {
      await runBenchmarkSetup();
    } else {
      await runBenchmark();
    }
  }
);
