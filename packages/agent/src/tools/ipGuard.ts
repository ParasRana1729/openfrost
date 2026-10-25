/**
 * Self-contained IP classification for the fetch_page trust boundary
 * (spec §6): every address the tool may connect to must be a public,
 * non-reserved destination. No new dependencies; IPv4 is a 32-bit number,
 * IPv6 a BigInt.
 */

const IPV4_DENIED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 "this network"
  [0x0a000000, 0x0affffff], // 10/8 private
  [0x64400000, 0x647fffff], // 100.64/10 carrier-grade NAT
  [0x7f000000, 0x7fffffff], // 127/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254/16 link-local
  [0xac100000, 0xac1fffff], // 172.16/12 private
  [0xc0000000, 0xc00000ff], // 192.0.0/24 IETF protocol assignments
  [0xc0a80000, 0xc0a8ffff], // 192.168/16 private
  [0xc6120000, 0xc613ffff], // 198.18/15 benchmarking
  [0xe0000000, 0xefffffff], // 224/4 multicast
  [0xf0000000, 0xffffffff], // 240/4 reserved, incl. 255.255.255.255
];

const IPV6_V4_MAPPED_MIN = 0xffff00000000n; // ::ffff:0.0.0.0
const IPV6_V4_MAPPED_MAX = 0xffffffffffffn; // ::ffff:255.255.255.255

/** Parses a dotted-quad IPv4 address; null when it is not one. */
export function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/** Parses an IPv6 address (including `::ffff:`-mapped tails); null when it is not one. */
export function parseIpv6(address: string): bigint | null {
  const withoutZone = address.split('%')[0];
  if (withoutZone === undefined || withoutZone.length === 0 || withoutZone.includes(':::')) {
    return null;
  }

  const doubleColon = withoutZone.indexOf('::');
  const head = doubleColon === -1 ? withoutZone : withoutZone.slice(0, doubleColon);
  const tail = doubleColon === -1 ? '' : withoutZone.slice(doubleColon + 2);

  const headGroups = parseGroups(head);
  const tailGroups = parseGroups(tail);
  if (headGroups === null || tailGroups === null) {
    return null;
  }

  let groups: number[];
  if (doubleColon === -1) {
    groups = [...headGroups, ...tailGroups];
  } else {
    const fill = 8 - headGroups.length - tailGroups.length;
    if (fill < 0) {
      return null;
    }
    groups = [...headGroups, ...Array<number>(fill).fill(0), ...tailGroups];
  }
  if (groups.length !== 8) {
    return null;
  }

  let value = 0n;
  for (const group of groups) {
    value = (value << 16n) | BigInt(group);
  }
  return value;
}

/** Parses `:`-separated hex groups; a trailing IPv4 tail becomes two groups. */
function parseGroups(text: string): number[] | null {
  if (text.length === 0) {
    return [];
  }
  const segments = text.split(':');
  const groups: number[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (segment === undefined) {
      return null;
    }
    const isLast = i === segments.length - 1;
    if (segment.includes('.')) {
      if (!isLast) {
        return null;
      }
      const v4 = parseIpv4(segment);
      if (v4 === null) {
        return null;
      }
      groups.push(v4 >>> 16, v4 & 0xffff);
      continue;
    }
    if (!/^[0-9a-fA-F]{1,4}$/.test(segment)) {
      return null;
    }
    groups.push(parseInt(segment, 16));
  }
  return groups;
}

function isDeniedIpv4(value: number): boolean {
  return IPV4_DENIED_RANGES.some(([lo, hi]) => value >= lo && value <= hi);
}

function isDeniedIpv6(value: bigint): boolean {
  if (value === 0n || value === 1n) {
    return true; // unspecified ::, loopback ::1
  }
  const top16 = value >> 112n;
  if (top16 >= 0xfc00n && top16 <= 0xfdffn) {
    return true; // fc00::/7 unique local
  }
  if (top16 >= 0xfe80n && top16 <= 0xfebfn) {
    return true; // fe80::/10 link-local
  }
  if (value >= IPV6_V4_MAPPED_MIN && value <= IPV6_V4_MAPPED_MAX) {
    return isDeniedIpv4(Number(value & 0xffffffffn));
  }
  return false;
}

/** True when the address falls in any denied IPv4/IPv6 range. */
export function isDeniedIp(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4 !== null) {
    return isDeniedIpv4(v4);
  }
  const v6 = parseIpv6(address);
  if (v6 !== null) {
    return isDeniedIpv6(v6);
  }
  return false;
}

/** True when the string is an IPv4 or IPv6 literal. */
export function isIpLiteral(address: string): boolean {
  return parseIpv4(address) !== null || parseIpv6(address) !== null;
}
