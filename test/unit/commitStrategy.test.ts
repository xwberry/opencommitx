import {
  buildCommitPlan,
  combineCommitMessages,
  isValidCommitStrategy
} from '../../src/utils/commitStrategy';
import { DEFAULT_CONFIG } from '../../src/commands/config';

describe('commitStrategy', () => {
  describe('buildCommitPlan (file-message association)', () => {
    it('pairs each group with its corresponding message by index', () => {
      const groups = [
        { files: ['src/auth.ts', 'src/user.ts'] },
        { files: ['src/db.ts'] }
      ];
      const messages = ['feat(auth): add login flow', 'chore(db): optimize query'];
      const plan = buildCommitPlan(groups, messages);

      expect(plan[0].files).toEqual(['src/auth.ts', 'src/user.ts']);
      expect(plan[0].message).toBe('feat(auth): add login flow');
      expect(plan[1].files).toEqual(['src/db.ts']);
      expect(plan[1].message).toBe('chore(db): optimize query');
    });

    it('does not mix messages between groups', () => {
      const groups = [{ files: ['a.ts'] }, { files: ['b.ts'] }, { files: ['c.ts'] }];
      const messages = ['msg-a', 'msg-b', 'msg-c'];
      const plan = buildCommitPlan(groups, messages);

      expect(plan.find((p) => p.files.includes('a.ts'))?.message).toBe('msg-a');
      expect(plan.find((p) => p.files.includes('b.ts'))?.message).toBe('msg-b');
      expect(plan.find((p) => p.files.includes('c.ts'))?.message).toBe('msg-c');
    });

    it('preserves multi-file groups intact', () => {
      const groups = [{ files: ['x.ts', 'y.ts', 'z.ts'] }];
      const messages = ['refactor: consolidate utilities'];
      const plan = buildCommitPlan(groups, messages);

      expect(plan[0].files).toHaveLength(3);
      expect(plan[0].files).toContain('x.ts');
      expect(plan[0].files).toContain('z.ts');
    });

    it('returns an empty plan for empty inputs', () => {
      expect(buildCommitPlan([], [])).toEqual([]);
    });

    it('produces exactly one entry per group (no duplication)', () => {
      const groups = [{ files: ['a.ts'] }, { files: ['b.ts'] }];
      const messages = ['msg-a', 'msg-b'];
      const plan = buildCommitPlan(groups, messages);
      expect(plan).toHaveLength(2);
    });
  });

  describe('combineCommitMessages (OCO_MULTI_COMMIT_STRATEGY=single)', () => {
    it('joins messages with double newlines', () => {
      const messages = ['feat(auth): add login', 'fix(db): correct query'];
      expect(combineCommitMessages(messages)).toBe('feat(auth): add login\n\nfix(db): correct query');
    });

    it('returns the message unchanged for a single-element array', () => {
      expect(combineCommitMessages(['fix: typo'])).toBe('fix: typo');
    });

    it('returns an empty string for an empty array', () => {
      expect(combineCommitMessages([])).toBe('');
    });

    it('preserves multi-line messages within each entry', () => {
      const messages = ['feat: first\n\nBody text.', 'fix: second'];
      const combined = combineCommitMessages(messages);
      expect(combined).toContain('feat: first');
      expect(combined).toContain('Body text.');
      expect(combined).toContain('fix: second');
    });
  });

  describe('isValidCommitStrategy', () => {
    it('accepts single', () => {
      expect(isValidCommitStrategy('single')).toBe(true);
    });

    it('accepts sequential', () => {
      expect(isValidCommitStrategy('sequential')).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(isValidCommitStrategy('parallel')).toBe(false);
      expect(isValidCommitStrategy('')).toBe(false);
      expect(isValidCommitStrategy('SINGLE')).toBe(false);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('defaults OCO_MULTI_COMMIT_STRATEGY to single', () => {
      expect(DEFAULT_CONFIG.OCO_MULTI_COMMIT_STRATEGY).toBe('single');
    });

    it('defaults OCO_CACHE_ENABLED to true', () => {
      expect(DEFAULT_CONFIG.OCO_CACHE_ENABLED).toBe(true);
    });

    it('defaults OCO_CACHE_TTL_SECONDS to 3600', () => {
      expect(DEFAULT_CONFIG.OCO_CACHE_TTL_SECONDS).toBe(3600);
    });

    it('defaults OCO_PER_FILE_COMMIT_MODE to auto', () => {
      expect(DEFAULT_CONFIG.OCO_PER_FILE_COMMIT_MODE).toBe('auto');
    });

    it('defaults OCO_PER_FILE_THRESHOLD_LINES to 300', () => {
      expect(DEFAULT_CONFIG.OCO_PER_FILE_THRESHOLD_LINES).toBe(300);
    });

    it('defaults OCO_PYTHON_DOCSTRING_MODE to auto', () => {
      expect(DEFAULT_CONFIG.OCO_PYTHON_DOCSTRING_MODE).toBe('auto');
    });

    it('defaults OCO_PYTHON_DOCSTRING_THRESHOLD to 500', () => {
      expect(DEFAULT_CONFIG.OCO_PYTHON_DOCSTRING_THRESHOLD).toBe(500);
    });
  });

  describe('OCO_MULTI_COMMIT_STRATEGY env var', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      Object.keys(process.env).forEach((key) => {
        if (!(key in originalEnv)) delete process.env[key];
        else process.env[key] = originalEnv[key];
      });
    });

    // parseConfigVarValue in config.ts wraps JSON.parse and falls back to the raw
    // string on SyntaxError — bare strings like 'sequential' are NOT valid JSON.
    // These tests mirror that fallback behaviour.
    it('recognises sequential set via process.env', () => {
      process.env.OCO_MULTI_COMMIT_STRATEGY = 'sequential';
      const raw = process.env.OCO_MULTI_COMMIT_STRATEGY;
      expect(raw).toBe('sequential');
      expect(isValidCommitStrategy(raw)).toBe(true);
    });

    it('recognises single set via process.env', () => {
      process.env.OCO_MULTI_COMMIT_STRATEGY = 'single';
      const raw = process.env.OCO_MULTI_COMMIT_STRATEGY;
      expect(raw).toBe('single');
      expect(isValidCommitStrategy(raw)).toBe(true);
    });

    it('rejects an invalid value set via process.env', () => {
      process.env.OCO_MULTI_COMMIT_STRATEGY = 'parallel';
      expect(isValidCommitStrategy(process.env.OCO_MULTI_COMMIT_STRATEGY)).toBe(false);
    });
  });
});
