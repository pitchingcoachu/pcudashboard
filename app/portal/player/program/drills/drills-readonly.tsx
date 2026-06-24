'use client';

import type { DrillSectionState, DrillsState } from '../../../../../lib/drills-program';

function DrillSection({ title, state }: { title: string; state: DrillSectionState }) {
  const visibleRows = state.rows.slice(0, state.rowCount);
  const hasPlan = visibleRows.some((row) => Object.values(row).some((value) => String(value ?? '').trim()));
  if (!hasPlan) {
    return (
      <section className="portal-panel portal-drills-section">
        <h3>{title}</h3>
        <p className="portal-muted-text" style={{ margin: 0, textAlign: 'center' }}>No plan selected.</p>
      </section>
    );
  }
  return (
    <section className="portal-panel portal-drills-section">
      <h3>{title}</h3>
      <div className="portal-table-wrap">
        <table className="portal-drills-table portal-drills-table-readonly">
          <colgroup>
            <col className="portal-drills-col-drill" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-compact" />
            <col className="portal-drills-col-notes" />
          </colgroup>
          <thead>
            <tr>
              {['Drill', 'Sets', 'Reps', 'Weight', 'Notes'].map((label) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                <td>{row.drill || '—'}</td>
                <td>{row.sets || '—'}</td>
                <td>{row.reps || '—'}</td>
                <td>{row.weight || '—'}</td>
                <td>{row.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DrillsReadonly({ state }: { state: DrillsState }) {
  return (
    <div className="portal-drills-sections">
      <DrillSection title="Pre-Throw Plyos and Drills" state={state.pre} />
      <DrillSection title="Post-Throw Plyos and Drills" state={state.post} />
    </div>
  );
}
