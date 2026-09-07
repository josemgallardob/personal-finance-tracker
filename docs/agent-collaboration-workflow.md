# Agent collaboration workflow

## Purpose

This document defines how the coordinating agent and implementation agents work
together without duplicating work, sharing branches concurrently, or publishing
private planning documents. It applies whenever implementation is split across
multiple agents and worktrees.

The project owner remains the final authority for product decisions and changes
to this workflow. The coordinator has the authority to enqueue verified area
pull requests; GitHub performs the merge commit after the merge-group checks
pass.

## Orca as the orchestration layer

Orca is the provider-agnostic orchestration layer for this workflow. It owns the
coordination runtime and launches agent CLIs; it is not itself the implementation
agent or a replacement for GitHub. A coordinator can assign different areas to
Codex, Claude Code, Cursor CLI, Gemini, OpenCode, or another supported CLI without
changing the task contract or Git workflow. Integration depth and model controls
vary by agent, so the coordinator records the effective launch configuration.

The relevant Orca concepts are:

| Orca concept | Meaning in this project                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| **Run**      | One coordination namespace for an implementation session and its coordinator inbox.                  |
| **Task**     | A logical work item mapped to a private-board ID such as `TX-02`.                                    |
| **Dispatch** | One concrete attempt to execute a Task. A retry creates a new Dispatch without duplicating the Task. |
| **Worker**   | The CLI agent process that implements a Dispatch in its assigned worktree.                           |
| **Message**  | Heartbeats, questions, escalations, and completion reports exchanged through Orca.                   |
| **Gate**     | A coordinator-owned decision that blocks dependent Tasks until it is resolved.                       |

The execution relationship is:

```text
Orca Run
  ├── private-board task TX-02
  │    ├── Dispatch 1 → Codex worker → failed
  │    └── Dispatch 2 → Claude worker → worker_done
  └── Gate → pending product decision
```

The coordinator creates or selects the Run, creates Tasks with dependencies,
launches Workers, consumes messages, and validates output. A Worker reports that
it has finished; it does not decide that a task is verified, that a PR is
mergeable, or that a product requirement is accepted.

For an isolated area, the coordinator should launch a new worktree and choose the
agent and model explicitly when supported:

```bash
orca orchestration worker-start \
  --task <orca-task-id> \
  --worktree new-child \
  --name transaction-services \
  --agent codex \
  --model <provider-model-id> \
  --effort high \
  --json
```

`--agent` selects the CLI harness, `--model` is an opaque model identifier for
that harness, and `--effort` is valid only when the selected agent/model supports
it. The project policy is therefore agent-neutral: use the strongest suitable
worker for the area, but keep the same task scope, tests, commits, evidence, and
review gates. Provider authentication and model availability remain host
configuration, not secrets to place in this repository.

Workers use Orca's structured completion protocol. A completion message includes
the Orca `taskId`, its `dispatchId`, outcome, summary, tests, coverage, remaining
gaps, blockers, and next action. Long-running workers send heartbeats; questions
use the coordinator message channel; unresolved product choices become Gates
rather than guesses. If a worker fails, retry the same logical Task with a new
Dispatch and retain the failure evidence.

The current Orca flow is `Run` plus `worker-start`. Do not rely on legacy
coordinator start/stop commands if the installed Orca version reports them as
retired. See the [Orca orchestration guide](https://www.onorca.dev/docs/cli/orchestration)
and [supported agents](https://www.onorca.dev/docs/agents/supported) for
provider-specific launch behavior.

## Sources of truth

| Information                         | Source of truth                                 | Editor                                         |
| ----------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| Repository policy                   | `AGENTS.md`                                     | Project owner or explicitly assigned agent     |
| Product and technical specification | Tracked files under `docs/`                     | Agent assigned to the documentation change     |
| Accepted implementation             | `main` and its Git history                      | Changed only through the approved Git workflow |
| User stories                        | Private `docs/07-user-story-backlog.md`         | Coordinating agent                             |
| Task status and evidence            | Private `docs/08-agent-implementation-tasks.md` | Coordinating agent                             |

The two private paths are ignored symbolic links into the Git common directory.
All worktrees belonging to this clone read the same underlying files. They must
never be forced into Git, copied into a pull request, or quoted in public metadata.
A separate clone does not receive them automatically.

## Roles and authority

### Project owner

The project owner:

- chooses product priorities and accepts or rejects unresolved product decisions;
- decides when an area may start if prioritization is ambiguous;
- may request exceptional review or intervention in the merge workflow;
- may reassign the coordinator or an area owner explicitly.

No agent may infer product acceptance from silence. Merge authority follows the
verified-area and required-checks policy defined in the pull request lifecycle.

### Coordinating agent

The coordinating agent is the only agent allowed to edit the private user-story
backlog and implementation task board. It:

- checks task dependencies and accepted decisions against `main`;
- marks tasks ready, assigns an area owner, and records the relevant worktree;
- ensures that no two agents own the same branch, area, or mutable shared file;
- receives and verifies task reports, commit identifiers, test results, coverage,
  blockers, and pull request status;
- updates the private task board after each verified transition;
- coordinates review, integration, cleanup, and the next available work;
- records product decisions only after an explicit response from the owner.

The coordinator normally does not implement production tasks while coordinating
parallel areas. A small intervention must be explicitly assigned and follow the
same branch, commit, evidence, and review rules as any other implementation.

### Implementation agent

An implementation agent owns one area at a time and:

- works only in the assigned worktree, branch, and task scope;
- reads `AGENTS.md`, this workflow, the assigned task, its cited user stories,
  and the immediate dependency contracts before changing code;
- treats the two private planning documents as read-only;
- implements tasks sequentially, normally producing one commit per task;
- includes meaningful tests and documentation required by the task in that commit;
- runs the required checks and reports exact results to the coordinator;
- stops and reports scope conflicts, unmet dependencies, or product ambiguity;
- does not start another task or area until it is assigned.

An implementation agent must not change another agent's branch, worktree, task
state, migration, lockfile, or shared contract without coordinator reassignment.

## Unit of ownership

One area is the normal unit of agent ownership. Its tasks are the units of review
and commit history. This keeps context bounded while allowing one agent to retain
the local knowledge needed for three or four related commits.

Only one agent may write to an area branch at a time. If an area is handed to a
new agent, the previous owner must stop, push its last coherent commit, and send a
handoff report. The coordinator records the handoff before the new agent starts.

Independent areas may run in parallel when all their external dependencies are
already integrated into `main` and they do not contend for an explicitly shared
resource. Typical collision points include migrations, dependency lockfiles,
public DTO contracts, CI configuration, and application-wide design tokens.

## Dependency rules

- A dependency in another area must be verified as integrated in `main` before a
  consumer area branch is created.
- An accepted decision may satisfy a decision dependency only when its final rule
  and affected contracts have been recorded.
- A dependency within the same area may be satisfied by a verified earlier commit
  on the same branch.
- Pull requests are not dependency boundaries. Do not build a consumer branch on
  top of another open pull request unless the project owner explicitly approves a
  stacked-branch exception.
- If an upstream contract must change, the agent stops and reports the impact. The
  coordinator decides whether to reopen the upstream area or create a bounded task.

The coordinator may prepare independent UI foundations and persistence foundations
in parallel, but it must not assign a frontend integration before the API contract
it consumes is integrated.

## Area lifecycle

### 1. Readiness review

Before opening an area, the coordinator verifies:

1. The local checkout is clean and `main` matches the intended remote base.
2. Every external dependency required by the entire area is integrated.
3. Every blocking product decision is explicitly accepted.
4. No active agent owns the proposed branch or overlapping scope.
5. The branch name, task order, and expected pull request target are recorded.

The coordinator then changes the first eligible task from `PENDIENTE` to `LISTA`
or `EN_CURSO` in the private board and records the owner and start date. These
Spanish labels are quoted exactly because they are the canonical values used by
the private Spanish task board.

### 2. Worktree provisioning

The coordinator creates a dedicated branch and worktree from updated `main` using
the naming rules in `AGENTS.md`. The repository-local `post-checkout` hook links
the shared private planning files into the new worktree.

The assigned agent verifies before editing:

```bash
git status --short --branch
git check-ignore -v \
  docs/07-user-story-backlog.md \
  docs/08-agent-implementation-tasks.md
readlink -f docs/08-agent-implementation-tasks.md
```

If either private path is missing, is not ignored, or is a regular tracked file,
the agent stops and reports the condition. It must not recreate the private data
from memory or publish a replacement.

### 3. Task implementation

Before each task, the implementation agent reads only the context routed by its
task card plus mandatory repository policies. It checks the preceding commit and
confirms that the task is still unclaimed and applicable.

The task commit contains:

- the requested implementation and no unrelated refactor;
- meaningful success, failure, boundary, and important branch tests;
- migrations or generated files genuinely required by that task;
- public contract documentation when behavior changes.

Every commit must compile and pass checks relevant to its scope. Testing and
coverage work follows `docs/05-tests-qa.md`; it is not deferred to a final cleanup
commit and coverage configuration is never manipulated.

If a task is too large for a reviewable commit, the agent does not silently expand
it. It proposes derived task IDs and boundaries to the coordinator, who updates
the private board before implementation continues.

### 4. Task report and verification

After committing and pushing a task, the agent sends this report:

```text
Task: TX-02
Status: ready for verification
Branch: feature/add-transaction-business-services
Commit: <full-or-short-sha>

Implemented:
- <meaningful behavior>

Verification:
- <command>: <passed/failed and relevant count>
- Line coverage: <value>
- Branch coverage: <value>
- Remaining uncovered lines/branches: <paths and reason, or none>

Blockers:
- <concrete blocker, or none>

Suggested next task:
- <task id and immediate action>
```

The report must contain observed results, never planned commands presented as if
they ran. If Orca messaging is unavailable, the agent returns the same report to
the project owner or coordinator for forwarding; the task is not considered
verified until the coordinator has observable evidence.

The coordinator checks the branch, diff, commit, tests, coverage, Orca Dispatch
receipt, and task contract. It then updates the private board:

- `VERIFICADA` when implementation and evidence satisfy the task;
- `BLOQUEADA` with a concrete owner and next action when progress cannot continue;
- remains `EN_CURSO` when corrections are still required.

Only after this update may the agent begin the next task in the area.

### 5. Pull request

When every implementation task in the area is verified, the implementation agent
(worker) opens one pull request from the area worktree branch to `origin/main`.
This project workflow authorizes that area pull request; it does not authorize
pull requests for unrelated work.

The pull request:

- contains the individual task commits from that area;
- uses English title, summary, checklist, and review discussion;
- describes behavior and public requirements without copying private backlog text;
- reports tests, line and branch coverage, remaining gaps, migrations, and risks;
- is configured for GitHub's merge-commit strategy; squash and rebase merges are
  not used for area pull requests;
- waits for all configured GitHub Actions checks.

The coordinator records the pull request as `EN_PR`. Review corrections stay on
the same area branch and are associated with the affected task. The resulting
history should retain meaningful task boundaries; fixup commits may be squashed
into their task before merge when this can be done without disrupting another
agent.

When the required pull-request checks pass, the coordinator verifies the scope
and adds that area pull request to GitHub's merge queue with `Merge when ready`.
GitHub creates a `merge_group` from the latest `origin/main` and any pull
requests ahead in the queue, then runs the required checks against that exact
composition. If those checks pass, GitHub automatically creates the configured
merge commit. This standing workflow authorization applies only to the pull
request opened by the worker for the verified area; it does not authorize
enqueueing unrelated pull requests, bypassing failed or pending checks, or
resolving review conflicts without the required decision. The coordinator
records the queue entry, merge result, and checks that were green before
continuing with cleanup. If the merge group fails, the worker corrects the same
area branch and the PR returns through both check stages.

### 6. Integration and cleanup

After GitHub merges the pull request from the merge queue, the coordinator:

1. Fetches `origin` and updates the `main` branch in the original coordinator
   worktree (the repository checkout under `/repos`) with
   `git pull --ff-only origin main`. That local `main` must remain synchronized
   with `origin/main` after every merged pull request.
2. Verifies that the expected implementation and checks are present on both
   `origin/main` and the local `main`.
3. Records the resulting integration commit and marks the area tasks `INTEGRADA`.
4. Confirms that the merge commit was created by the merge queue and makes newly
   satisfied dependent tasks ready.
5. Confirms that the worker worktree has no uncommitted changes, removes that
   worktree, and removes its local area branch.
6. Deletes the merged area branch from the remote with
   `git push origin --delete <area-branch>`.

An open or merged pull request is not sufficient evidence by itself. If the code
is missing from `main`, reverted, or its required checks failed, the task is not
marked integrated.

## Blocking and escalation

An implementation agent stops and reports instead of guessing when:

- an acceptance rule has more than one materially different interpretation;
- a required dependency is absent from `main`;
- existing user changes overlap the assigned files;
- implementation requires changing a contract owned by another area;
- a migration or destructive operation has an unclear target;
- tests expose a pre-existing failure that prevents reliable verification;
- credentials, infrastructure access, or product-owner authority are required.

A useful blocker report states the observed evidence, affected task IDs, options,
recommended next action, and who can resolve it. The coordinator updates the board
and either reassigns independent work or asks the project owner for a decision.

## Private-board update rules

Implementation agents see updates immediately through the shared symbolic links,
but they never edit those files. The coordinator updates the board:

- when reserving or handing off a task;
- after checking each task report and commit;
- when a blocker appears or is resolved;
- when a pull request opens or CI changes status;
- after confirming integration into `main`.

The coordinator records responsible agent, branch, commit, commands, coverage,
uncovered paths, Orca agent/model/effort, Dispatch ID, blocker, next action, pull
request, and integration evidence. It does not invent missing SHAs, Dispatch IDs,
test results, or timestamps.

The single-editor restriction is operational rather than a Unix permission: all
agents on the VPS normally use the same operating-system account. If the project
owner reassigns the coordinator, the previous editor finishes its write first and
the new editor rereads the canonical document before updating it.

## Session completion checklist

### Implementation agent

- Work is limited to the assigned task and branch.
- Relevant checks and the complete required suite were actually run.
- Coverage and remaining gaps are reported without manipulation.
- The task commit and push are identifiable.
- No private planning file is staged or published.
- The coordinator received a report and a concrete next step.

### Coordinating agent

- The private board matches observable Git and CI state.
- No area, branch, worktree, or shared file has multiple owners.
- Newly ready work respects integrated dependencies and accepted decisions.
- Area pull requests are added to the merge queue by the coordinator only after
  the PR checks pass and the scope has been verified; GitHub performs the merge
  commit only after the merge-group checks pass.
- Completed worktrees are removed only after checking for local changes.
