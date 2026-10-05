---
allowed-tools: Read, Edit, Write, Grep, Glob, Agent, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git show:*), Bash(git merge-base:*), Bash(git ls-files:*), Bash(pnpm:*)
description: Resolve the conflicts of a merge that stopped half way
argument-hint: "[context about the PR, e.g. its number and branches]"
---

A merge stopped on conflicts in this working tree. Resolve them so the result keeps the intent of both sides, then prove it still builds.

Context from the caller: $ARGUMENTS

**Rules for you and every subagent you launch:**
- Never stage, commit, push, abort the merge, or check out another ref. The caller owns the git state.
- Never take one side wholesale to make a conflict go away. A side is dropped only when the other side deliberately replaced it, and you can name the commit that did.
- If a hunk cannot be resolved with confidence, leave its conflict markers in place and say why in the summary. A marker left on purpose is better than a guess.

Follow these steps precisely:

1. Run `git diff --name-only --diff-filter=U` to list the conflicted files. If the list is empty, say so and stop.

2. Launch a haiku agent to return the paths (not contents) of the root `AGENTS.md` and of every `AGENTS.md` in a directory that holds a conflicted file or one of its parents. Read them. They are the rules the resolution has to satisfy.

3. Learn what each side was for. For each conflicted file, read `git log --merge --oneline -- <file>` and the commits it lists with `git show`. `HEAD` is the PR branch, `MERGE_HEAD` is the branch being merged in. Write down, per file, the intent of each side in one line.

4. Resolve each file:
   - Lockfiles (`pnpm-lock.yaml`): take either side, then run `pnpm install` so the lockfile is regenerated from the merged manifests. Never hand-merge a lockfile.
   - Generated files: regenerate them with the command that produces them instead of merging text.
   - Everything else: rewrite each conflicted hunk so both intents survive. When one side renamed or moved something the other side still uses, carry the other side's change over to the new name or place.
   - Where several files conflict independently, you may launch one subagent per file in parallel. Give each one the intents from step 3 and the rules above.

5. Check the result:
   - No `<<<<<<< ` or `>>>>>>> ` line remains in a conflicted file, except the ones you left on purpose.
   - Find the workspace package of every file you changed, and run that package's tests and typecheck (`pnpm --filter <package> test`, `pnpm --filter <package> typecheck`). Fix what fails when the failure comes from the merge. Report a failure that already exists on either side without fixing it.

6. Print a summary:
   - Each conflicted file, with one line on how it was resolved.
   - Each marker left on purpose, with its file, the two intents, and why you could not reconcile them.
   - The test and typecheck commands you ran and whether they passed.
