export const metadata = {
  title: 'Support | Pearl Player Development',
  description: 'Support and contact information for Pearl Player Development.',
};

export default function SupportPage() {
  return (
    <main className="page-shell">
      <section className="content-panel" style={{ maxWidth: 900, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Support</h1>
        <p>
          Need help with Pearl Player Development, the coaching dashboard, or the Pearl PD mobile app? We&apos;re happy
          to help.
        </p>

        <h2>Contact Us</h2>
        <p>
          Email us at{' '}
          <a href="mailto:info@pitchingcoachu.com">info@pitchingcoachu.com</a> and we&apos;ll get back to you as soon
          as we can.
        </p>

        <h2>Account Access</h2>
        <p>
          Pearl PD and the Pearl Player Development dashboard use accounts provisioned by your team or organization.
          If you&apos;re having trouble logging in, contact your coach or organization administrator, or reach out to
          us directly at the email above.
        </p>

        <h2>Reporting a Problem</h2>
        <p>
          If you run into a bug or something isn&apos;t working as expected, email{' '}
          <a href="mailto:info@pitchingcoachu.com">info@pitchingcoachu.com</a> with a description of what happened,
          which screen you were on, and (if possible) a screenshot.
        </p>
      </section>
    </main>
  );
}
