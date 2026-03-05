/**
 * Tests for validators of config keys introduced in Phase 2 and Phase 3.
 * Uses process.env overrides (no disk writes) to exercise the validators
 * through the normal getConfig() path.
 */
import { getConfig, DEFAULT_CONFIG } from '../../src/commands/config';

const originalEnv = { ...process.env };

function resetEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in originalEnv)) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
}

afterEach(resetEnv);

describe('DEFAULT_CONFIG new keys', () => {
  it('defaults OCO_TEMPERATURE to 0', () => {
    expect(DEFAULT_CONFIG.OCO_TEMPERATURE).toBe(0);
  });

  it('defaults OCO_COMMIT_DETAIL to normal', () => {
    expect(DEFAULT_CONFIG.OCO_COMMIT_DETAIL).toBe('normal');
  });

  it('defaults OCO_GENERATION_TIMEOUT_SECONDS to 90', () => {
    expect(DEFAULT_CONFIG.OCO_GENERATION_TIMEOUT_SECONDS).toBe(90);
  });

  it('defaults OCO_MAX_FILES_PER_GROUP to 10', () => {
    expect(DEFAULT_CONFIG.OCO_MAX_FILES_PER_GROUP).toBe(10);
  });

  it('defaults OCO_MAX_LINES_PER_GROUP to 1500', () => {
    expect(DEFAULT_CONFIG.OCO_MAX_LINES_PER_GROUP).toBe(1500);
  });

  it('defaults OCO_FALLBACK_MODEL to empty string', () => {
    expect(DEFAULT_CONFIG.OCO_FALLBACK_MODEL).toBe('');
  });

  it('does not include OCO_DIFF_INDIVIDUAL_FILES (removed)', () => {
    expect('OCO_DIFF_INDIVIDUAL_FILES' in DEFAULT_CONFIG).toBe(false);
  });
});

describe('OCO_TEMPERATURE env override', () => {
  it('accepts 0 (default)', () => {
    process.env.OCO_TEMPERATURE = '0';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_TEMPERATURE).toBe(0);
  });

  it('accepts 0.7', () => {
    process.env.OCO_TEMPERATURE = '0.7';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_TEMPERATURE).toBe(0.7);
  });

  it('accepts 2.0 (maximum)', () => {
    process.env.OCO_TEMPERATURE = '2.0';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_TEMPERATURE).toBe(2);
  });
});

describe('OCO_COMMIT_DETAIL env override', () => {
  it('accepts concise', () => {
    process.env.OCO_COMMIT_DETAIL = 'concise';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_COMMIT_DETAIL).toBe('concise');
  });

  it('accepts normal', () => {
    process.env.OCO_COMMIT_DETAIL = 'normal';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_COMMIT_DETAIL).toBe('normal');
  });

  it('accepts detailed', () => {
    process.env.OCO_COMMIT_DETAIL = 'detailed';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_COMMIT_DETAIL).toBe('detailed');
  });
});

describe('OCO_GENERATION_TIMEOUT_SECONDS env override', () => {
  it('accepts 60', () => {
    process.env.OCO_GENERATION_TIMEOUT_SECONDS = '60';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_GENERATION_TIMEOUT_SECONDS).toBe(60);
  });

  it('accepts 300', () => {
    process.env.OCO_GENERATION_TIMEOUT_SECONDS = '300';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_GENERATION_TIMEOUT_SECONDS).toBe(300);
  });
});

describe('OCO_MAX_FILES_PER_GROUP env override', () => {
  it('accepts positive integer', () => {
    process.env.OCO_MAX_FILES_PER_GROUP = '5';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_MAX_FILES_PER_GROUP).toBe(5);
  });
});

describe('OCO_FALLBACK_MODEL and OCO_FALLBACK_PROVIDER env override', () => {
  it('accepts any string for OCO_FALLBACK_MODEL', () => {
    process.env.OCO_FALLBACK_MODEL = 'anthropic/claude-3-5-haiku';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_FALLBACK_MODEL).toBe('anthropic/claude-3-5-haiku');
  });

  it('accepts a known provider for OCO_FALLBACK_PROVIDER', () => {
    process.env.OCO_FALLBACK_PROVIDER = 'anthropic';
    process.env.OCO_AI_PROVIDER = 'test';
    const cfg = getConfig();
    expect(cfg.OCO_FALLBACK_PROVIDER).toBe('anthropic');
  });
});
