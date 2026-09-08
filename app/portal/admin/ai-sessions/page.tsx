import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import AiSessionsClient from './ai-sessions-client';
export default async function AiSessionsPage(){const session=await requirePortalSession();if(session.role==='player')redirect('/portal/player');return <div className="portal-admin-stack"><div className="portal-admin-headline"><h2>AI Sessions</h2><p>Record or upload a session, then review its transcript and coaching summary.</p></div><AiSessionsClient /></div>;}
