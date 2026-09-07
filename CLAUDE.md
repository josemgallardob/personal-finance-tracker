# Instructions for Claude

Read and follow [AGENTS.md](AGENTS.md) in full before modifying this repository.
Its language, branching, validation, commit, and push policies are mandatory.
For coordinated work across agents or worktrees, also read and follow
[the agent collaboration workflow](docs/agent-collaboration-workflow.md) in full.
Orca is the provider-agnostic orchestration layer; Codex, Claude, Cursor, and
other CLI agents are interchangeable workers subject to the same repository rules.

Operational summary:

1. Write all source code, identifiers, database objects, API fields, test names,
   logs, errors, and code comments in English.
2. Use Spanish only for user-visible UI content and localized application copy.
   Write branch names, commits, pull requests, issues, reviews, releases, and
   technical changelog entries in English.
3. Do not create or switch branches until the user explicitly authorizes it.
4. If the user requests work on `main`, remain there and do not commit or push
   unless separately requested.
5. Once the branch workflow is authorized, never work directly on `main`.
6. For new functionality create
   `feature/<three-or-four-word-descriptive-name>`.
7. For an incident or defect correction, create
   `fix/<three-or-four-word-descriptive-name>`.
8. For maintenance, tooling, or scaffolding, create
   `chore/<three-or-four-word-descriptive-name>`.
9. Use English lowercase kebab-case for the descriptive branch name.
10. Preserve unrelated changes and never include them in the task commit.
11. Read the project design document and the local Revolut reference files before
    modifying UI. Treat them as inspiration, with the project design taking
    precedence.
12. Before touching tests, coverage, test configuration, or related CI, read and
    obey the strict integrity rules in `docs/05-tests-qa.md`. Never manipulate
    coverage; require meaningful assertions and report line/branch coverage.
13. Run and validate all relevant tests before finishing.
14. Use `feat: <short English title>` for functionality,
    `fix: <short English title>` for fixes, and
    `chore: <short English title>` for maintenance, tooling, or scaffolding.
15. Push an authorized task branch after committing.
16. Do not create a pull request unless the user explicitly requests one. If
    requested, write all PR metadata and review discussion in English.
17. In multi-agent work, one agent owns an area branch, only the coordinator edits
    private planning state, and implementation agents report verifiable results
    using the collaboration workflow. Never merge without explicit owner approval.

If this summary differs from `AGENTS.md`, `AGENTS.md` takes precedence.
