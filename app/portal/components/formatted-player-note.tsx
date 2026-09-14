import styles from './formatted-player-note.module.css';

type AiTranscriptParts = {
  title: string;
  sessionType: string;
  points: string[];
  transcript: string;
};

export function playerNoteCategoryLabel(category: string): string {
  return category === 'AI Session' ? 'AI Transcript' : category;
}

function parseAiTranscript(text: string): AiTranscriptParts {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const titleLine = lines.find((line) => /^AI (?:Session|Transcript):/i.test(line));
  const sessionTypeLine = lines.find((line) => /^Session Type:/i.test(line));
  const keyPointsIndex = lines.findIndex((line) => /^Key Points:\s*$/i.test(line));
  const transcriptIndex = lines.findIndex((line) => /^Full Transcript:\s*$/i.test(line));
  const pointLines = keyPointsIndex >= 0
    ? lines.slice(keyPointsIndex + 1, transcriptIndex >= 0 ? transcriptIndex : undefined)
    : [];

  return {
    title: titleLine?.replace(/^AI (?:Session|Transcript):\s*/i, '').trim() ?? '',
    sessionType: sessionTypeLine?.replace(/^Session Type:\s*/i, '').trim() ?? '',
    points: pointLines
      .map((line) => line.replace(/^\s*[•*-]\s*/, '').trim())
      .filter(Boolean),
    transcript: transcriptIndex >= 0 ? lines.slice(transcriptIndex + 1).join('\n').trim() : '',
  };
}

export default function FormattedPlayerNote({ text, category }: { text: string; category: string }) {
  if (playerNoteCategoryLabel(category) !== 'AI Transcript') {
    return <p className={styles.plain}>{text}</p>;
  }

  const note = parseAiTranscript(text);
  return (
    <div className={styles.note}>
      <div className={styles.meta}>
        {note.title ? <p><span className={styles.label}>AI Transcript:</span> {note.title}</p> : null}
        {note.sessionType ? <p><span className={styles.label}>Session Type:</span> {note.sessionType}</p> : null}
      </div>
      {note.points.length ? (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Key Points</h4>
          <ul className={styles.points}>{note.points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
        </section>
      ) : null}
      {note.transcript ? (
        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Full Transcript</h4>
          <div className={styles.transcript}><p>{note.transcript}</p></div>
        </section>
      ) : null}
    </div>
  );
}
