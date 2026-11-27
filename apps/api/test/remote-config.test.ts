import { describe, expect, test } from 'bun:test';
import { maintenanceAllows } from '../src/plugins/maintenance.ts';
import {
  buildRemoteConfig,
  parseExtraParameters,
  type RemoteConfigSettings,
} from '../src/remote-config.ts';

/**
 * Settings → Remote Config rendered for the mobile app: the Firebase Remote Config template shape
 * the app's custom-URL reader expects (`parameters.<name>.defaultValue.value` + root `version`).
 */
const base: RemoteConfigSettings = {
  maintenanceMode: false,
  forceUpdate: true,
  latestVersion: '1.1.6+92',
  minVersion: '1.1.6',
  versionNumber: 92,
  minimumVersionNumber: 88,
  updateUrl: 'https://play.google.com/store/apps/details?id=id.example.app',
  iosUpdateUrl: 'https://apps.apple.com/app/id123',
  parameters: null,
};
const NOW = new Date('2026-03-14T08:14:01.414Z');

describe('remote config template', () => {
  test('fixed parameters as Firebase string values with their types, plus the version block', () => {
    const c = buildRemoteConfig(base, 'android', NOW);
    expect(c.parameters.force_update).toEqual({
      defaultValue: { value: 'true' },
      valueType: 'BOOLEAN',
    });
    expect(c.parameters.maintenance_mode?.defaultValue.value).toBe('false');
    expect(c.parameters.latest_version?.defaultValue.value).toBe('1.1.6+92');
    expect(c.parameters.min_version?.defaultValue.value).toBe('1.1.6');
    expect(c.parameters.latest_version_number).toEqual({
      defaultValue: { value: '92' },
      valueType: 'NUMBER',
    });
    expect(c.parameters.minimum_version_number?.defaultValue.value).toBe('88');
    expect(c.version).toEqual({
      versionNumber: '92',
      minimumVersionNumber: '88',
      updateTime: '2026-03-14T08:14:01.414000Z',
      updateOrigin: 'CONSOLE',
      updateType: 'INCREMENTAL_UPDATE',
    });
  });

  test('update_url follows the platform; iOS without its own link gets the Play link', () => {
    const android = buildRemoteConfig(base, 'android', NOW).parameters;
    const ios = buildRemoteConfig(base, 'ios', NOW).parameters;
    expect(android.update_url?.defaultValue.value).toBe(base.updateUrl as string);
    expect(ios.update_url?.defaultValue.value).toBe(base.iosUpdateUrl as string);
    expect(ios.android_update_url?.defaultValue.value).toBe(base.updateUrl as string);
    expect(ios.ios_update_url?.defaultValue.value).toBe(base.iosUpdateUrl as string);
    const noIos = buildRemoteConfig({ ...base, iosUpdateUrl: null }, 'ios', NOW).parameters;
    expect(noIos.update_url?.defaultValue.value).toBe(base.updateUrl as string);
  });

  test('additional parameters are added, typed, and cannot override a fixed one', () => {
    const c = buildRemoteConfig(
      {
        ...base,
        parameters: [
          '# feature flags',
          'ai_provider = internal',
          'widget_location_enable = FALSE',
          'max_retry = 3',
          'label = "1.0"',
          'force_update = false',
          'not a line',
          'bad-name = x',
        ].join('\r\n'),
      },
      'android',
      NOW,
    ).parameters;
    expect(c.ai_provider).toEqual({ defaultValue: { value: 'internal' }, valueType: 'STRING' });
    expect(c.widget_location_enable).toEqual({
      defaultValue: { value: 'false' },
      valueType: 'BOOLEAN',
    });
    expect(c.max_retry?.valueType).toBe('NUMBER');
    expect(c.label).toEqual({ defaultValue: { value: '1.0' }, valueType: 'STRING' });
    expect(c.force_update?.defaultValue.value).toBe('true');
    expect(Object.keys(c)).not.toContain('bad-name');
  });

  test('empty or unset values stay readable: blank strings and zero build numbers', () => {
    const c = buildRemoteConfig(
      {
        ...base,
        latestVersion: null,
        minVersion: null,
        versionNumber: Number.NaN,
        minimumVersionNumber: -1,
        updateUrl: null,
        iosUpdateUrl: null,
      },
      'android',
      NOW,
    );
    expect(c.parameters.latest_version?.defaultValue.value).toBe('');
    expect(c.parameters.update_url?.defaultValue.value).toBe('');
    expect(c.version.versionNumber).toBe('0');
    expect(c.version.minimumVersionNumber).toBe('0');
  });

  test('parseExtraParameters ignores comments, blanks and malformed lines', () => {
    expect(parseExtraParameters('\n# x = 1\n=nope\nok=1\n')).toEqual({
      ok: { value: '1', type: 'NUMBER' },
    });
    expect(parseExtraParameters(null)).toEqual({});
  });

  test('the endpoint stays reachable through the maintenance gate', () => {
    expect(maintenanceAllows('GET', '/v1/remote-config')).toBe(true);
    expect(maintenanceAllows('POST', '/v1/remote-config')).toBe(false);
  });
});
