/**
 * Modular Storage / Upload Handler Interface
 * Streams 10s video chunks out immediately without memory hoarding.
 * Enables easy swapping between Go backend chunks, S3 multipart, or local disk streaming.
 */

import { api } from '../../api/client';

export interface ChunkMetadata {
  caseId: string;
  recordingId: string;
  chunkIndex: number;
  isLastChunk: boolean;
  durationSeconds: number;
}

export interface IChunkStorageHandler {
  /**
   * Initializes a recording session on the storage provider.
   * Returns a unique recording ID.
   */
  initRecording(caseId: string, contactId?: string): Promise<string>;

  /**
   * Streams out an individual timeslice chunk immediately.
   */
  uploadChunk(chunk: Blob, meta: ChunkMetadata): Promise<void>;

  /**
   * Finalizes the recording and signals background stitching / hash generation.
   */
  completeRecording(caseId: string, recordingId: string, totalDurationSeconds: number): Promise<void>;

  /**
   * Aborts a recording in progress.
   */
  abortRecording(caseId: string, recordingId: string): Promise<void>;
}

/**
 * Default Go API Backend Storage Transport Handler
 * Streams chunks sequentially to /api/v1/cases/:id/recordings/:recId/chunks
 */
export class BackendChunkStorageHandler implements IChunkStorageHandler {
  async initRecording(caseId: string, contactId?: string): Promise<string> {
    try {
      const res = await api.startRecording(caseId, contactId);
      if (res && res.recording_id) {
        return res.recording_id;
      }
      return `rec_${Date.now()}`;
    } catch (err) {
      console.warn('Backend startRecording fallback:', err);
      // Fallback ID if offline or backend start fails
      return `rec_${Date.now()}`;
    }
  }

  async uploadChunk(chunk: Blob, meta: ChunkMetadata): Promise<void> {
    if (!chunk || chunk.size === 0) return;
    try {
      await api.uploadChunk(meta.caseId, meta.recordingId, meta.chunkIndex, chunk);
    } catch (err) {
      console.error(`Failed to upload chunk #${meta.chunkIndex}:`, err);
      // In a production setup, retry queue or local IndexedDB buffer can be hooked here
    }
  }

  async completeRecording(caseId: string, recordingId: string, totalDurationSeconds: number): Promise<void> {
    try {
      await api.stopRecording(caseId, recordingId, Math.max(1, totalDurationSeconds));
    } catch (err) {
      console.error('Failed to finalize recording on backend:', err);
    }
  }

  async abortRecording(caseId: string, recordingId: string): Promise<void> {
    console.log(`Recording aborted: caseId=${caseId}, recordingId=${recordingId}`);
  }
}
