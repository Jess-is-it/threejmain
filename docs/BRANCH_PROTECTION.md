# Branch Protection

Configure branch protection in the GitHub UI under repository settings. The current project workflow allows coordinated Codex sessions to push directly to both `staging` and `master`, so branch protection must not require Pull Requests unless the user intentionally switches back to a PR-gated release process.

## `master` Ruleset

Ruleset name:

```text
protect-master-production
```

Target branch:

```text
master
```

Enforcement:

```text
Active
```

Recommended rules:

- Restrict deletions: enabled
- Block force pushes: enabled
- Require a pull request before merging: disabled for the direct Codex push workflow
- Required approvals: only applicable if Pull Requests are enabled later
- Require conversation resolution before merging: only applicable if Pull Requests are enabled later
- Require status checks: only enable if CI checks exist
- Restrict updates: leave disabled unless you understand bypass permissions
- Require linear history: optional
- Require signed commits: optional

## `staging` Ruleset

Ruleset name:

```text
protect-staging-integration
```

Target branch:

```text
staging
```

Enforcement:

```text
Active
```

Recommended rules:

- Restrict deletions: enabled
- Block force pushes: enabled
- Require a pull request before merging: disabled for the direct Codex push workflow
- Required approvals: only applicable if Pull Requests are enabled later
- Require conversation resolution before merging: only applicable if Pull Requests are enabled later
- Require status checks: only enable if CI checks exist
- Restrict updates: leave disabled unless you understand bypass permissions
- Require linear history: optional

## Codex Branches

Codex branches under `codex/*` are no longer part of the normal workflow. If the user explicitly requests an isolated experiment branch, it does not need branch protection because it is temporary and should not be promoted directly to production.

If GitHub CLI is installed and authenticated, branch protection can be inspected with `gh api`. Do not apply remote branch protection changes unless the user explicitly approves them.
