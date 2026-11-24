# Sourced by sync-upstream.sh and sync-upstream-scheduled.sh. Must stay bash 3.2 compatible.
#
# rollback_branch <branch> <expected tip> <target>
# Moves <branch> from <expected tip> to <target> and only from there: a commit made on it meanwhile,
# a checkout of it in another worktree or local edits in the way leave it where it is. Returns 0 when
# moved; otherwise prints why not (in Russian, for the report) and returns 1.
rollback_branch() {
  local branch=$1 expected=$2 target=$3 here
  here=$(git symbolic-ref --quiet --short HEAD || true)
  # Why: moving a branch another worktree has checked out turns its files into stray local edits.
  if [ "$here" != "$branch" ] && git worktree list --porcelain | grep -qx "branch refs/heads/$branch"; then
    echo "он открыт в другом worktree"
    return 1
  fi
  # Why the old value: the ref moves only while it is still on the expected tip, in one step.
  if ! git update-ref "refs/heads/$branch" "$target" "$expected" 2>/dev/null; then
    echo "он сдвинулся с $(git rev-parse --short "$expected")"
    return 1
  fi
  [ "$here" = "$branch" ] || return 0
  # Checked out here: the files follow with the same two-tree switch `git checkout` does, which
  # refuses to overwrite local edits; if it refuses, the ref goes back.
  # Why the refresh: read-tree takes a file whose timestamps changed (an unchanged re-save) for an
  # edit, as `git checkout` does not.
  git update-index -q --refresh >/dev/null 2>&1 || true
  if git read-tree -m -u "$expected" "$target" 2>/dev/null; then
    return 0
  fi
  git update-ref "refs/heads/$branch" "$expected" "$target"
  echo "в дереве правки"
  return 1
}
