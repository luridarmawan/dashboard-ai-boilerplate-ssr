/**
 * `@core/module-kit` — what a module author imports.
 *
 * A module lives in its own folder (and may live in its own repository, §4.9). It depends on
 * this package and on `@core/db` as real packages — never on relative paths into core.
 */
export {
  CORE_ACTIONS,
  CORE_PERMISSION_OWNERS,
  type CoreAction,
  defineMenu,
  definePermissions,
  defineTables,
  type MenuEntryDef,
  ModuleContractError,
  type PermissionDef,
} from './contract.ts';
export {
  type LocalizedText,
  MODULE_NAME_RE,
  type ModuleManifest,
  type ModuleSource,
  type ModulesFile,
  moduleManifestSchema,
  moduleSourceSchema,
  modulesFileSchema,
  namespaceOf,
  satisfiesCore,
} from './manifest.ts';
