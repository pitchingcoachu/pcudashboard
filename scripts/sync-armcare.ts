import { syncArmCareExams } from '../lib/armcare';

const organizationId = Number(process.env.ARMCARE_ORGANIZATION_ID ?? 1);
const result = await syncArmCareExams({ organizationId, schoolCode: 'PCU' });
console.log(JSON.stringify(result, null, 2));
