import { t } from 'elysia';

/** Body schemas shared by the API routes AND the dashboard forms (L-17). */
export const NoteBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 191 }),
  body: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  pinned: t.Optional(t.Nullable(t.Boolean())),
});
export const NoteUpdateBody = t.Partial(NoteBody);
