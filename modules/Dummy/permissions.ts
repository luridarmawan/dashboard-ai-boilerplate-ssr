import { CORE_ACTIONS, definePermissions } from '@core/module-kit';

/** Resources this module owns; registered into the RBAC registry (C-4), namespaced `dummy.*`. */
export default definePermissions('Dummy', [
  { resource: 'dummy.note', actions: CORE_ACTIONS, name: { id: 'Catatan', en: 'Notes' } },
]);
