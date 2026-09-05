'use client';

import { useMemo, useState } from 'react';

type GroupOption = {
  id: number;
  name: string;
};

export default function MasterCalendarGroupFilter({
  groups,
  initialSelectedIds,
}: {
  groups: GroupOption[];
  initialSelectedIds: number[];
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>(initialSelectedIds);
  const allSelected = selectedIds.length === 0;
  const selectedNames = useMemo(
    () => groups.filter((group) => selectedIds.includes(group.id)).map((group) => group.name),
    [groups, selectedIds]
  );
  const summary = allSelected
    ? 'All'
    : selectedNames.length <= 2
      ? selectedNames.join(', ')
      : `${selectedNames.length} groups selected`;

  function toggleGroup(groupId: number) {
    setSelectedIds((current) =>
      current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId]
    );
  }

  return (
    <div className="portal-master-calendar-group-filter">
      <span>Groups</span>
      <details className="portal-master-calendar-group-dropdown">
        <summary>
          <span className="portal-master-calendar-group-summary-text">{summary}</span>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5.5 7.5 4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </summary>
        <div className="portal-master-calendar-group-menu">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelectedIds([])}
            />
            <span>All</span>
          </label>
          {groups.map((group) => (
            <label key={group.id}>
              <input
                type="checkbox"
                name="groupId"
                value={group.id}
                checked={selectedIds.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
              />
              <span>{group.name}</span>
            </label>
          ))}
          {groups.length === 0 ? <p>No player groups have been created.</p> : null}
        </div>
      </details>
    </div>
  );
}
