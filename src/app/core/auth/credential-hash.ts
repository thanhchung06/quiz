/**
 * Simple local credential hashing. This app explicitly places "security
 * against a technically skilled user" out of scope (spec Assumptions) — the
 * PIN/password only needs to avoid being stored as bare plaintext on disk.
 */
export async function hashCredential(rawValue: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${rawValue}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
