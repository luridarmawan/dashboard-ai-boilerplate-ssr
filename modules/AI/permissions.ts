import { definePermissions } from '@core/module-kit';

export default definePermissions('AI', [
  {
    resource: 'ai.chat',
    actions: ['read', 'create', 'manage'],
    name: { id: 'Chat AI', en: 'AI chat' },
  },
  { resource: 'ai.log', actions: ['read'], name: { id: 'Log panggilan AI', en: 'AI call log' } },
]);
