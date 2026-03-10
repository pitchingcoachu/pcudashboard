export default function PortalLoading() {
  return (
    <div className="portal-shell">
      <section className="portal-panel portal-loading-panel" aria-live="polite" aria-busy="true">
        <p className="portal-loading-text">Loading page...</p>
      </section>
    </div>
  );
}
