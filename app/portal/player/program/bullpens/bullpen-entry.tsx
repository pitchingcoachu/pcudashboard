'use client';

import ScriptEntry from '../shared-script-entry';

type ScriptTemplate = {
  id: string;
  name: string;
  category?: string;
  rowCount: number;
  columns: string[];
  columnTypes?: string[];
  rows: string[][];
};

export default function BullpenEntry(props: {
  templates: ScriptTemplate[];
  state: { selectedTemplateId: string; visibleTemplateIds: string[] };
  playerId: number;
  previewQuery: string;
  schoolLogoSrc: string | null;
  schoolLogoAlt: string;
}) {
  return <ScriptEntry mode="bullpen" {...props} />;
}
