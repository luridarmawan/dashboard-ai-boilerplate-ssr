import { defineMenu } from '@core/module-kit';

/**
 * Menu (extension point 4, F-3). The assistant sits at the top level next to Dashboard; the
 * provider/analytics admin lives in the module's own group (titled "AI Platform" by module.json);
 * MCP servers join the shared Integration group and the call log the shared Monitoring group.
 */
export default defineMenu('AI', [
  {
    id: 'ai.chat',
    label: { id: 'Asisten AI', en: 'AI assistant' },
    href: '/m/ai/chat',
    icon: 'sparkles',
    permission: 'ai.chat.read',
    order: 5,
    group: null,
  },
  {
    id: 'ai.mcps',
    label: { id: 'Server MCP', en: 'MCP servers' },
    href: '/m/ai/mcps',
    icon: 'plug',
    permission: 'ai.mcp.read',
    order: 120,
    group: 'integration',
  },
  {
    id: 'ai.providers',
    label: { id: 'Penyedia AI', en: 'AI providers' },
    href: '/m/ai/providers',
    icon: 'server',
    permission: 'ai.provider.read',
    order: 125,
  },
  {
    id: 'ai.analytics',
    label: { id: 'Analitik AI', en: 'AI analytics' },
    href: '/m/ai/analytics',
    icon: 'chart-bar',
    permission: 'ai.log.read',
    order: 128,
  },
  {
    id: 'ai.logs',
    label: { id: 'Log AI', en: 'AI log' },
    href: '/m/ai/logs',
    icon: 'chart-line',
    permission: 'ai.log.read',
    order: 130,
    group: 'monitoring',
  },
]);
