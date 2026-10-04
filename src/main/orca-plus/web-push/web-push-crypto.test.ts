import { createECDH, createPublicKey, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encryptPushPayload, generateVapidKeys, vapidAuthorization } from './web-push-crypto'

const b64 = (value: string): Buffer => Buffer.from(value.replace(/\s+/g, ''), 'base64url')

// RFC 8291 section 5 / appendix A.
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  receiverPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z 9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml mlMoZIIgDll6e3vCYLocInmYWAmS6Tlz AC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrd irN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs bI_0LpXMuGvnzQ'
}

describe('web push encryption', () => {
  it('reproduces the RFC 8291 example byte for byte', () => {
    const body = encryptPushPayload(
      Buffer.from(RFC.plaintext),
      { p256dh: RFC.receiverPublic, auth: RFC.auth },
      { senderPrivateKey: b64(RFC.senderPrivate), salt: b64(RFC.salt) }
    )
    expect(body.toString('base64url')).toBe(
      Buffer.concat([b64(RFC.header), b64(RFC.ciphertext)]).toString('base64url')
    )
  })

  it('uses a fresh key and salt for every message', () => {
    const receiver = createECDH('prime256v1')
    receiver.generateKeys()
    const keys = { p256dh: receiver.getPublicKey().toString('base64url'), auth: RFC.auth }
    const first = encryptPushPayload(Buffer.from('hi'), keys)
    const second = encryptPushPayload(Buffer.from('hi'), keys)
    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false)
    expect(first.subarray(21, 86).equals(second.subarray(21, 86))).toBe(false)
  })

  it('refuses malformed subscription keys', () => {
    expect(() => encryptPushPayload(Buffer.from('hi'), { p256dh: 'AAAA', auth: RFC.auth })).toThrow(
      /malformed/
    )
  })
})

describe('VAPID authorization', () => {
  it('signs an ES256 claim for the push service origin that verifies with the public key', () => {
    const keys = generateVapidKeys()
    const header = vapidAuthorization({
      endpoint: 'https://web.push.apple.com/QGuQyavXutnMH8l/abc',
      keys,
      subject: 'https://example.com',
      nowSeconds: 1_000
    })
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match?.[4]).toBe(keys.publicKey)
    const [, head, claims, signature] = match ?? []
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://web.push.apple.com',
      exp: 1_000 + 12 * 60 * 60,
      sub: 'https://example.com'
    })
    const point = Buffer.from(keys.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url')
      },
      format: 'jwk'
    })
    expect(
      verify(
        'sha256',
        Buffer.from(`${head}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true)
  })
})
