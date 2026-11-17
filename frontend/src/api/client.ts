const BASE_URL = '/api/v1';

export function getStoredToken(): string | null {
  return localStorage.getItem('token');
}

export function setStoredToken(token: string) {
  localStorage.setItem('token', token);
}

export function clearStoredToken() {
  localStorage.removeItem('token');
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = `Request failed: ${response.status} ${response.statusText}`;
    try {
      const errJson = await response.json();
      if (errJson.error) {
        errorMsg = errJson.error;
      }
      if (errJson.missing_fields) {
        errorMsg += `\nMissing: ${errJson.missing_fields.join(', ')}`;
      }
    } catch (_) {}
    throw new Error(errorMsg);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; expires_at: string; user: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMe: () => request<any>('/auth/me'),
  getAgents: () => request<any[]>('/auth/agents'),

  // Cases
  getCases: (params?: Record<string, string>) => {
    const qs = new URLSearchParams(params).toString();
    return request<{
      data: any[];
      counts: Record<string, number>;
      pagination: { page: number; limit: number; total_records: number; total_pages: number };
    }>(`/cases?${qs}`);
  },
  getCase: (id: string) => request<any>(`/cases/${id}`),
  createCase: (data: any) =>
    request<any>('/cases', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  assignAgent: (caseId: string, agentId: string, reassignmentReason?: string) =>
    request<any>(`/cases/${caseId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ agent_id: agentId, reassignment_reason: reassignmentReason }),
    }),
  bulkImport: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request<{ imported_count: number; failed_rows: string[] }>('/cases/bulk-import', {
      method: 'POST',
      body: formData,
    });
  },

  // Media & 5-Second Recording Chunks
  startRecording: (caseId: string, contactId?: string) =>
    request<{ recording_id: string; case_id: string; status: string; started_at: string }>(
      `/cases/${caseId}/recordings/start`,
      {
        method: 'POST',
        body: JSON.stringify({ contact_id: contactId }),
      }
    ),
  uploadChunk: (caseId: string, recordingId: string, chunkIndex: number, blob: Blob) => {
    const formData = new FormData();
    formData.append('chunk_index', chunkIndex.toString());
    formData.append('chunk_file', blob, `chunk_${chunkIndex}.webm`);
    return request<any>(`/cases/${caseId}/recordings/${recordingId}/chunks`, {
      method: 'POST',
      body: formData,
    });
  },
  stopRecording: (caseId: string, recordingId: string, durationSeconds: number) =>
    request<any>(`/cases/${caseId}/recordings/${recordingId}/stop`, {
      method: 'POST',
      body: JSON.stringify({ duration_seconds: durationSeconds }),
    }),
  uploadDirectRecording: (caseId: string, blob: Blob, durationSeconds: number) => {
    const formData = new FormData();
    formData.append('recording_file', blob, `rec_${Date.now()}.webm`);
    formData.append('duration_seconds', durationSeconds.toString());
    return request<any>(`/cases/${caseId}/recordings/direct`, {
      method: 'POST',
      body: formData,
    });
  },
  uploadFallbackRecording: (caseId: string, file: File, durationSeconds: number) => {
    const formData = new FormData();
    formData.append('recording_file', file);
    formData.append('duration_seconds', durationSeconds.toString());
    return request<any>(`/cases/${caseId}/recordings/upload`, {
      method: 'POST',
      body: formData,
    });
  },
  uploadScreenshot: (caseId: string, file: Blob, offsetSec: number, caption?: string, recordingId?: string) => {
    const formData = new FormData();
    formData.append('screenshot', file, `snapshot_${Date.now()}.png`);
    formData.append('timestamp_offset_seconds', offsetSec.toString());
    if (caption) formData.append('caption', caption);
    if (recordingId) formData.append('recording_id', recordingId);
    return request<any>(`/cases/${caseId}/screenshots`, {
      method: 'POST',
      body: formData,
    });
  },
  uploadDocument: (caseId: string, file: File, category: string) => {
    const formData = new FormData();
    formData.append('document', file);
    formData.append('doc_category', category);
    return request<any>(`/cases/${caseId}/documents`, {
      method: 'POST',
      body: formData,
    });
  },

  // Contacts & Recalls
  addContact: (caseId: string, data: any) =>
    request<any>(`/cases/${caseId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  logCall: (caseId: string, data: any) =>
    request<any>(`/cases/${caseId}/calls`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getDueRecalls: () => request<any[]>('/calls/due-recalls'),

  // Observations
  getObservations: (caseId: string) => request<any>(`/cases/${caseId}/observations`),
  saveObservationDraft: (caseId: string, observations: any, conclusion: any) =>
    request<any>(`/cases/${caseId}/observations/draft`, {
      method: 'POST',
      body: JSON.stringify({ observations_data: observations, conclusion_data: conclusion }),
    }),
  submitCaseReport: (caseId: string, observations: any, conclusion: any) =>
    request<any>(`/cases/${caseId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ observations_data: observations, conclusion_data: conclusion }),
    }),

  // Review & Sign-Off
  approveReview: (caseId: string) =>
    request<any>(`/cases/${caseId}/review/approve`, {
      method: 'POST',
    }),
  rejectReview: (caseId: string, rejectionRemarks: string) =>
    request<any>(`/cases/${caseId}/review/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejection_remarks: rejectionRemarks }),
    }),
  adminSignOff: (caseId: string) =>
    request<any>(`/cases/${caseId}/admin/sign-off`, {
      method: 'POST',
    }),

  // Commercials & Invoicing
  getBillingMetrics: () => request<any>('/billing/metrics'),
  getBillingLedger: () => request<any[]>('/billing/ledger'),
  getInsurers: () => request<any[]>('/insurers'),

  // Public Cryptographic Verification
  verifyDossier: (uuid: string) => request<any>(`/public/verify/dossier/${uuid}`),
};
