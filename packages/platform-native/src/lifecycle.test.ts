import { afterEach, expect, it, vi } from "vitest";
const callbacks = new Map<string, (payload: any) => unknown>();
const historyBack = vi.fn(), minimize = vi.fn();
vi.mock("@capacitor/app", () => ({ App: { addListener: async (name: string, callback: (payload: any) => unknown) => { callbacks.set(name, callback); return { remove: vi.fn() }; }, minimizeApp: () => minimize() } }));
vi.mock("./index", () => ({ nativePlatform: () => "android" }));
afterEach(() => { callbacks.clear(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("closes the top Base UI data-open popup before navigating and relays background immediately", async () => {
  const api = await import("./lifecycle").catch(() => null);
  expect(api, "native lifecycle registration is required").not.toBeNull();
  if (!api) return;
  const dialog = { dispatchEvent: vi.fn(), contains: () => false };
  const menu = { dispatchEvent: vi.fn(), contains: () => false };
  const dispatchEvent = vi.fn();
  let nodes = [dialog, menu];
  vi.stubGlobal("KeyboardEvent", class { constructor(public type: string, public options: unknown) {} });
  vi.stubGlobal("window", { dispatchEvent, history: { back: historyBack } });
  vi.stubGlobal("document", { querySelectorAll: (selector: string) => selector.includes("data-open") ? nodes : [] });
  const cleanup = await api.installNativeLifecycle();
  callbacks.get("appStateChange")?.({ isActive: false });
  expect(dispatchEvent.mock.calls[0][0].type).toBe("keepany-native-background");
  await callbacks.get("backButton")?.({ canGoBack: true });
  expect(menu.dispatchEvent).toHaveBeenCalledOnce();
  expect(dialog.dispatchEvent).not.toHaveBeenCalled();
  expect(dispatchEvent.mock.calls.some(([event]) => event.type === "keepany-native-back")).toBe(false);
  expect(historyBack).not.toHaveBeenCalled();
  nodes = [];
  await callbacks.get("backButton")?.({ canGoBack: true });
  expect(historyBack).toHaveBeenCalledOnce();
  await callbacks.get("backButton")?.({ canGoBack: false });
  expect(minimize).toHaveBeenCalledOnce();
  await cleanup();
});

it("lets the shared shell consume back for its drawer/search before history or minimize", async () => {
  const { installNativeLifecycle } = await import("./lifecycle");
  let shellOpen = true;
  const dispatchEvent = vi.fn((event: Event) => {
    if (event.type === "keepany-native-back" && shellOpen) {
      shellOpen = false;
      event.preventDefault();
    }
    return !event.defaultPrevented;
  });
  vi.stubGlobal("window", { dispatchEvent, history: { back: historyBack } });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  await installNativeLifecycle();
  await callbacks.get("backButton")?.({ canGoBack: true });
  expect(shellOpen).toBe(false);
  expect(historyBack).not.toHaveBeenCalled();
  expect(minimize).not.toHaveBeenCalled();
  await callbacks.get("backButton")?.({ canGoBack: true });
  expect(historyBack).toHaveBeenCalledOnce();
  shellOpen = true;
  await callbacks.get("backButton")?.({ canGoBack: false });
  expect(minimize).not.toHaveBeenCalled();
  await callbacks.get("backButton")?.({ canGoBack: false });
  expect(minimize).toHaveBeenCalledOnce();
});

it("locks on a quick Android pause/resume even without a full stop, and deduplicates state events", async () => {
  const { installNativeLifecycle } = await import("./lifecycle");
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { dispatchEvent, history: { back: historyBack } });
  vi.stubGlobal("document", { querySelectorAll: () => [] });
  const cleanup = await installNativeLifecycle();
  callbacks.get("pause")?.({});
  expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["keepany-native-background"]);
  callbacks.get("appStateChange")?.({ isActive: false });
  callbacks.get("resume")?.({});
  callbacks.get("appStateChange")?.({ isActive: true });
  expect(dispatchEvent.mock.calls.map(([event]) => event.type)).toEqual(["keepany-native-background", "keepany-native-foreground"]);
  await cleanup();
});
