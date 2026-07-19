# Agent Workflow Constraint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an SQL ERD focus request from completing after inspection without calling `focus_sql_erd_tables`.

**Architecture:** Derive a small planner workflow constraint from the latest completed tool result. Pass the constraint to the planner payload and tighten the structured-output schema for that turn so the model performs semantic table selection but cannot terminate the workflow early.

**Tech Stack:** Python 3, OpenAI Responses structured output, pytest

## Global Constraints

- Do not change Agent API, SQLtoERD API, DB schema, or Frontend behavior.
- Keep the implementation in `apps/ai-worker/app/agent_processor.py` and its focused tests.
- Run only the SQL ERD workflow-related pytest selection requested by the user.
- Preserve existing focus input validation and App Server fingerprint validation.

---

### Task 1: Reproduce the premature completion path

**Files:**
- Modify: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Consumes: `AgentPlanningRequest`, `_agent_planner_schema`, `_agent_planner_user_prompt`
- Produces: regression expectations for a constrained SQL ERD planner turn

- [x] **Step 1: Write a failing test for the inspect-to-focus constraint**

Create a request containing `inspect_sql_erd_schema` and `focus_sql_erd_tables`, with `planning_context` ending in a valid inspection projection. Assert that the user prompt contains `workflowConstraint.requiredToolName == "focus_sql_erd_tables"`, the schema status enum excludes `completed`, and the tool-name enum permits only focus or null.

- [x] **Step 2: Write a failing test for terminal focus completion**

Append a `tool focus_sql_erd_tables` result after the inspection and assert the user payload has no workflow constraint and the normal schema permits `completed`.

- [x] **Step 3: Run the two tests and verify RED**

Run:

```powershell
& 'C:\Users\ejaj1\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m pytest tests/test_agent_processor.py -q -k "sql_erd_planner_workflow_constraint"
```

Expected: FAIL because workflow-constraint derivation and constrained schema arguments do not exist.

### Task 2: Add the minimal planner workflow constraint

**Files:**
- Modify: `apps/ai-worker/app/agent_processor.py`

**Interfaces:**
- Produces: `AgentPlannerWorkflowConstraint`, `_agent_planner_workflow_constraint(request)`, constrained `_agent_planner_schema(constraint)` and `_agent_planner_user_prompt(request, constraint)`
- Consumes: the latest bounded tool-result line in `planning_context`

- [x] **Step 1: Add constraint derivation**

Add an immutable constraint type and a helper that inspects the most recent `tool <name>: <json>` line. Return a focus constraint only when the latest tool is `inspect_sql_erd_schema`, its output contains a projection table list, and focus exists in the provided tools.

- [x] **Step 2: Wire the constraint into planner input and schema**

Compute the constraint once in `OpenAiAgentPlannerClient.plan()`. Add a generic system rule for constrained turns, include `workflowConstraint` in the user JSON, exclude `completed`/`unsupported` from the constrained status enum, and restrict `toolName` to focus or null.

- [x] **Step 3: Run the regression tests and verify GREEN**

Run the Task 1 command. Expected: both workflow constraint tests pass.

### Task 3: Focused verification and review

**Files:**
- Verify: `apps/ai-worker/app/agent_processor.py`
- Verify: `apps/ai-worker/tests/test_agent_processor.py`

**Interfaces:**
- Consumes: completed Tasks 1 and 2
- Produces: verified SQL ERD planner behavior with no unrelated changes

- [x] **Step 1: Run related SQL ERD tests**

```powershell
& 'C:\Users\ejaj1\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m pytest tests/test_agent_processor.py -q -k "sql_erd_table_focus or sql_erd_focus or sql_erd_planner_workflow_constraint"
```

Expected: all selected tests pass.

- [x] **Step 2: Review the diff**

Run `git diff --check` and `git diff --stat`. Confirm there are no API, DB, Frontend, dependency, or unrelated file changes.
