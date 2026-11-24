import type { FileAccessRecord, RetrievalRecord, RunToolContext } from '../tools/types.js';

/** One saved update artifact included in a weekly plan's context. */
export interface UpdateConsultRecord {
  artifactId: string;
  taskId: string | null;
  createdAt: string;
  chars: number;
  truncated: boolean;
}

/** Collects retrieval, granted-file access, and update records for one run. */
export class RunToolRecords implements RunToolContext {
  readonly retrievals: RetrievalRecord[] = [];
  readonly fileAccess: FileAccessRecord[] = [];
  readonly recentUpdates: UpdateConsultRecord[] = [];

  recordRetrieval(record: RetrievalRecord): void {
    this.retrievals.push(record);
  }

  recordFileAccess(record: FileAccessRecord): void {
    this.fileAccess.push(record);
  }

  recordUpdate(record: UpdateConsultRecord): void {
    this.recentUpdates.push(record);
  }
}

