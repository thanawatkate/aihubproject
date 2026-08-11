import net from 'net';
import { lookup } from 'dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const a = parts[0] as number;
  const b = parts[1] as number;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // ULA
  if (normalized.startsWith('fe80')) return true; // link-local
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIP(ip) === 4) return isPrivateIpv4(ip);
  if (net.isIP(ip) === 6) return isPrivateIpv6(ip);
  return true;
}

/**
 * Validate outbound URL for SSRF safety.
 * Requires https (http allowed only for localhost in non-production if needed — we require https always).
 */
export async function assertSafeOutboundUrl(rawUrl: string, opts?: { allowHttp?: boolean }): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  const allowHttp = opts?.allowHttp === true;
  if (parsed.protocol === 'https:') {
    // ok
  } else if (allowHttp && parsed.protocol === 'http:') {
    // ok when explicitly allowed
  } else {
    throw new Error('Only https URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Blocked hostname');
  }

  // Literal IP in hostname
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error('Private or reserved IP addresses are not allowed');
    }
    return parsed;
  }

  // Resolve DNS and reject private answers
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error('Unable to resolve hostname');
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new Error('Hostname resolves to a private or reserved address');
    }
  }

  return parsed;
}

/** Sync-ish format check for admin input before save (scheme/host only; full DNS at request time). */
export function assertSafeUrlFormat(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Blocked hostname');
  }
  if (net.isIP(hostname) && isBlockedIp(hostname)) {
    throw new Error('Private or reserved IP addresses are not allowed');
  }
}
