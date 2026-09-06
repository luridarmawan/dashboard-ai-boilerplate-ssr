import { interpolate, type MessageKey, type Params } from '@core/i18n';
import { getContext, setContext } from 'svelte';

/**
 * Component-side translation. The root layout puts the ACTIVE locale's catalogue into context
 * (only that locale travels to the browser); components call `const t = useT()` and then
 * `t('auth.login.title')`. Keys are typed (K-5); a missing one renders the key (K-4).
 */
export interface I18nContext {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
}

const KEY = 'i18n';

export function provideI18n(ctx: I18nContext): void {
  setContext(KEY, ctx);
}

export function useT(): (key: MessageKey, params?: Params) => string {
  const ctx = getContext<I18nContext | undefined>(KEY);
  return (key, params) => {
    const text = ctx?.messages[key];
    return text === undefined ? key : interpolate(text, params);
  };
}

export function useLocale(): string {
  return getContext<I18nContext | undefined>(KEY)?.locale ?? 'id';
}
