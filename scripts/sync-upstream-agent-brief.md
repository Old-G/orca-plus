The scheduled upstream sync of this repo (orca-custom, branch `custom`) stopped and needs you. Its report is `.git/custom-sync/last-report.md`; read it first. Exit code: {{CODE}} (1 conflict, 2 checks failed, 5 our changes went missing after the rebase).

Goal: `custom` rebased on the latest upstream `main` with every one of our features intact, verified, then pushed. Nothing of ours may be lost — that is the owner's one hard rule for syncs.

1. Run `scripts/sync-upstream.sh --skip-checks` and resolve each conflict per feature (`Custom-Feature:` trailer): keep upstream's new code and re-apply ours on top of it. Where upstream moved or renamed an API, port our change to the new shape; never drop a feature line to make a conflict go away. Locale JSON: `node .git/custom-sync/tools/locale-merge.mjs <file> --write`. Continue with `scripts/sync-upstream.sh --continue --skip-checks`.
2. If upstream now ships one of our features itself, keep whichever does more; when ours becomes empty, `git rebase --skip` it and say so.
3. After the rebase, read the guard section of the report (full list in `.git/custom-sync/logs/*-guard.md`). Every line it lists must be explained (upstream removed or moved it, we ported it to a new API) or restored. Write the explanations to `.git/custom-sync/guard-accept.md`, one line per item.
4. Typecheck with `node node_modules/typescript/bin/tsc --noEmit -p config/tsconfig.{tc.web,node,tc.cli}.json`; fix each error as `git commit --no-verify --fixup=<owning feature commit>`, then `GIT_EDITOR=true git rebase -q --autosquash main`.
5. Run the whole suite alone (`corepack pnpm test`, Node 24 first on PATH, ORCA_*/CLAUDE* unset, keep TMPDIR). Compare failures with `scripts/sync-known-test-failures.txt`; anything else is a regression to fix.
6. Run `node scripts/sync-upstream-guard.mjs <old base> <old custom> main custom` once more on the final stack (old values are in the report's backup line) and check nothing new appeared.
7. Push with `git push --force-with-lease origin custom` and `git push origin main` (the owner confirms in the Orca+ bell). Do not rebuild or ship Orca+.

Report to the owner in Russian: upstream range, conflicts and how each was resolved, what the guard listed and why each is fine, test result, what you could not verify.
