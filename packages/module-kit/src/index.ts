/**
 * `@core/module-kit` — what a module author imports.
 *
 * A module lives in its own folder (and may live in its own repository, §4.9). It depends on
 * this package and on `@core/db` as real packages — never on relative paths into core.
 */
export {
  type ApiRoutesLike,
  CORE_ACTIONS,
  CORE_PERMISSION_OWNERS,
  type ConfigFieldDef,
  type ConfigFieldType,
  type ConfigSectionDef,
  type CoreAction,
  defineApiRoutes,
  defineConfig,
  defineIconSets,
  defineLayouts,
  defineMenu,
  definePermissions,
  definePublicRoutes,
  defineSeed,
  defineTables,
  defineWidgets,
  type IconSetContribDef,
  type LayoutContribDef,
  type MenuEntryDef,
  ModuleContractError,
  type ModuleSeed,
  type ModuleSeedContext,
  type PermissionDef,
  type PublicRouteDef,
  type WidgetDef,
} from './contract.ts';
export {
  CORE_EVENTS,
  type CoreEventName,
  type CoreEventPayloads,
  defineHooks,
  type HookContext,
  type HookHandler,
  type HookMap,
  type ModuleHooks,
} from './events.ts';
export {
  defineJobs,
  type JobContext,
  type JobDef,
  parseEvery,
  type ResolvedJob,
  resolveJob,
} from './jobs.ts';
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
