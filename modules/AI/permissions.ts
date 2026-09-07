import { definePermissions } from '@core/module-kit';

export default definePermissions('AI', [
  {
    resource: 'ai.chat',
    actions: ['read', 'create', 'manage'],
    name: { id: 'Chat AI', en: 'AI chat' },
  },
  { resource: 'ai.log', actions: ['read'], name: { id: 'Log panggilan AI', en: 'AI call log' } },
  {
    resource: 'ai.mcp',
    /** read/manage the registrations; `use` = the caller's assistant may call tools of enabled servers (I-4). */
    actions: ['read', 'manage', 'use'],
    name: { id: 'Server MCP eksternal', en: 'External MCP servers' },
  },
]);
