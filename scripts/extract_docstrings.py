#!/usr/bin/env python3
"""
Extract docstrings from a Python file using the AST module.
Outputs a structured text summary of module/class/function docstrings.

Usage:
  python extract_docstrings.py <filepath>
      → extract all docstrings (whole-file mode)

  python extract_docstrings.py <filepath> --changed <name1,name2,...>
      → always include the module docstring; include function/class docstrings
        only for the names listed (names that appear in git diff @@ hunk headers)

Exit codes:
  0 - success, docstrings printed to stdout
  1 - error (file not found, parse error, etc.)
  2 - no docstrings found
"""
import ast
import sys
import os


def extract_docstrings(filepath: str) -> list[dict]:
    """Extract all docstrings from a Python file."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            source = f.read()
    except FileNotFoundError:
        print(f"Error: file not found: {filepath}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error reading file: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        tree = ast.parse(source, filename=filepath)
    except SyntaxError as e:
        print(f"Syntax error in {filepath}: {e}", file=sys.stderr)
        sys.exit(1)

    results = []

    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            docstring = ast.get_docstring(node)
            if not docstring:
                continue

            if isinstance(node, ast.Module):
                results.append({
                    'type': 'module',
                    'name': os.path.basename(filepath),
                    'line': 1,
                    'docstring': docstring.strip()
                })
            elif isinstance(node, ast.ClassDef):
                results.append({
                    'type': 'class',
                    'name': node.name,
                    'line': node.lineno,
                    'docstring': docstring.strip()
                })
            else:
                results.append({
                    'type': 'function',
                    'name': node.name,
                    'line': node.lineno,
                    'docstring': docstring.strip()
                })

    return results


def format_output(filepath: str, docstrings: list[dict]) -> str:
    """Format the extracted docstrings as a readable diff summary."""
    lines = [f"# Docstring summary for: {filepath}"]
    for item in docstrings:
        kind = item['type']
        name = item['name']
        line = item['line']
        doc = item['docstring']
        lines.append(f"\n## {kind}: {name} (line {line})")
        lines.append(doc)
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: extract_docstrings.py <filepath> [--changed name1,name2,...]",
              file=sys.stderr)
        sys.exit(1)

    filepath = sys.argv[1]

    # Parse optional --changed argument
    changed_names: set[str] | None = None
    args = sys.argv[2:]
    if '--changed' in args:
        idx = args.index('--changed')
        if idx + 1 >= len(args) or args[idx + 1].startswith('--'):
            print("Usage: extract_docstrings.py <filepath> [--changed name1,name2,...]", file=sys.stderr)
            sys.exit(1)
        changed_names = {n.strip() for n in args[idx + 1].split(',') if n.strip()}

    all_docstrings = extract_docstrings(filepath)

    if changed_names is not None:
        # Partial mode: always keep module docstring; keep function/class only if changed.
        filtered = [
            d for d in all_docstrings
            if d['type'] == 'module' or d['name'] in changed_names
        ]
    else:
        filtered = all_docstrings

    if not filtered:
        print(f"# No relevant docstrings found in: {filepath}")
        sys.exit(2)

    print(format_output(filepath, filtered))
    sys.exit(0)


if __name__ == '__main__':
    main()
