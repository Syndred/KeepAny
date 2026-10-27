import { describe, expect, it } from 'vitest';
import { AiClientError } from '../../../packages/ai/src';
import { aiRequestErrorKey } from './ai-request-error';

describe('AI request feedback', () => {
  it.each([false, true])('classifies only a typed timeout, native=%s', native => {
    expect(aiRequestErrorKey(new AiClientError('timeout'), 'workspace', native)).toBe('aiRequestTimeout');
    expect(aiRequestErrorKey(new AiClientError('timeout'), 'settings', native)).toBe('aiRequestTimeout');
    expect(aiRequestErrorKey({ code: 'timeout' }, 'settings', native)).toBe(native ? 'aiNativeRequestFailed' : 'aiSettingsTestFailed');
    expect(aiRequestErrorKey(new Error('timeout-provider-private-diagnostic'), 'workspace', native)).toBe(native ? 'aiNativeRequestFailed' : 'aiError');
  });
  it('keeps native failures generic and preserves browser configuration advice', () => {
    expect(aiRequestErrorKey(new AiClientError('request-failed'), 'workspace', true)).toBe('aiNativeRequestFailed');
    expect(aiRequestErrorKey(new AiClientError('request-failed'), 'settings', true)).toBe('aiNativeRequestFailed');
    expect(aiRequestErrorKey(new AiClientError('request-failed'), 'workspace', false)).toBe('aiError');
    expect(aiRequestErrorKey(new AiClientError('request-failed'), 'settings', false)).toBe('aiSettingsTestFailed');
  });
});
