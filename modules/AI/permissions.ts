import { definePermissions } from '@core/module-kit';

export default definePermissions('AI', [
  {
    resource: 'ai.chat',
    actions: ['read', 'create', 'manage'],
    name: { id: 'Chat AI', en: 'AI chat' },
  },
  { resource: 'ai.log', actions: ['read'], name: { id: 'Log panggilan AI', en: 'AI call log' } },
  {
    resource: 'ai.provider',
    /** read/manage the profiles (H-10); every chat user sees the enabled picker options. */
    actions: ['read', 'manage'],
    name: { id: 'Penyedia AI', en: 'AI providers' },
  },
  {
    resource: 'ai.credit',
    /** Top up / adjust the tenant's AI balance and read its ledger (B-6, H-14). */
    actions: ['manage'],
    name: { id: 'Saldo AI', en: 'AI credit' },
  },
  {
    resource: 'ai.mcp',
    /** read/manage the registrations; `use` = the caller's assistant may call tools of enabled servers (I-4). */
    actions: ['read', 'manage', 'use'],
    name: { id: 'Server MCP eksternal', en: 'External MCP servers' },
  },
]);
