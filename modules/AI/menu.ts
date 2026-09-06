import { defineMenu } from '@core/module-kit';

export default defineMenu('AI', [
  {
    id: 'ai.chat',
    label: { id: 'Asisten AI', en: 'AI assistant' },
    href: '/m/ai/chat',
    icon: 'sparkles',
    permission: 'ai.chat.read',
    order: 5,
  },
  {
    id: 'ai.logs',
    label: { id: 'Log AI', en: 'AI log' },
    href: '/m/ai/logs',
    icon: 'chart-line',
    permission: 'ai.log.read',
    order: 130,
  },
]);
