# AGENTS.md

Instructions for AI coding agents working with this codebase.

## Style

- Honor and mirror the code style in vercel/ai (the AI SDK)

## Project Workflow

- Use `bun` for scripts in `package.json` (build, typecheck, lint, format, test).
- Formatting uses `oxfmt` (run via `bun run format`).
- Linting uses `oxlint --type-aware` (run via `bun run lint`).
- Prefer `rg` for search.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Skills

Project skills live in `.agents/skills`. The runtime loader looks for `.agent/skills`, so keep them mirrored or symlinked if you want runtime loading.

- ai-sdk: Answer questions about the AI SDK and help build AI-powered features. (file: .agents/skills/ai-sdk/SKILL.md)
- code-reviewer: Review code for project guidelines, style, and best practices. (file: .agents/skills/code-reviewer/SKILL.md)
- code-simplifier: Simplify recently modified code for clarity and maintainability. (file: .agents/skills/code-simplifier/SKILL.md)
- comment-analyzer: Analyze comments for accuracy and maintainability. (file: .agents/skills/comment-analyzer/SKILL.md)
- compound-docs: Capture solved problems as categorized documentation with YAML frontmatter for fast lookup. (file: .agents/skills/compound-docs/SKILL.md)
- find-skills: Discover and install agent skills from the skills ecosystem. (file: .agents/skills/find-skills/SKILL.md)
- pr-test-analyzer: Review test coverage quality in PRs. (file: .agents/skills/pr-test-analyzer/SKILL.md)
- silent-failure-hunter: Find silent failures and error handling issues. (file: .agents/skills/silent-failure-hunter/SKILL.md)
- type-design-analyzer: Analyze type design and invariants. (file: .agents/skills/type-design-analyzer/SKILL.md)

## Tooling

- knip: Run `bun run knip` to report unused files/exports/dependencies (config: `knip.json`, ignores `opensrc/`, includes tests).

## Final Thoughts

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for any AI SDK tasks.
