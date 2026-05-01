Review the changes on the current branch compared to main.
Read CLAUDE.md for project standards.

Focus on:
1. Security issues (hardcoded secrets, injection vectors, auth gaps)
2. Bugs (null refs, off-by-one, race conditions, resource leaks)
3. Missing type hints or input validation
4. Code quality (duplicated logic, overly complex functions)

Be concise. Comment only on issues worth fixing — skip style nits.
Do NOT suggest changes to dependency files. Do not suggest fixture or golden file edits without understanding the test intent — broken fixtures are often a valid signal of behavior change.
