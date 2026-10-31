// Custom build (hq-request-ledger): an MR note an agent posted with glab — `glab mr note` (glab prints
// the note's URL, `…/merge_requests/12#note_345`) or a POST to `projects/<repo>/merge_requests/<iid>/
// notes` (or `/discussions`) through `glab api`, which prints the note. The repo is the URL's, else
// -R/--repo, else the folder's git remote (glab's own `:fullpath` placeholders mean that one too).
import { tokenizeCommandLine } from '../../../shared/agent-command-line-entrypoint'
import { hqPlaceKey } from '../../../shared/hq-ledger'
import {
  field,
  num,
  parseJsonText,
  responseText,
  sentMessage,
  str,
  type OutgoingSentMessage,
  type RepoOfCwd
} from './outgoing-sent-fields'

type GlabCall = { command: string | null; response: unknown; cwd: string | null }

const SEPARATORS = new Set(['&&', '||', ';', '|'])
const NOTE_URL = /(https?:\/\/\S+?\/-\/merge_requests\/(\d+))#note_(\d+)/
const API_NOTES =
  /^\/?projects\/([^/]+)\/merge_requests\/(\d+)\/(?:notes|discussions(?:\/[^/]+\/notes)?)\/?(?:\?.*)?$/
const FIELD_FLAGS = new Set(['-f', '--raw-field', '-F', '--field'])
const VALUE_FLAGS = new Set([
  ...FIELD_FLAGS,
  '-X',
  '--method',
  '-H',
  '--header',
  '--input',
  '-R',
  '--repo',
  '--hostname'
])
const NOT_A_NEW_NOTE = new Set([
  'list',
  'delete',
  'update',
  'resolve',
  'unresolve',
  'reopen',
  'draft'
])
// Why: agents pass long text as `-m "$(cat <<'EOF' … EOF)"`; the tokens keep the shell's wrapping.
const HEREDOC = /^\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\s*\1\s*\)$/

/** The glab argument lists in a command line, split at `&&`, `;` and pipes. */
function glabCalls(command: string): string[][] {
  const calls: string[][] = []
  let words: string[] = []
  for (const token of [...tokenizeCommandLine(command), '&&']) {
    if (!SEPARATORS.has(token)) {
      words.push(token)
      continue
    }
    const at = words.findIndex((word) => word === 'glab' || word.endsWith('/glab'))
    if (at !== -1) {
      calls.push(words.slice(at + 1))
    }
    words = []
  }
  return calls
}

/** `-m text`, `--message=text`; the value after a flag, or after its `=`. */
function flagValue(args: readonly string[], names: readonly string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    for (const name of names) {
      if (arg === name && index + 1 < args.length) {
        return args[index + 1]
      }
      if (name.startsWith('--') && arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1)
      }
    }
  }
  return null
}

function unwrapped(text: string | null): string | null {
  return text ? (HEREDOC.exec(text)?.[2] ?? text) : null
}

async function repoOf(args: readonly string[], cwd: string | null, repoOfCwd: RepoOfCwd) {
  const named = flagValue(args, ['-R', '--repo'])
  if (named) {
    return repoOfGitRemote(named) ?? named
  }
  return cwd ? repoOfCwd(cwd) : null
}

async function mrNote(
  args: string[],
  stdout: string,
  cwd: string | null,
  repoOfCwd: RepoOfCwd
): Promise<OutgoingSentMessage | null> {
  const rest = args[0] === 'create' ? args.slice(1) : args
  const posted = NOTE_URL.exec(stdout)
  if (NOT_A_NEW_NOTE.has(rest[0] ?? '') || !posted) {
    // Why: no URL printed means glab posted nothing (a failure, or `--unique` found the same note).
    return null
  }
  const [, url, iid, id] = posted
  const repo = hqPlaceKey(url) ? null : await repoOf(rest, cwd, repoOfCwd)
  const key = hqPlaceKey(url) ?? (repo ? `gitlab:${repo}!${iid}` : null)
  const text = unwrapped(flagValue(rest, ['-m', '--message'])) ?? 'MR note'
  return key ? sentMessage(key, `note:${id}`, text, { link: `${url}#note_${id}` }) : null
}

async function apiNote(
  args: string[],
  stdout: string,
  cwd: string | null,
  repoOfCwd: RepoOfCwd
): Promise<OutgoingSentMessage | null> {
  const endpoint = args.find(
    (arg, index) => !arg.startsWith('-') && !VALUE_FLAGS.has(args[index - 1] ?? '')
  )
  const path = API_NOTES.exec(endpoint ?? '')
  const explicit =
    flagValue(args, ['-X', '--method']) ??
    args.find((arg) => /^-X[A-Z]+$/.test(arg))?.slice(2) ??
    null
  const fields = args.some((arg) => FIELD_FLAGS.has(arg) || arg === '--input')
  const method = (explicit ?? (fields ? 'POST' : 'GET')).toUpperCase()
  if (!path || method !== 'POST') {
    return null
  }
  const project = decodeURIComponent(path[1])
  const repo = project.startsWith(':')
    ? await repoOf(args, cwd, repoOfCwd)
    : project.includes('/')
      ? project
      : null
  const json = parseJsonText(stdout)
  const note = field(field(json, 'notes'), '0') ?? json
  const id = num(field(note, 'id'))
  if (!repo || !id) {
    return null
  }
  const body =
    str(field(note, 'body')) ??
    args
      .flatMap((arg, index) => (FIELD_FLAGS.has(args[index - 1] ?? '') ? [arg] : []))
      .find((value) => value.startsWith('body='))
      ?.slice(5) ??
    null
  return sentMessage(`gitlab:${repo}!${path[2]}`, `note:${id}`, unwrapped(body))
}

/** The MR note a Bash call posted through glab; null when it posted none. */
export async function glabNoteMessage(
  call: GlabCall,
  repoOfCwd: RepoOfCwd
): Promise<OutgoingSentMessage | null> {
  if (
    !call.command ||
    !/\bglab\b/.test(call.command) ||
    field(call.response, 'interrupted') === true
  ) {
    return null
  }
  const stdout = responseText(call.response)
  for (const args of glabCalls(call.command)) {
    const found =
      args[0] === 'mr' && args[1] === 'note'
        ? await mrNote(args.slice(2), stdout, call.cwd, repoOfCwd)
        : args[0] === 'api'
          ? await apiNote(args.slice(1), stdout, call.cwd, repoOfCwd)
          : null
    if (found) {
      return found
    }
  }
  return null
}

/** `group/name` from a git remote: `git@host:group/name.git`, `https://host/group/name.git`. */
export function repoOfGitRemote(remote: string): string | null {
  const trimmed = remote.trim()
  const scp = /^[\w.-]+@[\w.-]+:(?!\/)(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (scp) {
    return scp[1].includes('/') ? scp[1] : null
  }
  try {
    const path = new URL(trimmed).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
    return path.includes('/') ? path : null
  } catch {
    return null
  }
}
