import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import AiSessionsClient from './ai-sessions-client';
export default async function AiSessionsPage(){const session=await requirePortalSession();if(session.role==='player')redirect('/portal/player');return <AiSessionsClient />;}
