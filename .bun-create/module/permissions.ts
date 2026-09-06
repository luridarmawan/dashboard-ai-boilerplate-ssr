import { CORE_ACTIONS, definePermissions } from '@core/module-kit';

/** Permissions (extension point 5): `hello.note.read|create|edit|manage`. */
export default definePermissions('Hello', [
  { resource: 'hello.note', actions: CORE_ACTIONS, name: { id: 'Notes', en: 'Notes' } },
]);
