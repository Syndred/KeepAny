let nativeRead: { read: () => Promise<string>; revision: number } | undefined;

/** Register at native bootstrap; clipboard contents are read only on explicit use. */
export function registerClipboardReadHandler(handler: () => Promise<string>): () => void {
  if (nativeRead) throw Error('clipboard-already-registered');
  const registration = { read: handler, revision: 0 };
  nativeRead = registration;
  const background = () => { registration.revision += 1; };
  const surface = typeof window === 'undefined' ? undefined : window;
  surface?.addEventListener('keepany-native-background', background);
  return () => {
    if (nativeRead === registration) nativeRead = undefined;
    registration.revision += 1;
    surface?.removeEventListener('keepany-native-background', background);
  };
}

export function readClipboardText(): Promise<string> {
  const registration = nativeRead;
  if (registration) {
    const revision = registration.revision;
    return registration.read().then(text => {
      if (nativeRead !== registration || registration.revision !== revision) throw Error('clipboard-read-cancelled');
      return text;
    });
  }
  return navigator.clipboard.readText();
}
