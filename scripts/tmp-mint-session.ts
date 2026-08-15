import { createSessionToken } from '../lib/auth';

const token = createSessionToken({
  userId: 4,
  email: 'jgaynor@pitchingcoachu.com',
  appUrl: 'http://localhost:3000/portal/dashboard',
  apps: [{ name: 'Dashboard', url: 'http://localhost:3000/portal/dashboard' }],
  name: 'Jared Gaynor',
  role: 'admin',
  organizationId: 1,
  playerId: null,
  dashboardSchoolCode: 'PCU',
});

console.log(token);
