const ENV_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Maps a stored project secret name to an adapter env variable name ([A-Za-z_][A-Za-z0-9_]*).
 * Returns null when no safe mapping exists.
 */
export function envKeyFromProjectSecretName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  let key = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return null;
  if (/^[0-9]/.test(key)) key = `_${key}`;
  if (!/^[A-Za-z_]/.test(key)) key = `SECRET_${key}`;
  return ENV_SEGMENT.test(key) ? key : null;
}
