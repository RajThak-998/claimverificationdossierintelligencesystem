export type UserRole = 'ADMIN' | 'MANAGER' | 'AGENT' | 'INSURER';

export type CaseStatus =
  | 'UNASSIGNED'
  | 'WORK_IN_PROGRESS'
  | 'REVIEW'
  | 'ADMIN_SIGN_OFF'
  | 'COMPLETED';

export type VehicleCategory = 'HEAVY_VEHICLE' | 'LMV';
export type ClaimCategory = 'OD' | 'TP' | 'IBNR' | '281' | 'OTHER';

export type ContactRole =
  | 'INSURED'
  | 'OWNER_OF_VEHICLE'
  | 'DRIVER_OF_VEHICLE'
  | 'GARAGE_MECHANIC'
  | 'WITNESS'
  | 'OTHER';

export type CallDisposition =
  | 'GENERAL_NOTE'
  | 'LINE_BUSY'
  | 'RINGING_NO_ANSWER'
  | 'ASKED_FOR_CALLBACK'
  | 'HOSTILE_REFUSED'
  | 'CALL_COMPLETED';

export type DocumentCategory =
  | 'RC'
  | 'DL'
  | 'FIR_GD_COMPROMISE'
  | 'COMMERCIAL_PERMIT'
  | 'FITNESS_CERTIFICATE'
  | 'LOAD_CHALLAN_WEIGHBRIDGE'
  | 'GARAGE_ESTIMATE'
  | 'OTHER_EVIDENCE';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  insurer_id?: string;
  insurer?: Insurer;
}

export interface Insurer {
  id: string;
  name: string;
  code: string;
  contact_email: string;
  per_minute_rate_inr: number;
}

export interface CaseContact {
  id: string;
  case_id: string;
  role: ContactRole;
  full_name: string;
  phone: string;
  address?: string;
  is_primary: boolean;
  created_at: string;
}

export interface CallLog {
  id: string;
  case_id: string;
  contact_id?: string;
  contact?: CaseContact;
  agent_id: string;
  agent?: User;
  disposition: CallDisposition;
  notes: string;
  recall_at?: string;
  created_at: string;
}

export interface RecordingChunk {
  id: string;
  chunk_index: number;
  storage_path: string;
  duration_seconds: number;
  size_bytes: number;
  created_at: string;
}

export interface Recording {
  id: string;
  case_id: string;
  agent_id: string;
  contact_id?: string;
  status: 'STREAMING' | 'PROCESSING' | 'READY' | 'FAILED';
  duration_seconds: number;
  master_storage_path?: string;
  sha256_checksum?: string;
  file_size_bytes: number;
  mime_type: string;
  started_at: string;
  stopped_at?: string;
  chunks?: RecordingChunk[];
}

export interface CaseDocument {
  id: string;
  case_id: string;
  uploaded_by_id: string;
  doc_category: DocumentCategory;
  file_name: string;
  storage_path: string;
  file_size_bytes: number;
  mime_type: string;
  created_at: string;
}

export interface CaseScreenshot {
  id: string;
  case_id: string;
  recording_id?: string;
  storage_path: string;
  timestamp_offset_seconds: number;
  caption: string;
  created_at: string;
}

export interface CaseObservation {
  id: string;
  case_id: string;
  vehicle_class: VehicleCategory;
  observations_data: Record<string, any>;
  conclusion_data: Record<string, any>;
  submitted_at?: string;
  updated_at: string;
}

export interface CaseAuditLog {
  id: string;
  case_id: string;
  actor_id: string;
  actor?: User;
  action: string;
  remarks: string;
  created_at: string;
}

export interface BillingLedger {
  id: string;
  case_id: string;
  insurer_id: string;
  recording_duration_seconds: number;
  billable_minutes: number;
  rate_per_minute_inr: number;
  base_fee_inr: number;
  total_billed_inr: number;
  invoice_reference: string;
  is_paid: boolean;
  created_at: string;
}

export interface CaseItem {
  id: string;
  case_number: string;
  insurer_id: string;
  insurer_name: string;
  assigned_agent_id?: string;
  assigned_agent_name: string;
  assigned_agent_active_cases: number;
  status: CaseStatus;
  vehicle_class: VehicleCategory;
  claim_type: ClaimCategory;
  policy_number: string;
  policy_start_date?: string;
  vehicle_reg_number: string;
  accused_vehicle_number?: string;
  insured_name: string;
  insured_primary_phone: string;
  vehicle_make_model: string;
  claim_amount: number;
  state: string;
  district: string;
  accident_date?: string;
  intimation_date?: string;
  cause_of_loss: string;
  insurer_trigger_narrative: string;
  is_reassigned: boolean;
  rework_count: number;
  aging_days: number;
  total_duration_seconds: number;
  duration_formatted: string;
  verification_uuid: string;
  locked_pdf_path?: string;
  created_at: string;
  contacts: CaseContact[];
}

export interface FullCaseRecord {
  case: CaseItem;
  call_logs: CallLog[];
  recordings: Recording[];
  documents: CaseDocument[];
  screenshots: CaseScreenshot[];
  audit_logs: CaseAuditLog[];
  billing?: BillingLedger;
}
