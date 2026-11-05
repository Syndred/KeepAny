import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { expect, it, vi } from 'vitest';
import i18n from '../i18n';
vi.mock('../view-shared', () => ({ useAppContext: () => ({ data: { preferences: [], loading: false } }) }));
import { ReminderSettingsPanel } from './ReminderSettingsPanel';
for (const language of ['zh-CN', 'en']) for (const native of [false, true]) {
  it(`shows only applicable reminder controls for ${language} ${native ? 'native' : 'web'}`, async () => {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(ReminderSettingsPanel, { native })));
    expect(html).toContain(i18n.t('reminderEnabled'));
    expect(html).toContain(i18n.t(native ? 'nativeReminderRuntimeScope' : 'reminderRuntimeScope'));
    if (native) {
      expect(html).not.toContain(i18n.t('reminderBrowserEnabled'));
      expect(html).not.toContain(i18n.t('reminderPermission_unsupported'));
    } else expect(html).toContain(i18n.t('reminderBrowserEnabled'));
  });
}
