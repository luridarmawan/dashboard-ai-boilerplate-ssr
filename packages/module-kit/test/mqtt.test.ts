import { describe, expect, test } from 'bun:test';
import { ModuleContractError } from '../src/contract.ts';
import { defineMqtt, invalidTopicFilter, invalidTopicName, matchTopic } from '../src/mqtt.ts';

describe('matchTopic — MQTT wildcard semantics (extension point 18)', () => {
  test('`+` matches exactly one level and captures it', () => {
    expect(matchTopic('site/+/pos', 'site/a/pos')).toEqual(['a']);
    expect(matchTopic('site/+/pos', 'site/a/b/pos')).toBeNull();
    expect(matchTopic('site/+/pos', 'site/pos')).toBeNull();
    expect(matchTopic('site/+/+', 'site//x')).toEqual(['', 'x']);
  });

  test('`#` matches the rest including the parent level', () => {
    expect(matchTopic('events/#', 'events/user.created')).toEqual(['user.created']);
    expect(matchTopic('events/#', 'events/a/b/c')).toEqual(['a/b/c']);
    expect(matchTopic('events/#', 'events')).toEqual(['']);
    expect(matchTopic('#', 'anything/at/all')).toEqual(['anything/at/all']);
  });

  test('exact filters match exactly; `$` topics never match a leading wildcard', () => {
    expect(matchTopic('a/b', 'a/b')).toEqual([]);
    expect(matchTopic('a/b', 'a/b/c')).toBeNull();
    expect(matchTopic('#', '$SYS/broker/uptime')).toBeNull();
    expect(matchTopic('$SYS/#', '$SYS/broker/uptime')).toEqual(['broker/uptime']);
  });
});

describe('topic validation', () => {
  test('filters: wildcards only as whole levels, `#` only last, no $share/', () => {
    expect(invalidTopicFilter('site/+/pos')).toBeNull();
    expect(invalidTopicFilter('events/#')).toBeNull();
    expect(invalidTopicFilter('')).toMatch(/kosong/);
    expect(invalidTopicFilter('a/#/b')).toMatch(/level terakhir/);
    expect(invalidTopicFilter('a/b+/c')).toMatch(/satu level penuh/);
    expect(invalidTopicFilter('$share/g/a')).toMatch(/shared/);
    expect(invalidTopicFilter('a\0b')).toMatch(/NUL/);
  });

  test('publish topics refuse wildcards', () => {
    expect(invalidTopicName('site/a/pos')).toBeNull();
    expect(invalidTopicName('site/+/pos')).toMatch(/wildcard/);
    expect(invalidTopicName('site/#')).toMatch(/wildcard/);
  });
});

describe('defineMqtt', () => {
  const ok = { name: 'alpha.readings', topic: 'alpha/+/readings', handler: () => {} } as const;

  test('a namespaced name with a valid filter and a handler is accepted as-is', () => {
    expect(defineMqtt('Alpha', [ok])).toEqual([ok]);
  });

  test('foreign prefix, bad filter, bad qos, missing handler and duplicates are refused', () => {
    for (const bad of [
      { ...ok, name: 'beta.readings' },
      { ...ok, name: 'Readings' },
      { ...ok, topic: 'alpha/#/x' },
      { ...ok, qos: 3 },
      { ...ok, handler: 'nope' },
    ]) {
      expect(() => defineMqtt('Alpha', [bad as never]), JSON.stringify(bad)).toThrow(
        ModuleContractError,
      );
    }
    expect(() => defineMqtt('Alpha', [ok, ok])).toThrow(/duplikat/);
  });
});
