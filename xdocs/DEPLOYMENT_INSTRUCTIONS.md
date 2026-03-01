# OpenCommitX Deployment Instructions

How to build, test locally, and publish `opencommitx` to npm.

---

## Prerequisites

- Node.js 20+
- npm 9+
- An npm account with publish access (for publishing)

---

## Development Workflow

### 1. Install dependencies

```powershell
cd opencommitx
npm install
```

### 2. Build

```powershell
npm run build
```

This runs `rimraf out && node esbuild.config.js` and produces:
- `out/cli.cjs` — the main CLI bundle
- `out/tiktoken_bg.wasm` — tokenizer WebAssembly

The `scripts/extract_docstrings.py` Python helper is included separately (not bundled into the CJS).

### 3. Run locally (without installing)

```powershell
node ./out/cli.cjs            # same as running ocox
node ./out/cli.cjs --dry-run  # dry run
node ./out/cli.cjs setup      # setup wizard
```

Or use the npm scripts:

```powershell
npm run start                 # equivalent to node ./out/cli.cjs
npm run ollama:start          # start with Ollama provider
npm run mlx:start             # start with MLX provider
```

### 4. Development mode (TypeScript, no build needed)

```powershell
npm run dev          # ts-node ./src/cli.ts
npm run dev -- --dry-run
```

### 5. Watch mode (auto-rebuild on change)

```powershell
npm run watch
```

---

## Testing

### Prerequisites for running tests locally

Two things must be set up before running tests, otherwise you'll see ESM parse failures or skipped Python tests:

**1. Node experimental VM modules** — required for ts-jest's ESM mode (chalk v5+ is pure ESM).

`npm test` and `npm run test:unit` set this automatically via `cross-env`. If you invoke jest directly (e.g. `node_modules\.bin\jest.cmd`), set it first:

```powershell
# PowerShell
$env:NODE_OPTIONS = "--experimental-vm-modules"
```
```bash
# bash/zsh
export NODE_OPTIONS=--experimental-vm-modules
```

**2. Pixi Python environment** — required for the `pythonDocstringExtractor` integration tests. Without it, 3 tests in that suite will be skipped (gracefully) and Python-dependent behaviour won't be verified.

```powershell
pixi shell   # activates the Python >=3.11 environment defined in pixi.toml
```

Run this once per terminal session before executing tests. You can verify it worked with `python --version`.

---

### Unit tests

```powershell
npm run test:unit
```

Runs Jest unit tests in `test/unit/`. Uses `--experimental-vm-modules`.

### E2E tests

```powershell
npm run test:e2e
```

Runs `test/e2e/setup.sh` first (creates temp git repos), then Jest E2E tests.

**Note:** E2E tests require `git` to be available and use `OCO_AI_PROVIDER=test` to avoid real LLM calls.

### All tests via Docker

```powershell
npm run test:all              # build Docker image and run all tests
npm run test:unit:docker      # unit tests in Docker
npm run test:e2e:docker       # e2e tests in Docker
```

### Run a quick dry-run against a real provider

```powershell
git add .
node ./out/cli.cjs --dry-run
```

This uses the `test` mock provider and prints a sample commit message without making any LLM calls.

---

## Local Installation (test as installed package)

### Method 1: npm link

```powershell
cd opencommitx
npm run build
npm link
```

This registers `ocox`, `opencommitx`, `oco`, and `opencommit` as global commands pointing to your local build. Test with:

```powershell
ocox --dry-run
ocox setup
```

To unlink:

```powershell
npm unlink -g opencommitx
```

### Method 2: pack and install

```powershell
npm run build
npm pack
# Creates opencommitx-1.0.0.tgz
npm install -g ./opencommitx-1.0.0.tgz
```

---

## Publishing to npm

### First publish

1. Ensure you are logged into npm:
   ```powershell
   npm login
   ```

2. Bump the version in `package.json` (follow semantic versioning):
   ```powershell
   npm version patch    # 1.0.0 → 1.0.1
   npm version minor    # 1.0.0 → 1.1.0
   npm version major    # 1.0.0 → 2.0.0
   ```

3. Build:
   ```powershell
   npm run build
   ```

4. Publish:
   ```powershell
   npm publish --tag latest
   ```
   
   Or use the convenience script:
   ```powershell
   npm run deploy
   ```

### Subsequent patches

```powershell
npm run deploy:patch
```

This runs `npm version patch` → build → commit → push → `npm publish`.

### Files included in the package

The `files` array in `package.json` controls what gets published:
- `out/cli.cjs`
- `out/tiktoken_bg.wasm`
- `scripts/extract_docstrings.py`

---

## GitHub Actions

The following workflows run on push/PR:

| Workflow | Trigger | Purpose |
|---|---|---|
| `.github/workflows/test.yml` | Push, PR | Runs unit + e2e tests, format check |
| `.github/workflows/dependency-review.yml` | PR | Reviews dependency changes |
| `.github/workflows/codeql.yml` | Push, PR | Security scanning |

These are self-contained and reference the fork repo automatically via `github.context`. They do not push to or contact the upstream `opencommit` repository.

The GitHub Actions integration (`src/github-action.ts`) is a separate entry point for rewriting commit messages on push events. To use it in your own repo, set up a workflow that uses `opencommitx` as an action (see upstream docs for the action YAML format, then substitute `opencommitx` for `opencommit`).

---

## Troubleshooting

### Build fails with TypeScript errors

```powershell
npm run lint    # check types and lint
```

### `ocox` command not found after npm link

Ensure `npm global bin` is in your PATH:

```powershell
npm config get prefix
# Add <prefix>\bin to PATH
```

### Cache issues

Clear the commit message cache:

```powershell
# Delete manually
Remove-Item "$env:USERPROFILE\.opencommitx-cache.json"
```
```bash
# Linux/macOS
rm ~/.opencommitx-cache.json
```

Or from within the tool:

```powershell
ocox config set OCO_CACHE_ENABLED=false  # disable cache
```

### Python docstring extraction not working

Verify Python is on PATH:

```powershell
python --version
python3 --version
```

The extractor falls back gracefully to full diff if Python is unavailable.
