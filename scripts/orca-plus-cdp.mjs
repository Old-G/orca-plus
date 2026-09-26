// Tiny CDP driver for the Orca+ dev renderer (no focus stealing). Port: $CDP_PORT or 9356.
//   node cdp.mjs eval '<js expression>'        → prints JSON result (awaits promises)
//   node cdp.mjs shot <file.png>
//   node cdp.mjs keys '<json array of {key,code,modifiers?,text?,commands?}>'  (commands: ['cut'] runs the editing command like a menu/keybinding)
//   node cdp.mjs type '<text>'
//   node cdp.mjs click <x> <y>
//   node cdp.mjs hover <x> <y>
import { writeFileSync } from 'node:fs'

const port = process.env.CDP_PORT ?? '9356'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && /^http:\/\/localhost:[0-9]+\//.test(t.url))
if (!target) {
  throw new Error('renderer page not found')
}
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const my = ++id
    pending.set(my, (d) =>
      d.error ? reject(new Error(JSON.stringify(d.error))) : resolve(d.result)
    )
    ws.send(JSON.stringify({ id: my, method, params }))
  })

const [cmd, ...args] = process.argv.slice(2)
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', {
    expression: args[0],
    awaitPromise: true,
    returnByValue: true
  })
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r.result, null, 1))
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(args[0], Buffer.from(r.data, 'base64'))
  console.log('saved', args[0])
} else if (cmd === 'keys') {
  for (const k of JSON.parse(args[0])) {
    const modifiers = (k.modifiers ?? []).reduce((a, m) => a | MOD[m], 0)
    const base = { key: k.key, code: k.code, modifiers, windowsVirtualKeyCode: k.vk ?? 0 }
    await send('Input.dispatchKeyEvent', {
      type: k.text ? 'keyDown' : 'rawKeyDown',
      ...base,
      text: k.text,
      commands: k.commands
    })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  console.log('keys sent')
} else if (cmd === 'type') {
  await send('Input.insertText', { text: args[0] })
  console.log('typed')
} else if (cmd === 'click' || cmd === 'hover') {
  const x = Number(args[0])
  const y = Number(args[1])
  const modifiers = (args[2] ? args[2].split(',') : []).reduce((a, m) => a | MOD[m], 0)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers })
  if (cmd === 'click') {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
      modifiers
    })
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
      modifiers
    })
  }
  console.log(cmd, x, y)
}
ws.close()
