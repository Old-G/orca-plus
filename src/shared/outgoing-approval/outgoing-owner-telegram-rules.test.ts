import { describe, expect, it } from 'vitest'
import { classifyOutgoingToolCall } from './outgoing-action-classifier'

const NEWS = '/Users/me/Projects/news_bot'
const bash = (command: string, cwd: string | null = NEWS) =>
  classifyOutgoingToolCall('Bash', { command }, cwd)

// Why: shapes of the 18.10 cards the owner approved by hand, trimmed to the parts that matter.
const DOTENV_VARIABLE = `cd ${NEWS}; timeout 240 uv run --with python-dotenv python - <<EOF
import json, httpx
from dotenv import dotenv_values
e = dotenv_values(".env"); t = "https://api.telegram.org/bot" + e["BOT_TOKEN"]; chat = e["OWNER_CHAT_ID"]
media = [{"type": "photo", "media": f"attach://p{i}"} for i in range(7)]
r1 = httpx.post(t + "/sendMediaGroup", data={"chat_id": chat, "media": json.dumps(media)}, files={f"p{i}": open(f"$S/{n}.jpg", "rb") for i, n in enumerate(names)}, timeout=180)
r2 = httpx.post(t + "/sendPhoto", data={"chat_id": chat, "caption": "Логотип 1 в 6 цветах"}, files={"photo": open("$S/logo.jpg", "rb")}, timeout=60)
print(r1.json().get("ok"), r2.json().get("ok"))
EOF`

const DOTENV_INLINE = `uv run --with python-dotenv python - <<EOF
import httpx
from dotenv import dotenv_values
e = dotenv_values(".env")
r = httpx.post(f"https://api.telegram.org/bot{e['BOT_TOKEN']}/sendVideo",
    data={"chat_id": e["OWNER_CHAT_ID"], "width": 1080, "caption": "Прототип шортса"},
    files={"video": ("short.mp4", open("short.mp4", "rb"), "video/mp4")}, timeout=180)
EOF`

const SERVER_ENV = `ssh -o ConnectTimeout=25 beget 'cd /opt/radar && docker compose exec -T bot python -c "
import os, httpx
t=os.environ[\\"BOT_TOKEN\\"]; chat=os.environ[\\"OWNER_CHAT_ID\\"]
r=httpx.post(f\\"https://api.telegram.org/bot{t}/sendMessage\\", json={\\"chat_id\\": chat, \\"text\\": \\"Проверка связи.\\"}, timeout=20).json()
print(r[\\"ok\\"], r.get(\\"result\\",{}).get(\\"chat\\",{}).get(\\"username\\"))
"'`

const CURL_SHELL_VAR =
  'set -a; . ./.env; curl -s "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" -d chat_id=$OWNER_CHAT_ID -d text=hi'

describe('bot previews to the owner from news_bot', () => {
  it.each([
    ['a variable read from .env', DOTENV_VARIABLE],
    ['.env read inline', DOTENV_INLINE],
    ['the server env over ssh', SERVER_ENV],
    ['curl with the shell variable', CURL_SHELL_VAR],
    [
      'curl with a braced variable',
      'curl -s https://api.telegram.org/bot$BOT_TOKEN/sendPhoto -F "chat_id=${OWNER_CHAT_ID}" -F photo=@a.jpg'
    ],
    [
      'os.getenv',
      "python -c \"import os,requests; requests.post('https://api.telegram.org/bot'+os.getenv('BOT_TOKEN')+'/sendMessage', json={'chat_id': os.getenv('OWNER_CHAT_ID'), 'text': 'x'})\""
    ]
  ])('passes %s', (_name, command) => {
    expect(bash(command)).toBeNull()
  })

  it('passes from a subfolder or worktree of the project', () => {
    expect(bash(DOTENV_INLINE, `${NEWS}/bot`)).toBeNull()
  })
})

describe('Telegram sends that still need approval', () => {
  const swap = (from: string, to: string) => DOTENV_INLINE.replace(from, to)

  it.each([
    ['a channel from .env', swap('e["OWNER_CHAT_ID"]', 'e["DIGEST_CHANNEL_ID"]')],
    ['a @username channel', swap('e["OWNER_CHAT_ID"]', '"@oldg_media"')],
    ['a -100 channel id', swap('e["OWNER_CHAT_ID"]', '"-1001234567890"')],
    ['a literal numeric id', swap('e["OWNER_CHAT_ID"]', '123456789')],
    ['a channel or the owner', swap('e["OWNER_CHAT_ID"]', 'CHANNEL or e["OWNER_CHAT_ID"]')],
    [
      'an env default that is a channel',
      swap('e["OWNER_CHAT_ID"]', 'os.environ.get("OWNER_CHAT_ID", "@oldg_media")')
    ],
    [
      'OWNER_CHAT_ID pointed at a channel',
      `OWNER_CHAT_ID=-1001234567890 ${CURL_SHELL_VAR.replace('set -a; . ./.env; ', '')}`
    ],
    [
      'a dict key set to a channel',
      swap('e = dotenv_values(".env")', 'e = {"OWNER_CHAT_ID": "@x"}')
    ],
    [
      'a second call to a channel',
      `${CURL_SHELL_VAR}; curl -s "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" -d chat_id=$DIGEST_CHANNEL_ID -d text=hi`
    ],
    [
      'the variable rebound to a channel',
      DOTENV_VARIABLE.replace('print(', 'chat = "@oldg_media"\nprint(')
    ],
    [
      'the variable rebound by a loop',
      DOTENV_VARIABLE.replace('print(', 'for chat in ["@oldg_media"]: pass\nprint(')
    ],
    [
      'the shell variable of a loop',
      'for c in -100123 @x; do curl -s https://api.telegram.org/bot$T/sendMessage -d chat_id=$c -d text=hi; done'
    ],
    ['a body read from a file', `${CURL_SHELL_VAR} -d @extra.txt`],
    ['a body read from a file with no space', `${CURL_SHELL_VAR} -d@extra.txt`],
    ['a curl config file', `${CURL_SHELL_VAR} -K extra.cfg`],
    ['a JSON body read from a file', `${CURL_SHELL_VAR} --json @payload.json`],
    ['a dict unpacked into the payload', swap('"width": 1080', '**extra')],
    [
      'a send with no chat_id in sight',
      'curl -s https://api.telegram.org/bot$T/sendMessage -d @payload.json'
    ]
  ])('holds %s', (_name, command) => {
    expect(bash(command)).not.toBeNull()
  })

  it('holds the owner preview from another project or an unknown folder', () => {
    expect(bash(DOTENV_INLINE, '/Users/me/Projects/Billing')).not.toBeNull()
    expect(
      bash(DOTENV_INLINE, '/Users/me/Projects/news_bot_fork')
    ).not.toBeNull()
    expect(bash(DOTENV_INLINE, null)).not.toBeNull()
  })

  it('holds the owner preview when the same command also reaches another host', () => {
    expect(
      bash(`${CURL_SHELL_VAR}; curl -X POST https://slack.com/api/chat.postMessage -d text=hi`)
    ).not.toBeNull()
    expect(
      bash(`${CURL_SHELL_VAR}; curl -X POST https://api.x.com/2/tweets --json @tweet.json`)
    ).not.toBeNull()
    expect(
      bash(
        `${CURL_SHELL_VAR}; curl -X POST https://graph.threads.net/v1.0/me/threads -d text=hi -d media_type=TEXT`
      )
    ).not.toBeNull()
  })

  it('keeps the card for other message hosts from the project', () => {
    expect(
      bash(
        'curl -X POST https://slack.com/api/chat.postMessage -d channel=$OWNER_CHAT_ID -d text=hi'
      )
    ).toMatchObject({ service: 'HTTP', operation: 'message' })
  })
})
