export const metadata = {
  title: 'Privacy Policy | PCU Dashboard',
  description: 'Privacy Policy for PCU Dashboard.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="page-shell">
      <section className="content-panel" style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Privacy Policy</h1>
        <p>
          <strong>Effective date:</strong> March 14, 2026
        </p>
        <p>
          PCU Dashboard (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) provides athlete training management tools
          for coaches and players.
        </p>

        <h2>Information We Collect</h2>
        <ul>
          <li>Account information (name, email, role, login credentials)</li>
          <li>Profile details you provide (team, position, graduation year, height, profile photo, etc.)</li>
          <li>Training data (workouts, logs, assessments, body weight entries, notes)</li>
          <li>Basic technical data needed to operate the service (device/browser/app usage metadata)</li>
        </ul>

        <h2>How We Use Information</h2>
        <p>We use information to:</p>
        <ul>
          <li>Authenticate users and manage access by role</li>
          <li>Provide training schedules, workout logging, and progress tracking</li>
          <li>Enable coach-player collaboration</li>
          <li>Maintain and improve app performance and reliability</li>
          <li>Provide support and respond to requests</li>
        </ul>

        <h2>Sharing of Information</h2>
        <p>We do not sell personal information.</p>
        <p>We may share data only as needed to:</p>
        <ul>
          <li>Provide core infrastructure/services (hosting, database, analytics, support)</li>
          <li>Comply with legal obligations</li>
          <li>Protect security and prevent abuse</li>
        </ul>

        <h2>Data Retention</h2>
        <p>
          We retain account and training data while an account is active, and as needed for legitimate business or legal
          purposes.
        </p>

        <h2>Security</h2>
        <p>
          We apply reasonable technical and organizational safeguards to protect information. No method of transmission
          or storage is 100% secure.
        </p>

        <h2>Children&apos;s Privacy</h2>
        <p>
          PCU Dashboard is intended for users under supervision of teams/coaches and is not directed to children under
          13 without appropriate parent/guardian and organization oversight.
        </p>

        <h2>Your Choices</h2>
        <p>
          Depending on your relationship with your organization, you may request updates or deletion of profile data by
          contacting us.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy questions, contact:
          <br />
          support@pcudashboard.com
        </p>

        <h2>Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Updated versions will be posted at this URL with a
          revised effective date.
        </p>
      </section>
    </main>
  );
}
