import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.syndred.keepany',
  appName: 'KeepAny',
  // Plugin arguments can contain credentials. Never send bridge payloads to OS logs.
  loggingBehavior: 'none',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  ios: { contentInset: 'always', preferredContentMode: 'mobile' },
  plugins: {
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/Application Support/KeepAny/databases',
      // Ordinary records are not advertised as encrypted. Passwords stay KDBX.
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
  },
};
export default config;
