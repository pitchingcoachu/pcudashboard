import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pitchingcoachu.pearlplayerdev',
  appName: 'PCU Dashboard',
  webDir: 'www',
  ios: {
    contentInset: 'always',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
  server: {
    // Wrapper mode: load live site so most web updates appear without App Store re-submission.
    url: 'https://www.pcudashboard.com/portal',
    cleartext: false,
    allowNavigation: ['*.pcudashboard.com', '*.pitchingcoachu.shinyapps.io'],
  },
};

export default config;
