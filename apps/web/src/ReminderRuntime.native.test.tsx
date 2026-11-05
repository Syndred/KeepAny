import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const probe = vi.hoisted(() => ({ native: false, effects: [] as Array<() => unknown>, notify: vi.fn(), browser: vi.fn(() => 'unsupported'), delivered: vi.fn(async (_input: unknown, dispatch: () => void) => { dispatch(); return true; }) }));
// Effect scheduling is explicit preparation. This checks the real delivery
// callback with an imported browserEnabled=true preference, not Android UI.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: (effect: () => unknown) => { probe.effects.push(effect); } }));
vi.mock('./platform-settings', () => ({ hasPlatformSettings: () => probe.native }));
vi.mock('./view-shared', () => ({ useAppContext: () => ({ data: { loading: false, preferences: [], tasks: [], assets: [] }, notify: probe.notify }) }));
vi.mock('../../../packages/local-db/src', () => ({ localRepository: async () => ({ deliverReminderIfCurrent: probe.delivered }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('@tanstack/react-router', () => ({ Link: ({ children }: { children: import('react').ReactNode }) => createElement('a', null, children), useNavigate: () => vi.fn() }));
vi.mock('./components/ui/text-link', () => ({ TextLink: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('./reminders', () => ({
  REMINDER_CATCH_UP_MS: 7 * 86400000, REMINDER_SETTINGS_ID: 'reminder-settings',
  readReminderSettings: () => ({ browserEnabled: true, timeZone: 'UTC', subscriptionOverrides: {} }),
  dueReminders: () => [{ sourceType: 'task', source: { id: 'fictional-due-task', name: 'Fictional due task' }, scheduledAt: new Date().toISOString(), dueAt: new Date().toISOString() }],
  reminderDeliveryId: async () => 'fictional-delivery', showBrowserReminder: probe.browser,
}));
import { ReminderRuntime } from './ReminderRuntime';
beforeEach(() => { probe.effects.length = 0; vi.clearAllMocks(); });
for (const native of [true, false]) {
  it(`keeps in-app delivery and ${native ? 'skips' : 'retains'} browser notifications for an imported preference`, async () => {
    probe.native = native;
    renderToStaticMarkup(createElement(ReminderRuntime));
    const cleanup = probe.effects[1]() as (() => void);
    await vi.waitFor(() => expect(probe.notify).toHaveBeenCalledWith('reminderArrived'));
    expect(probe.delivered).toHaveBeenCalledOnce();
    if (native) expect(probe.browser).not.toHaveBeenCalled();
    else expect(probe.browser).toHaveBeenCalledOnce();
    cleanup();
  });
}
