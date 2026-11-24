import type { Task } from '@openfrost/domain';
import type { FileAccessRecord, RetrievalRecord } from '../tools/types.js';
import type { RunToolRecords, UpdateConsultRecord } from './records.js';

export function reportMarkdown(task: Task, finalText: string, records: RunToolRecords): string {
  const isProjectUpdate = task.kind === 'project_update';
  const isWeeklyPlan = task.kind === 'weekly_plan';
  const sections: string[] = [];
  if (isProjectUpdate) {
    sections.push(fileAppendix(records.fileAccess));
  }
  if (isWeeklyPlan) {
    sections.push(fileAppendix(records.fileAccess));
    sections.push(updatesAppendix(records.recentUpdates));
  }
  if (records.retrievals.length > 0) {
    sections.push(
      `## Retrieved sources\n\n` +
        (records.retrievals.length === 0
          ? 'No pages were retrieved by this run.\n'
          : retrievalAppendix(records.retrievals)),
    );
  } else if (!isProjectUpdate && !isWeeklyPlan) {
    sections.push(
      '## Retrieved sources\n\nNo pages were retrieved by this run; provider-hosted search timing is not exposed.\n',
    );
  }
  const markdown = `# ${task.title}\n\n${finalText}\n\n---\n\n${sections.join('\n')}`;
  return markdown;
}

/**
 * Runtime-recorded update appendix for weekly plans: which saved updates
 * entered context, with dates, sizes, and truncation. The model cannot
 * alter this list, so its update citations can be checked against it.
 */
function updatesAppendix(updates: UpdateConsultRecord[]): string {
  const lines = [
    '## Updates consulted',
    '',
    'Recorded by the runtime from this project\u2019s saved updates; ' +
      'the model cannot alter this list.',
    '',
  ];
  if (updates.length === 0) {
    lines.push('No saved project updates were on record for this run.\n');
    return lines.join('\n');
  }
  for (const update of updates) {
    lines.push(
      `- update saved ${update.createdAt} (task ${update.taskId ?? 'unknown'}, ` +
        `artifact ${update.artifactId}) — ${update.chars} chars` +
        (update.truncated ? ', truncated' : ''),
    );
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Runtime-recorded file appendix for project updates: every enumeration
 * entry (readable, skipped, denied, limit) plus every read attempt. The
 * model cannot alter this list, so citations can be checked against it.
 */
function fileAppendix(records: FileAccessRecord[]): string {
  const lines = [
    '## Project files consulted',
    '',
    'Recorded by the runtime from granted-folder access during this run; ' +
      'the model cannot alter this list.',
    '',
  ];
  if (records.length === 0) {
    lines.push('No granted-folder access was recorded for this run.\n');
    return lines.join('\n');
  }
  // A file can appear several times (listed by the enumeration, then read,
  // then refused after a mid-run revocation); the most recent outcome wins,
  // in the order the paths were first seen.
  const byPath = new Map<string, FileAccessRecord>();
  const order: string[] = [];
  for (const record of records) {
    if (!byPath.has(record.path)) {
      order.push(record.path);
    }
    byPath.set(record.path, record);
  }
  for (const path of order) {
    const record = byPath.get(path);
    if (!record) {
      continue;
    }
    switch (record.status) {
      case 'read':
        lines.push(`- ${record.path} — read, ${record.chars ?? 0} chars retrieved`);
        break;
      case 'failed':
        lines.push(`- ${record.path} — FAILED: ${record.reason ?? 'unknown reason'}`);
        break;
      case 'available':
        lines.push(`- ${record.path} — listed but not read`);
        break;
      default:
        lines.push(`- ${record.path} — skipped: ${record.reason ?? 'unavailable'}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function retrievalAppendix(retrievals: RetrievalRecord[]): string {
  return (
    retrievals
      .map(
        (r) =>
          `- ${r.url} — ${
            r.error !== undefined ? `unreachable: ${r.error}` : `HTTP ${r.status}`
          }, ${r.ms} ms, ${r.chars} chars retrieved`,
      )
      .join('\n') + '\n'
  );
}
