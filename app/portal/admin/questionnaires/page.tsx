import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../lib/programming-scope';
import {
  listPlayerChoicesByOrganization,
  listQuestionnaireResponses,
  listQuestionnairesForOrganization,
} from '../../../../lib/training-db';
import QuestionnaireBuilder from './questionnaire-builder';

export default async function AdminQuestionnairesPage() {
  const session = await requirePortalSession();
  const organizationId = resolveProgrammingOrganizationId(session);
  const schoolCode = resolveProgrammingSchoolCode(session);
  const [playersRaw, questionnaires, responses] =
    organizationId > 0
      ? await Promise.all([
          listPlayerChoicesByOrganization({
            organizationId,
            assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
            activeOnly: true,
          }),
          listQuestionnairesForOrganization(organizationId),
          listQuestionnaireResponses({ organizationId }),
        ])
      : await Promise.resolve([[], [], []]);

  const players = playersRaw.map((player) => ({
    id: player.playerId,
    name: player.fullName,
  }));

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Questionnaires</h2>
        <p>Create player questionnaires, assign them by player/group, and review submitted answers.</p>
      </div>
      {organizationId <= 0 ? (
        <article className="portal-admin-card">
          <h3>Programming Data</h3>
          <p>No programming data is configured for {schoolCode} yet.</p>
        </article>
      ) : (
        <QuestionnaireBuilder players={players} initialQuestionnaires={questionnaires} initialResponses={responses} />
      )}
    </div>
  );
}
