export function decodeOwnershipSecret(value: string | undefined): Uint8Array | null {
  if (!value) return null

  let bytes: Uint8Array
  if (/^[0-9a-f]{64}$/i.test(value)) {
    bytes = new Uint8Array(value.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)))
  } else if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
    try {
      const standardBase64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='
      const decoded = atob(standardBase64)
      bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0))
      const canonical = btoa(String.fromCharCode(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '')
      if (canonical !== value) return null
    } catch {
      return null
    }
  } else {
    return null
  }

  if (bytes.length < 32 || hasWeakPattern(bytes)) return null
  return new TextEncoder().encode(value)
}

function hasWeakPattern(bytes: Uint8Array) {
  if (new Set(bytes).size < 16) return true
  const printableBytes = bytes.filter((byte) => byte >= 0x20 && byte <= 0x7e).length
  if (printableBytes >= 28) return true

  for (let period = 1; period <= 8; period += 1) {
    let repeats = true
    for (let index = period; index < bytes.length; index += 1) {
      if (bytes[index] !== bytes[index % period]) {
        repeats = false
        break
      }
    }
    if (repeats) return true
  }

  const ascending = bytes.every((byte, index) => index === 0 || byte === ((bytes[index - 1] + 1) & 0xff))
  const descending = bytes.every((byte, index) => index === 0 || byte === ((bytes[index - 1] - 1) & 0xff))
  if (ascending || descending) return true

  const decoded = new TextDecoder().decode(bytes).trim().toLowerCase()
  return /^(?:change(?:me)?|default|example|password|secret|test|your[-_ ]?secret|replace[-_ ]?me)[\s!._-]*$/.test(decoded)
}

function isValidIpv4(value: string) {
  const octets = value.split('.')
  return octets.length === 4 && octets.every((octet) => {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return false
    const number = Number(octet)
    return number >= 0 && number <= 255
  })
}

function isValidIpv6(value: string) {
  if (!/^[0-9a-f:.]+$/i.test(value) || value.includes(':::')) return false
  let address = value
  if (address.includes('.')) {
    const finalColon = address.lastIndexOf(':')
    if (finalColon < 0 || !isValidIpv4(address.slice(finalColon + 1))) return false
    const octets = address.slice(finalColon + 1).split('.').map(Number)
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    address = `${address.slice(0, finalColon)}:${high}:${low}`
  }

  const halves = address.split('::')
  if (halves.length > 2) return false
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const groups = [...left, ...right]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return false
  return halves.length === 2 ? groups.length < 8 : groups.length === 8
}

export function isValidClientIp(value: string) {
  return value.includes(':') ? isValidIpv6(value) : isValidIpv4(value)
}

export function getTrustedClientIp(request: Request) {
  const value = request.headers.get('cf-connecting-ip')?.trim()
  if (!value || value.includes(',') || value.length > 45 || !isValidClientIp(value)) return null
  return value
}

export async function hmacHex(secret: Uint8Array, value: string) {
  const keyMaterial = new ArrayBuffer(secret.byteLength)
  new Uint8Array(keyMaterial).set(secret)
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}
