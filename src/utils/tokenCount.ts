import cl100k_base from '@dqbd/tiktoken/encoders/cl100k_base.json';
import { Tiktoken } from '@dqbd/tiktoken/lite';

// Initialising Tiktoken allocates WASM memory and loads BPE rank tables.
// Creating a fresh instance on every call blocks the event loop for hundreds
// of milliseconds — long enough to prevent Ctrl+C from being processed.
// A module-level singleton initialises once; subsequent calls only run the
// encoder, which is orders of magnitude faster.
let _encoding: Tiktoken | null = null;

function getEncoding(): Tiktoken {
  if (!_encoding) {
    _encoding = new Tiktoken(
      cl100k_base.bpe_ranks,
      cl100k_base.special_tokens,
      cl100k_base.pat_str
    );
  }
  return _encoding;
}

export function tokenCount(content: string): number {
  if (!content) return 0;
  return getEncoding().encode(content).length;
}
