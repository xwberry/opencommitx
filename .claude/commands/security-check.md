Perform a focused security audit of this codebase.
Read CLAUDE.md for project context.

Check for:
1. Hardcoded secrets, credentials, API keys, or tokens in source code
2. SQL injection, command injection, path traversal, or XSS vectors
3. Missing input validation on endpoints and data entry points
4. Authentication and authorization gaps
5. Insecure use of random, eval, exec, subprocess, os.system, pickle
6. Secrets in config files, comments, or committed .env files
7. CORS misconfigurations or missing security headers

Report findings with severity (CRITICAL / HIGH / MEDIUM / LOW), file path, and line number.
If no issues found, confirm the codebase looks clean.
