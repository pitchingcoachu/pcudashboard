'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type ProfilesListRow = {
  playerId: number;
  fullName: string;
  goals: string[];
};

type ProfilesListProps = {
  players: ProfilesListRow[];
};

export default function ProfilesList({ players }: ProfilesListProps) {
  const [query, setQuery] = useState('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlayers = useMemo(() => {
    if (!normalizedQuery) return players;
    return players.filter((player) => {
      const haystack = `${player.fullName} ${player.goals.join(' ')}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, players]);

  const playerPlanHref = (playerId: number) => `/portal/dashboard?suite=player-plans&playerPlanPlayerId=${playerId}`;

  const downloadPdf = async () => {
    setIsDownloadingPdf(true);
    try {
      const { jsPDF } = await import('jspdf');
      const logoDataUrl = await fetch('/pearl-clam-transparent.png')
        .then((response) => response.blob())
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result ?? ''));
              reader.onerror = () => reject(new Error('Could not load logo.'));
              reader.readAsDataURL(blob);
            })
        )
        .catch(() => '');
      const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 36;
      const tableWidth = pageWidth - margin * 2;
      const isLightMode = document.body.classList.contains('theme-light');
      const colors = isLightMode
        ? {
            page: [255, 255, 255] as const,
            title: [20, 20, 24] as const,
            header: [130, 24, 34] as const,
            headerText: [255, 255, 255] as const,
            rowA: [248, 248, 250] as const,
            rowB: [255, 255, 255] as const,
            rowText: [35, 35, 40] as const,
            line: [225, 225, 230] as const,
            muted: [90, 90, 96] as const,
          }
        : {
            page: [4, 4, 6] as const,
            title: [245, 245, 248] as const,
            header: [142, 28, 42] as const,
            headerText: [255, 255, 255] as const,
            rowA: [16, 16, 20] as const,
            rowB: [8, 8, 12] as const,
            rowText: [235, 235, 240] as const,
            line: [58, 58, 66] as const,
            muted: [165, 165, 175] as const,
          };
      const setFillColor = (color: readonly [number, number, number]) => pdf.setFillColor(color[0], color[1], color[2]);
      const setTextColor = (color: readonly [number, number, number]) => pdf.setTextColor(color[0], color[1], color[2]);
      const setDrawColor = (color: readonly [number, number, number]) => pdf.setDrawColor(color[0], color[1], color[2]);
      const lineHeight = 10;
      const columns = [
        { label: 'Name', width: 140 },
        { label: 'Goal 1', width: (tableWidth - 140) / 3 },
        { label: 'Goal 2', width: (tableWidth - 140) / 3 },
        { label: 'Goal 3', width: (tableWidth - 140) / 3 },
      ];
      const today = new Date().toISOString().slice(0, 10);
      let y = margin;

      const drawPageTop = () => {
        setFillColor(colors.page);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        if (logoDataUrl) {
          pdf.addImage(logoDataUrl, 'PNG', margin, 21, 42, 42);
          pdf.addImage(logoDataUrl, 'PNG', pageWidth - margin - 42, 21, 42, 42);
        }
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(18);
        setTextColor(colors.title);
        pdf.text('Player Plan Goals', pageWidth / 2, 46, { align: 'center' });
        y = 76;
      };

      const drawHeader = () => {
        let x = margin;
        const headerHeight = 24;
        setFillColor(colors.header);
        pdf.rect(margin, y, tableWidth, headerHeight, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        setTextColor(colors.headerText);
        columns.forEach((column) => {
          pdf.text(column.label, x + column.width / 2, y + headerHeight / 2 + 3, { align: 'center' });
          x += column.width;
        });
        y += headerHeight;
      };

      drawPageTop();
      drawHeader();

      const rows = filteredPlayers.length > 0 ? filteredPlayers : [];
      rows.forEach((player, index) => {
        const values = [player.fullName, player.goals[0] || 'None', player.goals[1] || 'None', player.goals[2] || 'None'];
        const linesByCell = values.map((value, cellIndex) =>
          pdf.splitTextToSize(value, columns[cellIndex].width - 12) as string[]
        );
        const rowHeight = Math.max(30, Math.max(...linesByCell.map((lines) => lines.length)) * lineHeight + 12);

        if (y + rowHeight > pageHeight - margin) {
          pdf.addPage();
          drawPageTop();
          drawHeader();
        }

        setFillColor(index % 2 === 0 ? colors.rowA : colors.rowB);
        pdf.rect(margin, y, tableWidth, rowHeight, 'F');
        setDrawColor(colors.line);
        pdf.line(margin, y + rowHeight, margin + tableWidth, y + rowHeight);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        setTextColor(colors.rowText);

        let x = margin;
        linesByCell.forEach((lines, cellIndex) => {
          const textBlockHeight = lines.length * lineHeight;
          const textY = y + (rowHeight - textBlockHeight) / 2 + 8;
          pdf.text(lines, x + columns[cellIndex].width / 2, textY, {
            align: 'center',
            maxWidth: columns[cellIndex].width - 12,
            lineHeightFactor: 1.2,
          });
          x += columns[cellIndex].width;
        });
        y += rowHeight;
      });

      if (rows.length === 0) {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(10);
        setTextColor(colors.muted);
        pdf.text('No matching profiles.', margin, y + 18);
      }

      pdf.save(`profiles-goals-${today}.pdf`);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  return (
    <section className="portal-panel">
      <div className="portal-row-between">
        <h2>Player Plan Goals</h2>
        <div className="profiles-toolbar-actions">
          <label className="portal-inline-filter profiles-search-filter">
            Search
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search players or goals"
            />
          </label>
          <button type="button" className="btn btn-ghost profiles-pdf-button" onClick={downloadPdf} disabled={isDownloadingPdf}>
            {isDownloadingPdf ? 'Downloading...' : 'Download PDF'}
          </button>
        </div>
      </div>

      <div className="portal-table-wrap">
        <table className="portal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Goal 1</th>
              <th>Goal 2</th>
              <th>Goal 3</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.map((player) => (
              <tr key={player.playerId}>
                <td>
                  <Link href={`/portal/player?previewPlayerId=${player.playerId}`} className="portal-table-link">
                    {player.fullName}
                  </Link>
                </td>
                <td>
                  {player.goals[0] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[0]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
                <td>
                  {player.goals[1] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[1]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
                <td>
                  {player.goals[2] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[2]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
              </tr>
            ))}
            {filteredPlayers.length === 0 ? (
              <tr>
                <td colSpan={4} className="portal-muted-text">
                  No matching profiles.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
