import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseHqRemoteNoApprove } from '../hq-autonomy'
import { OWN_TEMP_CLEANUPS } from './__fixtures__/remote-temp-cleanups'
import { classifyOutgoingToolCall } from './outgoing-action-classifier'
import { setRemoteNoApprove } from './outgoing-remote-own-rules'

const AUTONOMY = [
  'default: 1',
  'remote_no_approve:',
  '  hosts: myserver',
  '  containers: api-mcp-check, *-check, *-shadow',
  '  rm_paths: ~/shadow_*, ~/tmp/*, /tmp/*',
  '  mktemp: yes'
].join('\n')

const held = (command: string) => classifyOutgoingToolCall('Bash', { command }) !== null

describe('own server work from HQ autonomy.yaml (plan 15.17)', () => {
  beforeEach(() => setRemoteNoApprove(parseHqRemoteNoApprove(AUTONOMY)))
  afterEach(() => setRemoteNoApprove(null))

  it.each([
    `ssh myserver 'docker exec -u root acme-api-1 sh -c "rm -f /tmp/pp_*.py /tmp/first_line_new.py; ls /tmp"'`,
    `ssh myserver 'cd ~/api && docker run -d --name api-mcp-check -p 127.0.0.1:8339:8300 api:1 >/dev/null; sleep 5; docker logs api-mcp-check 2>&1 | tail -15; docker rm -f api-mcp-check >/dev/null'`,
    `ssh myserver 'docker rm -f agents-check agents-shadow >/dev/null 2>&1; docker run -d --name agents-check img'`,
    `ssh myserver 'docker container rm --force api-mcp-check'`,
    `ssh myserver 'rm -f ~/shadow_check.sh && echo removed'`,
    `ssh myserver 'rm -rf ~/tmp/deploy-2510 ~/shadow_old'`,
    `ssh myserver 'docker exec -u root agents rm -rf /tmp/la /tmp/la.tgz; rm -f /tmp/la.tgz /tmp/calls.py'`,
    `git archive --format=tar HEAD | ssh myserver 'D=$(mktemp -d) && tar -x -C "$D" && docker cp "$D/." api-mcp-check:/app && rm -rf "$D"'`,
    `ssh myserver 'D=$(mktemp -d); git -C ~/repo archive HEAD | tar -x -C $D; rm -rf $D'`,
    `S=/private/tmp/claude-501/x/scratchpad; rm -rf $S/ship2 && mkdir -p $S/ship2 && ssh -O check myserver && ssh myserver 'rm -f ~/tmp/ship2.tgz'`,
    `ssh -o ControlPath=~/.ssh/cm me@myserver "rm -f /tmp/x.py" 2>&1 | tail -2`,
    `ssh myserver 'rm -f /tmp/check.log  # cleanup'`,
    `ssh myserver 'cd ~/api && umask 077 && F=$(mktemp) && cat > $F; grep -c x $F; rm -f $F'`,
    "S=/private/tmp/x/scratchpad; python3 - <<EOF\ns = open('$S/a.py').read() + '''\nEOF\nrm -f $S/a.py; ssh myserver 'rm -f /tmp/a.py'",
    "ssh myserver bash <<'EOF'\ncd ~/api\nrm -rf ~/tmp/deploy-2510\nEOF",
    `ssh myserver true; rm -rf /tmp/x.log`,
    `ssh myserver 'docker rm -f api-mcp-check' 2>&1 | tail -2`,
    `ssh myserver '(cd ~/api && rm -rf ~/tmp/deploy-2510)'`
  ])('passes %s', (command) => {
    expect(held(command)).toBe(false)
  })

  it.each([
    `ssh myserver 'rm -rf ~/'`,
    `ssh myserver 'rm -rf ~/*'`,
    `ssh myserver 'rm -rf /tmp/*'`,
    `ssh myserver 'rm -rf /srv/app'`,
    `ssh myserver 'rm -rf /tmp/../srv'`,
    `ssh myserver 'rm -rf ~/tmp/x/../../'`,
    `ssh myserver 'rm -rf "~/tmp/x"'`,
    `ssh myserver 'docker rm -f acme-bridge'`,
    `ssh myserver 'docker rm -f -v api-mcp-check'`,
    `ssh myserver 'docker rm -f $(docker ps -aq)'`,
    `ssh myserver 'docker volume rm api-mcp-check'`,
    `ssh myserver 'docker exec db psql -c "DELETE FROM sessions"'`,
    `ssh myserver 'docker exec db mysql -e "DROP TABLE orders"'`,
    'psql -h db.prod.internal -c "DROP TABLE orders"',
    'mysql -h db.prod.internal -e "DELETE FROM orders" && ssh myserver "rm -f /tmp/x.py"',
    `ssh myserver 'rm -f ~/shadow_check.sh && rm -rf /srv/app'`,
    `ssh myserver 'docker rm -f api-mcp-check; docker rm -f acme-agents'`,
    `ssh other-box 'rm -rf ~/tmp/x'`,
    `ssh myserver 'rm -f /tmp/x.py'; ssh prod 'rm -rf ~/tmp/y'`,
    `ssh myserver 'rm -rf /tmp/x'' /srv'`,
    `ssh myserver "rm -rf /tmp/x" /srv`,
    `ssh myserver 'rm -f /tmp/x >/dev/null /srv'`,
    `ssh myserver 'ls /tmp/x* | xargs rm -rf /tmp/x1'`,
    `ssh myserver 'rm -rf $HOME'`,
    `S=/tmp/x; ssh myserver 'rm -rf $S/*'`,
    `cd /nope && S=/tmp/x; ssh myserver true; rm -rf $S/*`,
    `(S=/tmp/x); rm -rf $S/y; ssh myserver true`,
    `S=/tmp/x; for S in /srv; do :; done; rm -rf $S; ssh myserver true`,
    `D=$(mktemp -d); rm -rf $D/*; ssh myserver true`,
    `ssh myserver 'TRUNCATE events'`,
    `cd /x && S=/tmp/x; rm -rf $S/y; ssh myserver true`,
    "S=/tmp/x\nssh myserver bash <<'EOF'\nrm -rf $S/*\nEOF",
    `S=/tmp/x; echo "<<EOF"\nssh myserver 'rm -rf $S/*'`,
    'python3 - <<EOF\nS=/tmp/x\nEOF\nrm -rf $S/*; ssh myserver true',
    `ssh myserver "S=/tmp/x; rm -rf $S/srv"`,
    `ssh myserver "sh -c 'S=/tmp/x; rm -rf $S/srv'"`,
    'ssh myserver bash <<EOF\nS=/tmp/x\nrm -rf $S/srv\nEOF',
    "ssh myserver 'if false\nthen\nS=/tmp/x\nfi\nrm -rf $S/srv'",
    "ssh myserver 'f(){\nS=/tmp/x\n}\nrm -rf $S/srv'",
    "ssh myserver bash <<'EOF'\n(\nS=/tmp/x\n)\nrm -rf $S/srv\nEOF",
    `ssh myserver 'IFS=a; S=/tmp/a/srv; rm -rf $S'`,
    `ssh myserver 'S=/tmp/x; eval S\\=/srv; rm -rf $S'`,
    `ssh myserver 'S=/tmp/x; S[0]=/srv; rm -rf $S'`,
    `ssh myserver 'PWD=/tmp/x; cd /srv; rm -rf $PWD'`,
    `ssh myserver 'rm -rf /tmp/x <(true) /srv'`,
    `ssh myserver 'rm -rf /tmp/x' <(true) /srv`,
    `ssh myserver 'rm -rf /tmp/x >$(echo /tmp/y) /srv'`,
    `ssh myserver 'rm -f /tmp/x > /srv/app/db.sqlite'`,
    `ssh myserver 'docker ps -aq | xargs docker rm -f api-mcp-check'`,
    `ssh -o HostName=prod.example myserver 'docker rm -f api-mcp-check'`,
    `ssh -F ./other myserver 'rm -rf ~/tmp/x'`,
    `ssh -vF ./other myserver 'rm -rf ~/tmp/x'`,
    `ssh -qo HostName=prod.example myserver 'rm -rf ~/tmp/x'`,
    `ssh -o Include=./other myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'rm -rf ~/tmp/link/data'`,
    `ssh -o "HostName=prod.example" myserver 'docker rm -f api-mcp-check'`,
    `ssh myserver -o HostName=prod.example 'docker rm -f api-mcp-check'`,
    `ssh myserver 'ln -sfn /srv /tmp/x && rm -rf /tmp/x/*'`,
    `ssh myserver 'mv /srv/data ~/tmp/x && rm -rf ~/tmp/x'`,
    `ssh myserver 'rm(){ command rm -rf /srv; }; rm -f /tmp/x'`,
    `ssh myserver 'PATH=~/tmp/bin:$PATH rm -f /tmp/x'`,
    `ssh myserver "'m'v /srv/data ~/tmp/x && rm -rf ~/tmp/x"`,
    `ssh myserver 'PATH+=:~/tmp/bin; rm -f /tmp/x'`,
    `ssh myserver 'rsync -a --remove-source-files /srv/data/ ~/tmp/x/ && rm -rf ~/tmp/x'`,
    `ssh myserver 'docker run --rm -v /srv:/tmp/d alpine sh -c "rm -rf /tmp/d/a"'`,
    `ssh myserver 'DOCKER_HOST=tcp://prod:2375 docker rm -f api-mcp-check'`,
    `ssh myserver 'docker rm -f -v api-mcp-check'`,
    `ssh myserver 'HOME=/srv; rm -rf ~/tmp/x'`,
    `ssh myserver 'mktemp(){ echo /srv; }; D=$(mktemp); rm -rf $D'`,
    `ssh myserver 'rm -v -rf /srv'`,
    `ssh myserver 'rm --recursive --force /srv'`,
    `ssh myserver 'docker rm --force prod-db'`,
    // Security review, 02.11: a listed deletion outside the listed host's command, a command name
    // built from a variable, and docker pointed at another engine first.
    `ssh myserver true; rm -rf ~/shadow_old`,
    `ssh myserver true && docker rm -f api-mcp-check`,
    `ssh myserver 'ls' | rm -rf ~/tmp/x`,
    `ssh myserver 'X=; m\${X}v /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver 'X=mv; $X /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver '$X /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver 'docker context use prod && docker rm -f api-mcp-check'`,
    `ssh myserver 'docker --config ~/other rm -f api-mcp-check'`,
    `ssh myserver 'DOCKER_CONFIG=~/other docker rm -f api-mcp-check'`,
    // Second round, 02.11: a local substitution in ssh's words, a quoted name splice, a spliced context.
    `ssh myserver echo $(rm -rf ~/shadow_old)`,
    'ssh myserver echo `rm -rf ~/shadow_old`',
    `ssh myserver "echo $(rm -rf ~/tmp/x)"`,
    `ssh myserver true <(rm -rf ~/tmp/x)`,
    `ssh myserver 'X=; m"\${X}"v /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver 'X=mv; "$X" /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver 'S=/bin/mv; $S /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver 'docker con\\text use prod && docker rm -f api-mcp-check'`,
    `ssh myserver 'docker co"n"text use prod && docker rm -f api-mcp-check'`,
    `ssh myserver 'export DOCKER_HOST; docker rm -f api-mcp-check'`,
    `ssh myserver 'rm -rf ~/tmp/x; echo $?'`,
    // Third round, 02.11: names built by globs or braces, ssh inside another shell, a pipe into a shell.
    `ssh myserver 'docker cont*xt use prod && docker rm -f api-mcp-check'`,
    `ssh myserver 'docker cont?xt use prod && docker rm -f api-mcp-check'`,
    `ssh myserver '/bin/m[v] /srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    `ssh myserver '{mv,/srv/data} ~/tmp/x; rm -rf ~/tmp/x'`,
    `bash -c "ssh myserver true; rm -rf ~/tmp/x"`,
    `ssh myserver 'cat ~/tmp/run' | sh; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'mv\t/srv/data ~/tmp/x; rm -rf ~/tmp/x'`,
    // Fourth round, 02.11: what reads a pipe may run it.
    `ssh myserver 'cat /tmp/run' | ssh myserver sh -s; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'cat /tmp/run' | ssh myserver 'bash -s'; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'cat /tmp/run' |& sh; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'cat /tmp/a' | tar -x --to-command=sh; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'cat /tmp/a' | sort -o /srv/x; ssh myserver 'rm -rf ~/tmp/x'`,
    // Fifth round, 02.11.
    `ssh myserver 'cat /tmp/run' | ssh myserver 'awk -f /dev/stdin'; ssh myserver 'rm -rf ~/tmp/x'`,
    `ssh myserver 'cat /tmp/run' | ssh myserver 'cat >/tmp/run' '; sh /tmp/run'; ssh myserver 'rm -rf ~/tmp/x'`,
    `git archive HEAD | ssh myserver 'D=$(mktemp -d) && tar -x --to-command=sh -C "$D" && rm -rf "$D"'`,
    // Sixth round, 02.11.
    `ssh myserver 'cat /tmp/run' | ssh myserver 'echo & sh'; ssh myserver 'rm -rf ~/tmp/x'`,
    `git archive HEAD | ssh myserver 'echo x > /srv/db; rm -rf ~/tmp/x'`,
    `git archive HEAD | ssh myserver 'docker cp - api-mcp-check:/app; rm -rf ~/tmp/x'`,
    `git archive HEAD | ssh myserver 'tar -x -C /srv/app; rm -rf ~/tmp/x'`,
    `git archive HEAD | ssh myserver 'cd /srv && tar -x; rm -rf ~/tmp/x'`
  ])('holds %s', (command) => {
    expect(held(command)).toBe(true)
  })

  // Owner 04.11: a command whose every deletion is an rm of literal /tmp names passes on listed hosts
  // whatever else it runs; the rest still needs the whole command readable.
  it.each(OWN_TEMP_CLEANUPS)('passes the 04.11 cleanup #%#', (command) => {
    expect(held(command)).toBe(false)
  })

  it.each([
    `ssh myserver "docker exec c sh -c 'rm -f /tmp/x.py'"`,
    `ssh myserver 'rm -f /tmp/q[1-6].json /tmp/p*.py; f=$(ls /tmp)'`,
    `ssh myserver 'rm -f /tmp/x.py' > $D/out.txt`,
    `ssh myserver 'docker exec $C rm -f /tmp/x.py; docker exec "$C" rm -rf /tmp/y | tail -1'`,
    `ssh myserver 'rm -rf /tmp/pc/ /var/tmp/x.log; echo $(date)' | grep -c x`,
    `ssh myserver 'sudo rm -f /tmp/x.py; ls /tmp | awk "{print}"'`
  ])('passes the /tmp cleanup %s', (command) => {
    expect(held(command)).toBe(false)
  })

  it.each([
    `ssh myserver 'rm -rf /tmp/../etc; f=$(ls)'`,
    `ssh myserver 'rm -rf /var/tmp/../../srv | tail -1'`,
    `ssh myserver 'rm -rf /tmp/*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/.*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/[a-z]*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/*/x; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/x{,/../../srv}; f=$(ls)'`,
    `ssh myserver 'rm -rf ~; f=$(ls)'`,
    `ssh myserver 'rm -rf ~/ | tail -1'`,
    `ssh myserver 'rm -rf $HOME; f=$(ls)'`,
    `ssh myserver 'rm -rf "$HOME"/tmp | tail -1'`,
    `ssh myserver 'rm -rf /tmp/$X; f=$(ls)'`,
    `ssh myserver 'rm -rf $D/x | tail -1'`,
    `ssh myserver 'X=/srv; rm -rf /tmp/x $X'`,
    `ssh myserver 'rm -rf /tmp; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/ | tail -1'`,
    `ssh myserver 'cd /tmp && rm -rf pc; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/x /etc/y; f=$(ls)'`,
    `ssh myserver 'rm -f /tmp/x > $F; f=$(ls)'`,
    `ssh myserver "rm -rf /tmp/x\\" /srv"`,
    `ssh myserver 'rm -f /tmp/x; docker exec db psql -c "DELETE FROM sessions"; f=$(ls)'`,
    `ssh myserver 'rm -f /tmp/x; docker exec db mysql -e "DROP TABLE orders"'`,
    `ssh myserver 'rm -f /tmp/x; docker exec db psql -c "TRUNCATE events"'`,
    `ssh other-box 'rm -f /tmp/x.py; echo $(hostname)'`,
    `ssh myserver 'rm -f /tmp/x.py'; ssh prod 'ls $D'`,
    `ssh myserver 'rm -f /tmp/x; docker volume rm data'`,
    `ssh myserver 'rm -f /tmp/x; docker system prune -af'`,
    `ssh myserver 'docker rm -f api-mcp-check; rm -f /tmp/x; f=$(ls)'`,
    `ssh myserver 'docker exec $C rm -rf ~/tmp/x'`,
    `ssh myserver 'rm -rf ~/tmp/x; f=$(ls)'`,
    `ssh myserver 'mv /srv/data /tmp/x; rm -rf /tmp/x | tail -1'`,
    `ssh myserver 'ln -s /srv /tmp/x && rm -rf /tmp/x/data; f=$(ls)'`,
    `ssh myserver 'mount --bind /srv /tmp/x; rm -rf /tmp/x/data; f=$(ls)'`,
    `ssh myserver 'docker run -v /srv:/tmp/d img; rm -rf /tmp/d/a; f=$(ls)'`,
    `ssh myserver 'eval "$CMD"; rm -f /tmp/x'`,
    `ssh myserver 'rm(){ command rm -rf /srv; }; rm -f /tmp/x; f=$(ls)'`,
    `ssh myserver 'PATH=/tmp/bin:$PATH; rm -f /tmp/x'`,
    `ssh myserver 'f=$(ls); $X rm -f /tmp/x'`,
    // Security check 04.11: a substitution, backquote or eval next to the own /tmp rm on the listed host.
    `ssh myserver 'echo $(rm -rf /srv/data); rm -f /tmp/x'`,
    "ssh myserver 'echo `rm -rf /srv/data`; rm -f /tmp/x'",
    `ssh myserver 'f=$(mv /srv/data /tmp/x); rm -rf /tmp/x'`,
    `ssh myserver 'rm -f /tmp/x; echo $(docker volume rm data)'`,
    `ssh myserver 'rm -f /tmp/x; eval $(cat /tmp/run)'`,
    `ssh myserver 'rm -rf $(echo /tmp/x)'`,
    `ssh myserver 'rm -rf /tmp/x/$(cat /tmp/name)'`,
    "ssh myserver 'rm -rf `cat /tmp/list`'",
    `ssh myserver '$X /srv/data /tmp/x; rm -rf /tmp/x'`,
    `ssh myserver '"$X" /srv/data /tmp/x && rm -rf /tmp/x'`,
    `ssh myserver 'sudo $X /srv/data /tmp/x; rm -rf /tmp/x'`,
    `ssh myserver '$(cat /tmp/cmd) /srv/data /tmp/x; rm -rf /tmp/x'`,
    "ssh myserver '`cat /tmp/cmd` /srv/data /tmp/x; rm -rf /tmp/x'",
    `ssh myserver "\\$X /srv/data /tmp/x; rm -rf /tmp/x"`,
    `ssh myserver 'f=$($X /srv/data /tmp/x); rm -rf /tmp/x'`,
    `ssh myserver '($X /srv/data /tmp/x); rm -rf /tmp/x'`,
    `ssh myserver 'if $X /srv/data /tmp/x; then rm -rf /tmp/x; fi'`,
    `ssh myserver 'while ! $X /srv/data /tmp/x; do :; done; rm -rf /tmp/x'`,
    `ssh myserver 'timeout 5 $X /srv/data /tmp/x; rm -rf /tmp/x'`,
    `ssh myserver 'doas $X /srv/data /tmp/x; rm -rf /tmp/x'`,
    `ssh myserver 'stdbuf -o0 $X /srv/data /tmp/x; rm -rf /tmp/x'`,
    `ssh myserver 'setsid "$X" /srv/data /tmp/x; rm -rf /tmp/x'`,
    // Security review 04.11: a quote that opens rather than closes hides a second target; globs off the
    // listed hosts or too short; no ssh call means no listed host.
    `ssh myserver "rm -rf /tmp/x\\" #\\" /srv"`,
    `ssh myserver "rm -rf /tmp/x\\"&\\" /srv"`,
    `ssh myserver 'rm -rf /tmp/x'\\''&'\\'' /srv'`,
    `ssh prod 'rm -rf /tmp/x"&" /srv'`,
    `ssh prod 'rm -rf /tmp/x" #" /srv'`,
    `ssh myserver "docker exec c sh -c \\"rm -f /tmp/x.py\\""`,
    `ssh other-box 'rm -rf /tmp/s*'`,
    `ssh other-box 'rm -f /tmp/q*.json'`,
    `ssh myserver 'rm -rf /tmp/s*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/a?; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/ssh-*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/ssh-*.sock; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/systemd*; f=$(ls)'`,
    `ssh myserver 'rm -rf /tmp/systemd-private-*.d; f=$(ls)'`,
    `ssh myserver 'rm -f /tmp/sess_*.tmp; f=$(ls)'`,
    `ssh myserver 'rm -f /tmp/report*; f=$(ls)'`,
    `ssh myserver 'rm -f /tmp/x.*; f=$(ls)'`,
    `mysql -h prod -e "$Q"; rm -f /tmp/q.sql`
  ])('holds %s', (command) => {
    expect(held(command)).toBe(true)
  })

  it('holds everything again without the block', () => {
    setRemoteNoApprove(parseHqRemoteNoApprove('default: 1'))
    expect(held(`ssh myserver 'rm -f ~/shadow_check.sh'`)).toBe(true)
    expect(held(`ssh myserver 'docker rm -f api-mcp-check'`)).toBe(true)
  })

  it("ignores entries too broad to mean the agent's own things", () => {
    setRemoteNoApprove(
      parseHqRemoteNoApprove(
        'remote_no_approve:\n  hosts: *\n  containers: *\n  rm_paths: /*, ~/*, /*/x'
      )
    )
    expect(held(`ssh myserver 'rm -rf ~/x'`)).toBe(true)
    expect(held(`ssh myserver 'docker rm -f prod-db'`)).toBe(true)
  })

  it('passes a mktemp variable only when the block says so', () => {
    setRemoteNoApprove(parseHqRemoteNoApprove(AUTONOMY.replace('mktemp: yes', 'mktemp: no')))
    expect(held(`ssh myserver 'D=$(mktemp -d); rm -rf "$D"'`)).toBe(true)
  })
})
