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
]);
