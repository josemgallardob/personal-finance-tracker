# Repository Agent Instructions

These instructions are mandatory for every agent that modifies this repository.

## Multi-agent collaboration

When work is coordinated across agents or worktrees, read and follow
[`docs/agent-collaboration-workflow.md`](docs/agent-collaboration-workflow.md) in
full before starting. It defines ownership, dependency gates, task reporting,
pull request lifecycle, integration, and handoff rules.

Orca is the orchestration layer for multi-agent work. Its Runs, Tasks, Dispatches,
Workers, messages, and decision gates coordinate provider-specific CLI agents;
the Git branch, worktree, test, commit, and review policies below still apply.

- One implementation agent owns an area branch at a time.
- Each active area uses a separate worktree.
- Implementation agents treat the local private backlog and task board as
  read-only and report evidence to the coordinating agent.
- Only the coordinating agent updates private task status and coordination data.
- Independent areas may run in parallel only after their external dependencies
  are integrated into `main` and shared-file ownership is clear.
- A completed planned area may open its single documented pull request to `main`;
  no agent may merge it without explicit project-owner authorization.

## Language policy

- Write all source code in English.
- Use English for file and directory names, modules, classes, interfaces, types,
  enums, database objects, API fields, variables, constants, functions, methods,
  test names, fixtures, logs, error identifiers, code comments, and commit titles.
- Spanish is reserved for user-visible UI content and localized application copy.
- Keep internal identifiers in English even when their displayed UI labels are in
  Spanish.
- Do not mix English and Spanish within identifiers.
- Write all Git and repository collaboration metadata in English, including:
  - descriptive branch names;
  - commit subjects and bodies;
  - pull request titles, summaries, descriptions, checklists, and review comments;
  - issue titles and descriptions;
  - merge and squash messages;
  - release titles, release notes, and technical changelog entries.
- Spanish UI copy may be quoted verbatim when needed to identify the exact text
  under discussion, but the surrounding technical description must be English.

Examples:

- Use `monthlyAverage` for the monthly-average variable.
- Use `RecurringTransaction` for the recurring-transaction type.
- Use `transaction_date` for the corresponding database column.
- A category identifier may be `subscriptions` while its Spanish UI label is
  `Suscripciones`.

## Before starting work

1. Check the current branch and working tree status.
2. Preserve all pre-existing changes made by the user or other agents. Do not
   revert, overwrite, or include them in the task commit.
3. Do not create or switch branches until the user explicitly authorizes branch
   creation.
4. If the user explicitly requests continued work on `main`, remain on `main`
   and make the requested changes there without committing or pushing unless the
   user separately requests those actions.
5. Once the user authorizes the branch workflow, never develop directly on
   `main`. Before modifying files, create a dedicated branch from the base
   specified for the task:

   - New functionality: `feature/<descriptive-name>`.
   - Incident or defect correction: `fix/<descriptive-name>`.
   - Maintenance, tooling, or scaffolding: `chore/<descriptive-name>`.

6. `<descriptive-name>` must contain three or four English lowercase words in
   kebab-case, with no spaces or underscores. Examples:

   - `feature/add-recurring-transactions`
   - `feature/show-monthly-average-metrics`
   - `fix/prevent-duplicate-recurring-entries`
   - `chore/initial-project-scaffolding`

If the task cannot clearly be classified as functionality, a fix, or a chore,
ask the user which branch type to use before continuing.

If uncommitted changes prevent safe branch creation, do not hide or discard them.
Stop and ask the user for instructions.

## Design reference policy

Before creating or modifying UI, read:

- `docs/04-diseno-visual-ux.md`
- `docs/design/references/revolut/README.md`
- `docs/design/references/revolut/style-reference.md`
- `docs/design/references/revolut/design-tokens.json`

Use the reference as visual input, not as a brand implementation to copy. The
product design document takes precedence over raw reference files. Preserve the
dark-first application theme, semantic financial colors, accessibility, and
Spanish user-visible copy. Use English for token names and implementation code.

## Test and coverage integrity policy

Before creating or modifying tests, production code for testability, coverage
configuration, test-runner configuration, or related CI configuration, read and
follow the “Strict coverage and test integrity rules” in
`docs/05-tests-qa.md`.

Those rules are mandatory. In particular:

- never manipulate exclusions, configuration, thresholds, or production code to
  inflate coverage;
- every test must assert meaningful behavior, including relevant success and
  failure paths;
- use mocks or similar isolation techniques only for genuine external
  dependencies, never to bypass actual logic;
- report unreachable or unreasonably testable code instead of hiding it;
- for test changes, run the complete suite and coverage, then report line
  coverage, branch coverage, and remaining uncovered code.

## Before finishing

1. Run the tests and checks relevant to the scope of the change.
2. If a relevant check fails, investigate and fix the cause. Do not commit, push,
   or claim completion while a relevant failure remains.
3. Review the diff and stage only files that belong to the task. Never include
   unrelated changes.
4. Create exactly one Conventional Commit:

   - Functionality: `feat: <short descriptive title>`.
   - Fix: `fix: <short descriptive title>`.
   - Maintenance, tooling, or scaffolding: `chore: <short descriptive title>`.

5. When working on an authorized task branch, push the branch and set its
   upstream when needed:
   `git push -u origin <branch-name>`.
6. Do not open or create a pull request unless the user explicitly requests one.
   If requested, write its title, description, checklist, and subsequent review
   discussion in English. The planned-area authorization defined in the
   collaboration workflow applies only when an agent was assigned that area by
   the coordinator; it does not authorize unrelated pull requests.

When the user has requested work on `main`, do not commit or push unless the user
explicitly requests it. When reporting completion for a branch workflow, include
the branch, commit, checks executed, and push result. If pushing is not possible,
report the exact error and leave the local commit intact.
