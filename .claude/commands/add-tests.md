Generate tests for the file or module: $ARGUMENTS

Read CLAUDE.md for testing standards.

Follow these conventions:
- Use pytest with fixtures (no unittest classes)
- File naming: test_<module_name>.py in the tests/ directory
- Function naming: test_<function_name>_<scenario>
- Include at least one happy-path and one error-path test per function
- Use pytest.raises for exception testing
- Use pytest.mark.parametrize for multiple input cases
- Mock external services using pytest-mock
- For async code, use pytest-asyncio
- For LLM-dependent code, create golden tests with saved input/output pairs (store in tests/fixtures/)
