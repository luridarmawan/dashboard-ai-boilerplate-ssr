/**
 * Remote Config for the mobile app (Settings → Remote Config), rendered as a Firebase Remote
 * Config template so the app's `RemoteConfigService` reads it through `REMOTE_CONFIG_CUSTOM_URL`
 * exactly like a Firebase export:
 *
 *   { parameters: { <name>: { defaultValue: { value: "<string>" }, valueType } },
 *     version: { versionNumber, minimumVersionNumber, updateTime, … } }
 *
 * Firebase carries every value as a string; `valueType` says how to read it. Pure: the route
 * resolves the settings and passes them in, so this file is unit-tested without a database.
 */

export type RemoteValueType = 'STRING' | 'BOOLEAN' | 'NUMBER';
export type RemotePlatform = 'android' | 'ios';

export interface RemoteConfigSettings {
  maintenanceMode: boolean;
  forceUpdate: boolean;
  latestVersion: string | null;
  minVersion: string | null;
  versionNumber: number;
  minimumVersionNumber: number;
  updateUrl: string | null;
  iosUpdateUrl: string | null;
  /** The free-form `name = value` lines from the settings form. */
  parameters: string | null;
}

export interface RemoteConfigTemplate {
  parameters: Record<string, { defaultValue: { value: string }; valueType: RemoteValueType }>;
  version: {
    versionNumber: string;
    minimumVersionNumber: string;
    updateTime: string;
    updateOrigin: 'CONSOLE';
    updateType: 'INCREMENTAL_UPDATE';
  };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * Parses the additional parameters: one `name = value` per line, `#` starts a comment line.
 * `true`/`false` → BOOLEAN, a plain number → NUMBER, anything else → STRING (quotes around the
 * value are dropped, so `"1.0"` stays a string). Lines that do not parse are skipped, not fatal:
 * one typo must not take the whole config away from every installed app.
 */
export function parseExtraParameters(
  text: string | null | undefined,
): Record<string, { value: string; type: RemoteValueType }> {
  const out: Record<string, { value: string; type: RemoteValueType }> = {};
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!NAME.test(name)) continue;
    const quoted = value.length >= 2 && /^(["']).*\1$/.test(value);
    if (quoted) value = value.slice(1, -1);
    const lower = value.toLowerCase();
    const type: RemoteValueType = quoted
      ? 'STRING'
      : lower === 'true' || lower === 'false'
        ? 'BOOLEAN'
        : NUMBER.test(value)
          ? 'NUMBER'
          : 'STRING';
    out[name] = { value: type === 'BOOLEAN' ? lower : value, type };
  }
  return out;
}

/** Firebase's `updateTime` shape: UTC ISO 8601 with microseconds, e.g. 2026-03-14T08:14:01.414000Z. */
function firebaseTime(d: Date): string {
  return d.toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

/** A whole, non-negative build number; anything else counts as "not set" (0). */
const build = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function buildRemoteConfig(
  s: RemoteConfigSettings,
  platform: RemotePlatform = 'android',
  now: Date = new Date(),
): RemoteConfigTemplate {
  const android = s.updateUrl?.trim() ?? '';
  const ios = s.iosUpdateUrl?.trim() ?? '';
  const versionNumber = build(s.versionNumber);
  const minimumVersionNumber = build(s.minimumVersionNumber);

  const fixed: Record<string, { value: string; type: RemoteValueType }> = {
    maintenance_mode: { value: String(s.maintenanceMode), type: 'BOOLEAN' },
    force_update: { value: String(s.forceUpdate), type: 'BOOLEAN' },
    latest_version: { value: s.latestVersion?.trim() ?? '', type: 'STRING' },
    min_version: { value: s.minVersion?.trim() ?? '', type: 'STRING' },
    latest_version_number: { value: String(versionNumber), type: 'NUMBER' },
    minimum_version_number: { value: String(minimumVersionNumber), type: 'NUMBER' },
    // The app reads `update_url` only, so it carries the link of the platform that asked;
    // both links stay available under their own names for clients that pick for themselves.
    update_url: { value: platform === 'ios' && ios ? ios : android, type: 'STRING' },
    android_update_url: { value: android, type: 'STRING' },
    ios_update_url: { value: ios, type: 'STRING' },
  };

  // Fixed parameters win: a stray `force_update = false` line cannot undo the switch above.
  const merged = { ...parseExtraParameters(s.parameters), ...fixed };
  const parameters: RemoteConfigTemplate['parameters'] = {};
  for (const name of Object.keys(merged).sort()) {
    const p = merged[name] as { value: string; type: RemoteValueType };
    parameters[name] = { defaultValue: { value: p.value }, valueType: p.type };
  }

  return {
    parameters,
    version: {
      versionNumber: String(versionNumber),
      minimumVersionNumber: String(minimumVersionNumber),
      updateTime: firebaseTime(now),
      updateOrigin: 'CONSOLE',
      updateType: 'INCREMENTAL_UPDATE',
    },
  };
}
