import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseHqRemoteNoApprove } from '../hq-autonomy'
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
    `ssh myserver 'docker rm -f api-mcp-check' 2>&1 | tail -2`
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
    `ssh myserver 'DOCKER_CONFIG=~/other docker rm -f api-mcp-check'`
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
