# Module Preview Workflow

This project uses a modular monolith, so modules are not true standalone apps. For fast review, each Module Codex can run its own isolated preview copy of the shared app-shell from that Codex worktree.

This lets the user inspect one module's current branch immediately without waiting for Integration Codex to merge every module.

## What This Solves

- Module Codex can restart its own preview without blocking the shared `runtime/server`.
- The preview uses unique per-agent ports, so multiple Codex sessions can show work at the same time.
- The preview shows that Codex branch only. It is not the final combined staging app.

## Default Ports

The helper script assigns ports from the Codex identity:

```text
codex-3 -> API 8203, web 8303
codex-4 -> API 8204, web 8304
codex-12 -> API 8212, web 8312
```

The shared app remains:

```text
API 8100
web 8180
```

Do not use the shared ports for module previews.

## Start Or Restart A Module Preview

From that Codex worktree:

```bash
export AI_COORD_STATE_DIR=/home/threejmain/.ai_coord
./scripts/start_module_preview.sh codex-3 billing billing-form-modals
```

The script:

1. Locks `runtime/preview/<agent>`.
2. Stops that agent's previous preview process if one exists.
3. Starts FastAPI on the agent API port.
4. Starts Vite on the agent web port.
5. Points Vite `/api` and `/health` to that preview API.
6. Releases the preview runtime lock after startup checks.

## Integration Still Combines Work

Preview servers do not combine module work.

The final combination is still:

```text
Module Codex branch previews -> Integration Codex combines module branches -> staging -> master
```

Pushing a module Codex branch does not automatically combine it with other module branches. Pushing to `staging` combines outputs only when Integration Codex has already merged the selected module changes into one staging-ready result and the user explicitly approves pushing that result to `staging`.

## Brand-New Modules

If a module is not registered in `app-shell/` yet, its preview API can run but the page will not appear in the shared navigation.

Do not have the Module Codex edit `app-shell/` just for visibility. Ask Integration Codex to do the one-time app-shell wiring for the new module, then let the Module Codex continue module-local work and previews from that integrated base.

## When To Use Shared Runtime

Use the shared `runtime/server` lock only when changing the central Docker/shared runtime on ports `8100`, `8180`, or `5432`.

Use `runtime/preview/<agent>` when starting or restarting a module preview on per-agent ports.
