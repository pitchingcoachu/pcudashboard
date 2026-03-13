import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pitchingcoachu.pcudashboard',
  appName: 'PCU Dashboard',
  webDir: 'www',
  ios: {
    contentInset: 'always',
  },
  server: {
    // Wrapper mode: load live site so most web updates appear without App Store re-submission.
    url: 'https://www.pcudashboard.com/portal',
    cleartext: false,
    allowNavigation: ['*.pcudashboard.com', '*.pitchingcoachu.shinyapps.io'],
  },
};

export default config;
