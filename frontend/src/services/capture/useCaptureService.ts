/**
 * React Hook for CaptureService
 */

import { useState, useEffect, useCallback } from 'react';
import { getCaptureService, CaptureState, RecordingOptions } from './index';

export function useCaptureService() {
  const service = getCaptureService();
  const [state, setState] = useState<CaptureState>(service.getState());

  useEffect(() => {
    const unsubscribe = service.subscribe(setState);
    return unsubscribe;
  }, [service]);

  const initSession = useCallback(async () => {
    return await service.initSession();
  }, [service]);

  const endSession = useCallback(async () => {
    await service.endSession();
  }, [service]);

  const startRecording = useCallback(
    async (caseId: string, options?: RecordingOptions) => {
      await service.startRecording(caseId, options);
    },
    [service]
  );

  const pauseRecording = useCallback(() => {
    service.pauseRecording();
  }, [service]);

  const resumeRecording = useCallback(() => {
    service.resumeRecording();
  }, [service]);

  const stopRecording = useCallback(async () => {
    return await service.stopRecording();
  }, [service]);

  const takeScreenshot = useCallback(
    async (caption?: string) => {
      return await service.takeScreenshot(caption);
    },
    [service]
  );

  const launchOverlay = useCallback(async () => {
    await service.launchOverlay();
  }, [service]);

  return {
    ...state,
    service,
    initSession,
    endSession,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    takeScreenshot,
    launchOverlay,
  };
}
