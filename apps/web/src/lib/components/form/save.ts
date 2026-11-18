import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { tick } from 'svelte';
import { toast } from '$lib/components/ui';
import { useT } from '$lib/i18n';

/**
 * The form save convention (docs/FORMS.md) as one submit handler for `use:enhance`: the form posts
 * over fetch, its submit buttons are disabled while it runs, and the outcome is a toast — green on
 * success (also before a redirect is followed), red with the server's reason on failure, after
 * which the first invalid field is scrolled into view. The plain POST stays the no-JS path.
 *
 *   const save = useSaveForm();               // during component init (it reads the i18n context)
 *   <form method="POST" action="?/save" use:enhance={save({ success: t('x.saved') })}>
 */
export interface SaveOptions {
  /**
   * Title of the success toast; a function is read AFTER the page took the action result in, so it
   * can use wording derived from it. `false` = no toast (the caller announces it). Default "Saved.".
   */
  success?:
    | string
    | false
    | ((result: ActionResult) => string | false | null | undefined)
    | undefined;
  /** Title of the failure toast. Default "Could not save". */
  failureTitle?: string | undefined;
  /** Reset the form after a success (Kit's default). Off: the fields keep what was typed. */
  reset?: boolean | undefined;
  /** Runs when the submit starts / once the outcome has been applied. */
  onStart?: (() => void) | undefined;
  onDone?: ((result: ActionResult) => void) | undefined;
}

type FailureData = { error?: string; message?: string; details?: Record<string, string> | null };

/** Scroll to the first invalid field (or the error banner) after a failed save. */
export function revealProblem(form: HTMLFormElement): void {
  const target =
    form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    form.querySelector<HTMLElement>('[role="alert"]');
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (target.matches('input, select, textarea')) target.focus({ preventScroll: true });
}

export function useSaveForm(): (opts?: SaveOptions) => SubmitFunction {
  const t = useT();
  return (opts = {}) =>
    ({ formElement, submitter }) => {
      // Busy state lives on the DOM, so a page needs no state of its own for it.
      const buttons = [
        ...formElement.querySelectorAll<HTMLButtonElement>(
          'button[type="submit"], button:not([type])',
        ),
      ];
      if (submitter instanceof HTMLButtonElement && !buttons.includes(submitter))
        buttons.push(submitter);
      for (const b of buttons) b.disabled = true;
      formElement.setAttribute('aria-busy', 'true');
      opts.onStart?.();
      const successTitle = (result: ActionResult) => {
        const s = typeof opts.success === 'function' ? opts.success(result) : opts.success;
        return s === false ? null : s || t('common.saved');
      };
      return async ({ result, update }) => {
        // The toast store outlives client-side navigation, so a redirect (create → detail, delete
        // → list) is announced here, before `update()` follows it to another page.
        if (result.type === 'redirect') {
          const title = successTitle(result);
          if (title) toast({ title, variant: 'success' }, 3000);
        }
        await update({ reset: opts.reset ?? false });
        for (const b of buttons) b.disabled = false;
        formElement.removeAttribute('aria-busy');
        if (result.type === 'success') {
          await tick();
          const title = successTitle(result);
          if (title) toast({ title, variant: 'success' }, 3000);
        } else if (result.type === 'failure' || result.type === 'error') {
          const data = (result.type === 'failure' ? result.data : undefined) as
            | FailureData
            | undefined;
          // Only details that name a field of this form are field errors; an API failure can carry
          // other details (a reason, a limit) that are not something the user can fix in a field.
          const fields = data?.details
            ? Object.keys(data.details).filter((k) => formElement.elements.namedItem(k)).length
            : 0;
          toast(
            {
              title: opts.failureTitle || t('common.save_failed'),
              description:
                fields > 1
                  ? t('common.fields_to_fix', { n: fields })
                  : data?.error || data?.message || t('common.action_failed'),
              variant: 'error',
            },
            8000,
          );
          await tick();
          if (formElement.isConnected) revealProblem(formElement);
        }
        opts.onDone?.(result);
      };
    };
}
