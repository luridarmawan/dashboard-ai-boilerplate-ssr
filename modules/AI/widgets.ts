import { defineWidgets } from '@core/module-kit';

export default defineWidgets('AI', [
  {
    id: 'ai.assistant',
    title: { id: 'Asisten AI', en: 'AI assistant' },
    component: 'web/widgets/Assistant.svelte',
    permission: 'ai.chat.read',
    order: 90,
    size: 'sm',
  },
  {
    id: 'ai.usage',
    title: { id: 'Penggunaan AI (30 hari)', en: 'AI usage (30 days)' },
    component: 'web/widgets/Usage.svelte',
    permission: 'ai.log.read',
    order: 95,
    size: 'sm',
    // Fetched server-side per user (H-15): the dashboard passes the analytics payload as `data`.
    data: '/v1/m/ai/analytics?days=30',
  },
  {
    id: 'ai.floating_chat',
    title: { id: 'Chat mengambang', en: 'Floating chat' },
    component: 'web/widgets/FloatingChat.svelte',
    permission: 'ai.chat.create',
    // H-13: on every dashboard page (not a card); hides itself on the chat page.
    slot: 'shell',
    order: 100,
  },
]);
