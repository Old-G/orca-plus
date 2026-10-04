// Custom build (web-push): the two pieces of Web Push a sender must do itself — encrypt the
// payload for one browser (RFC 8291, aes128gcm) and sign the VAPID claim (RFC 8292, ES256).
import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  randomBytes,
  sign
} from 'node:crypto'

const RECORD_SIZE = 4096
const KEY_LENGTH = 65

export type VapidKeys = {
  /** Uncompressed P-256 point, base64url — what the browser's pushManager.subscribe needs. */
  publicKey: string
  /** Raw P-256 scalar, base64url. */
  privateKey: string
}

export type PushSubscriptionKeys = {
  /** The browser's P-256 public key, base64url. */
  p256dh: string
  /** The browser's 16-byte auth secret, base64url. */
  auth: string
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  return {
    publicKey: ecdh.getPublicKey().toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url')
  }
}

/** Test seam: RFC 8291 fixes the sender's key pair and salt to make its example reproducible. */
export type EncryptionSeed = { senderPrivateKey: Buffer; salt: Buffer }

export function encryptPushPayload(
  payload: Buffer,
  keys: PushSubscriptionKeys,
  seed?: EncryptionSeed
): Buffer {
  const receiverPublic = Buffer.from(keys.p256dh, 'base64url')
  const authSecret = Buffer.from(keys.auth, 'base64url')
  if (receiverPublic.length !== KEY_LENGTH || authSecret.length !== 16) {
    throw new Error('Push subscription keys are malformed.')
  }
  if (payload.length + 1 + 16 + 86 > RECORD_SIZE) {
    throw new Error('Push payload is too large for one record.')
  }
  const sender = createECDH('prime256v1')
  if (seed) {
    sender.setPrivateKey(seed.senderPrivateKey)
  } else {
    sender.generateKeys()
  }
  const senderPublic = sender.getPublicKey()
  const salt = seed?.salt ?? randomBytes(16)

  const ecdhSecret = sender.computeSecret(receiverPublic)
  const prkKey = hmac(authSecret, ecdhSecret)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    receiverPublic,
    senderPublic,
    Buffer.from([1])
  ])
  const ikm = hmac(prkKey, keyInfo)
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)

  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  // 0x02 marks the last (and only) record, with no padding.
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([payload, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag()
  ])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(RECORD_SIZE)
  return Buffer.concat([salt, recordSize, Buffer.from([KEY_LENGTH]), senderPublic, ciphertext])
}

function vapidSigningKey(keys: VapidKeys): ReturnType<typeof createPrivateKey> {
  const point = Buffer.from(keys.publicKey, 'base64url')
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33, 65).toString('base64url')
    },
    format: 'jwk'
  })
}

/** The Authorization header for one push service: a JWT scoped to the endpoint's origin. */
export function vapidAuthorization(args: {
  endpoint: string
  keys: VapidKeys
  subject: string
  nowSeconds: number
}): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({
    aud: new URL(args.endpoint).origin,
    // Why: push services refuse claims valid for more than 24 hours.
    exp: args.nowSeconds + 12 * 60 * 60,
    sub: args.subject
  })}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapidSigningKey(args.keys),
    dsaEncoding: 'ieee-p1363'
  })
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${args.keys.publicKey}`
}
