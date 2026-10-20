package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type UserRole string

const (
	RoleAdmin   UserRole = "ADMIN"
	RoleManager UserRole = "MANAGER"
	RoleAgent   UserRole = "AGENT"
	RoleInsurer UserRole = "INSURER"
)

type CaseStatus string

const (
	StatusUnassigned     CaseStatus = "UNASSIGNED"
	StatusWorkInProgress CaseStatus = "WORK_IN_PROGRESS"
	StatusReview         CaseStatus = "REVIEW"
	StatusAdminSignOff   CaseStatus = "ADMIN_SIGN_OFF"
	StatusCompleted      CaseStatus = "COMPLETED"
)

type VehicleCategory string

const (
	VehicleHeavyCommercial VehicleCategory = "HEAVY_VEHICLE"
	VehicleLMV             VehicleCategory = "LMV"
)

type ClaimCategory string

const (
	ClaimOD    ClaimCategory = "OD"
	ClaimTP    ClaimCategory = "TP"
	ClaimIBNR  ClaimCategory = "IBNR"
	Claim281   ClaimCategory = "281"
	ClaimOther ClaimCategory = "OTHER"
)

type ContactRole string

const (
	ContactInsured        ContactRole = "INSURED"
	ContactOwnerOfVehicle ContactRole = "OWNER_OF_VEHICLE"
	ContactDriverOfVehicle ContactRole = "DRIVER_OF_VEHICLE"
	ContactGarageMechanic ContactRole = "GARAGE_MECHANIC"
	ContactWitness        ContactRole = "WITNESS"
	ContactOther          ContactRole = "OTHER"
)

type CallDisposition string

const (
	DispGeneralNote      CallDisposition = "GENERAL_NOTE"
	DispLineBusy         CallDisposition = "LINE_BUSY"
	DispRingingNoAnswer  CallDisposition = "RINGING_NO_ANSWER"
	DispAskedForCallback CallDisposition = "ASKED_FOR_CALLBACK"
	DispHostileRefused   CallDisposition = "HOSTILE_REFUSED"
	DispCallCompleted    CallDisposition = "CALL_COMPLETED"
)

type RecordingStatus string

const (
	RecordingStreaming  RecordingStatus = "STREAMING"
	RecordingProcessing RecordingStatus = "PROCESSING"
	RecordingReady       RecordingStatus = "READY"
	RecordingFailed     RecordingStatus = "FAILED"
)

type DocumentCategory string

const (
	DocRC                     DocumentCategory = "RC"
	DocDL                     DocumentCategory = "DL"
	DocFIRGDCompromise        DocumentCategory = "FIR_GD_COMPROMISE"
	DocCommercialPermit       DocumentCategory = "COMMERCIAL_PERMIT"
	DocFitnessCertificate     DocumentCategory = "FITNESS_CERTIFICATE"
	DocLoadChallanWeighbridge DocumentCategory = "LOAD_CHALLAN_WEIGHBRIDGE"
	DocGarageEstimate         DocumentCategory = "GARAGE_ESTIMATE"
	DocOtherEvidence          DocumentCategory = "OTHER_EVIDENCE"
)

// JSONMap is a custom type supporting JSONB in PostgreSQL and TEXT in SQLite
type JSONMap map[string]interface{}

func (j JSONMap) Value() (driver.Value, error) {
	if j == nil {
		return "{}", nil
	}
	return json.Marshal(j)
}

func (j *JSONMap) Scan(value interface{}) error {
	if value == nil {
		*j = make(map[string]interface{})
		return nil
	}
	var bytes []byte
	switch v := value.(type) {
	case []byte:
		bytes = v
	case string:
		bytes = []byte(v)
	default:
		return errors.New("cannot scan type into JSONMap")
	}
	if len(bytes) == 0 {
		*j = make(map[string]interface{})
		return nil
	}
	return json.Unmarshal(bytes, j)
}

// Insurer represents an insurance company client (e.g. ICICI Lombard, Bajaj Allianz)
type Insurer struct {
	ID                string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Name              string          `gorm:"type:varchar(255);not null" json:"name"`
	Code              string          `gorm:"type:varchar(64);uniqueIndex;not null" json:"code"`
	ContactEmail      string          `gorm:"type:varchar(255);not null" json:"contact_email"`
	PerMinuteRateINR  decimal.Decimal `gorm:"type:numeric(10,2);default:45.00" json:"per_minute_rate_inr"`
	IsActive          bool            `gorm:"default:true" json:"is_active"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

func (i *Insurer) BeforeCreate(tx *gorm.DB) error {
	if i.ID == "" {
		i.ID = uuid.New().String()
	}
	return nil
}

// User represents an internal investigator/manager/admin or external insurer client
type User struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	InsurerID    *string   `gorm:"type:varchar(64);index" json:"insurer_id,omitempty"`
	Insurer      *Insurer  `gorm:"foreignKey:InsurerID" json:"insurer,omitempty"`
	Email        string    `gorm:"type:varchar(255);uniqueIndex;not null" json:"email"`
	PasswordHash string    `gorm:"type:varchar(255);not null" json:"-"`
	FullName     string    `gorm:"type:varchar(255);not null" json:"full_name"`
	Role         UserRole  `gorm:"type:varchar(32);not null" json:"role"`
	TeamID       *string   `gorm:"type:varchar(64);index" json:"team_id,omitempty"`
	IsActive     bool      `gorm:"default:true" json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return nil
}

// Case represents the central motor claim entity
type Case struct {
	ID                    string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseNumber            string          `gorm:"type:varchar(64);uniqueIndex;not null" json:"case_number"` // e.g. MOT18221241
	InsurerID             string          `gorm:"type:varchar(64);index;not null" json:"insurer_id"`
	Insurer               *Insurer        `gorm:"foreignKey:InsurerID" json:"insurer,omitempty"`
	AssignedAgentID       *string         `gorm:"type:varchar(64);index" json:"assigned_agent_id,omitempty"`
	AssignedAgent         *User           `gorm:"foreignKey:AssignedAgentID" json:"assigned_agent,omitempty"`
	TeamID                *string         `gorm:"type:varchar(64)" json:"team_id,omitempty"`
	Status                CaseStatus      `gorm:"type:varchar(32);index;not null;default:'UNASSIGNED'" json:"status"`
	VehicleClass          VehicleCategory `gorm:"type:varchar(32);not null;default:'LMV'" json:"vehicle_class"`
	ClaimType             ClaimCategory   `gorm:"type:varchar(32);not null;default:'OD'" json:"claim_type"`
	
	// Policy & Vehicle Identifiers
	PolicyNumber          string          `gorm:"type:varchar(128);not null" json:"policy_number"`
	PolicyStartDate       *time.Time      `json:"policy_start_date,omitempty"`
	VehicleRegNumber      string          `gorm:"type:varchar(64);index;not null" json:"vehicle_reg_number"`
	AccusedVehicleNumber  *string         `gorm:"type:varchar(64)" json:"accused_vehicle_number,omitempty"`
	InsuredName           string          `gorm:"type:varchar(255);not null" json:"insured_name"`
	InsuredPrimaryPhone   string          `gorm:"type:varchar(32);not null" json:"insured_primary_phone"`
	VehicleMakeModel      string          `gorm:"type:varchar(255)" json:"vehicle_make_model"`
	ClaimAmount           decimal.Decimal `gorm:"type:numeric(12,2);default:0.00" json:"claim_amount"`

	// Incident Metadata
	State                 string          `gorm:"type:varchar(128);not null" json:"state"`
	District              string          `gorm:"type:varchar(128);not null" json:"district"`
	AccidentDate          *time.Time      `json:"accident_date,omitempty"`
	IntimationDate        *time.Time      `json:"intimation_date,omitempty"`
	CauseOfLoss           string          `gorm:"type:text" json:"cause_of_loss"`
	InsurerTriggerNarrative string        `gorm:"type:text" json:"insurer_trigger_narrative"`

	// Operational Timestamps & Duration Counters
	IsReassigned          bool            `gorm:"default:false" json:"is_reassigned"`
	ReworkCount           int             `gorm:"default:0" json:"rework_count"`
	AssignedAt            *time.Time      `json:"assigned_at,omitempty"`
	SubmittedAt           *time.Time      `json:"submitted_at,omitempty"`
	CompletedAt           *time.Time      `json:"completed_at,omitempty"`
	TotalDurationSeconds  int             `gorm:"default:0;not null" json:"total_duration_seconds"` // integer seconds
	LockedPDFPath         *string         `gorm:"type:varchar(512)" json:"locked_pdf_path,omitempty"`
	VerificationUUID      string          `gorm:"type:varchar(64);uniqueIndex" json:"verification_uuid"`

	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
	DeletedAt             gorm.DeletedAt  `gorm:"index" json:"-"`

	// Associations
	Contacts              []CaseContact   `gorm:"foreignKey:CaseID" json:"contacts,omitempty"`
	Observations          *CaseObservation `gorm:"foreignKey:CaseID" json:"observations,omitempty"`
}

func (c *Case) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	if c.VerificationUUID == "" {
		c.VerificationUUID = uuid.New().String()
	}
	return nil
}

// CaseContact represents a registered contact (insured, driver, owner, mechanic)
type CaseContact struct {
	ID        string      `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID    string      `gorm:"type:varchar(64);index;not null" json:"case_id"`
	Role      ContactRole `gorm:"type:varchar(32);not null" json:"role"`
	FullName  string      `gorm:"type:varchar(255);not null" json:"full_name"`
	Phone     string      `gorm:"type:varchar(32);not null" json:"phone"`
	Address   string      `gorm:"type:text" json:"address,omitempty"`
	IsPrimary bool        `gorm:"default:false" json:"is_primary"`
	CreatedAt time.Time   `json:"created_at"`
}

func (cc *CaseContact) BeforeCreate(tx *gorm.DB) error {
	if cc.ID == "" {
		cc.ID = uuid.New().String()
	}
	return nil
}

// CallLog represents a phone or tele-verification contact attempt with optional Recall Timer
type CallLog struct {
	ID          string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID      string          `gorm:"type:varchar(64);index;not null" json:"case_id"`
	ContactID   *string         `gorm:"type:varchar(64);index" json:"contact_id,omitempty"`
	Contact     *CaseContact    `gorm:"foreignKey:ContactID" json:"contact,omitempty"`
	AgentID     string          `gorm:"type:varchar(64);index;not null" json:"agent_id"`
	Agent       *User           `gorm:"foreignKey:AgentID" json:"agent,omitempty"`
	Disposition CallDisposition `gorm:"type:varchar(32);not null" json:"disposition"`
	Notes       string          `gorm:"type:text" json:"notes"`
	RecallAt    *time.Time      `gorm:"index" json:"recall_at,omitempty"` // UTC
	CreatedAt   time.Time       `json:"created_at"`
}

func (cl *CallLog) BeforeCreate(tx *gorm.DB) error {
	if cl.ID == "" {
		cl.ID = uuid.New().String()
	}
	return nil
}

// Recording represents a tele-verification video/audio session
type Recording struct {
	ID                string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID            string          `gorm:"type:varchar(64);index;not null" json:"case_id"`
	AgentID           string          `gorm:"type:varchar(64);index;not null" json:"agent_id"`
	ContactID         *string         `gorm:"type:varchar(64)" json:"contact_id,omitempty"`
	Status            RecordingStatus `gorm:"type:varchar(32);not null;default:'STREAMING'" json:"status"`
	DurationSeconds   int             `gorm:"default:0;not null" json:"duration_seconds"`
	MasterStoragePath *string         `gorm:"type:varchar(512)" json:"master_storage_path,omitempty"`
	SHA256Checksum    *string         `gorm:"type:varchar(64)" json:"sha256_checksum,omitempty"`
	FileSizeBytes     int64           `gorm:"default:0" json:"file_size_bytes"`
	MimeType          string          `gorm:"type:varchar(64);default:'video/webm'" json:"mime_type"`
	StartedAt         time.Time       `json:"started_at"`
	StoppedAt         *time.Time      `json:"stopped_at,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	Chunks            []RecordingChunk `gorm:"foreignKey:RecordingID" json:"chunks,omitempty"`
}

func (r *Recording) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// RecordingChunk represents a 5-second media slice uploaded from the browser
type RecordingChunk struct {
	ID              string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	RecordingID     string    `gorm:"type:varchar(64);index;not null" json:"recording_id"`
	ChunkIndex      int       `gorm:"not null" json:"chunk_index"`
	StoragePath     string    `gorm:"type:varchar(512);not null" json:"storage_path"`
	DurationSeconds float64   `gorm:"default:5.00" json:"duration_seconds"`
	SizeBytes       int64     `gorm:"not null" json:"size_bytes"`
	CreatedAt       time.Time `json:"created_at"`
}

func (rc *RecordingChunk) BeforeCreate(tx *gorm.DB) error {
	if rc.ID == "" {
		rc.ID = uuid.New().String()
	}
	return nil
}

// CaseDocument stores supplemental evidentiary documents (RC, DL, FIR, Permit)
type CaseDocument struct {
	ID            string           `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID        string           `gorm:"type:varchar(64);index;not null" json:"case_id"`
	UploadedByID  string           `gorm:"type:varchar(64);not null" json:"uploaded_by_id"`
	DocCategory   DocumentCategory `gorm:"type:varchar(32);not null" json:"doc_category"`
	FileName      string           `gorm:"type:varchar(255);not null" json:"file_name"`
	StoragePath   string           `gorm:"type:varchar(512);not null" json:"storage_path"`
	FileSizeBytes int64            `gorm:"not null" json:"file_size_bytes"`
	MimeType      string           `gorm:"type:varchar(128);not null" json:"mime_type"`
	CreatedAt     time.Time        `json:"created_at"`
}

func (cd *CaseDocument) BeforeCreate(tx *gorm.DB) error {
	if cd.ID == "" {
		cd.ID = uuid.New().String()
	}
	return nil
}

// CaseScreenshot stores snapshots captured live during the video call
type CaseScreenshot struct {
	ID                     string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID                 string    `gorm:"type:varchar(64);index;not null" json:"case_id"`
	RecordingID            *string   `gorm:"type:varchar(64);index" json:"recording_id,omitempty"`
	UploadedByID           string    `gorm:"type:varchar(64);not null" json:"uploaded_by_id"`
	StoragePath            string    `gorm:"type:varchar(512);not null" json:"storage_path"`
	TimestampOffsetSeconds int       `gorm:"default:0" json:"timestamp_offset_seconds"`
	Caption                string    `gorm:"type:text" json:"caption"`
	CreatedAt              time.Time `json:"created_at"`
}

func (cs *CaseScreenshot) BeforeCreate(tx *gorm.DB) error {
	if cs.ID == "" {
		cs.ID = uuid.New().String()
	}
	return nil
}

// ObservationTemplate defines dynamic schemas for different vehicle classes
type ObservationTemplate struct {
	ID           string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	VehicleClass VehicleCategory `gorm:"type:varchar(32);not null" json:"vehicle_class"`
	Version      int             `gorm:"not null;default:1" json:"version"`
	FieldsSchema JSONMap         `gorm:"type:text" json:"fields_schema"`
	IsActive     bool            `gorm:"default:true" json:"is_active"`
	CreatedAt    time.Time       `json:"created_at"`
}

func (ot *ObservationTemplate) BeforeCreate(tx *gorm.DB) error {
	if ot.ID == "" {
		ot.ID = uuid.New().String()
	}
	return nil
}

// CaseObservation stores the 10 compulsory fields and closure conclusions
type CaseObservation struct {
	ID               string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID           string          `gorm:"type:varchar(64);uniqueIndex;not null" json:"case_id"`
	VehicleClass     VehicleCategory `gorm:"type:varchar(32);not null" json:"vehicle_class"`
	TemplateVersion  int             `gorm:"default:1" json:"template_version"`
	ObservationsData JSONMap         `gorm:"type:text" json:"observations_data"` // 10 fields + vehicle specifics
	ConclusionData   JSONMap         `gorm:"type:text" json:"conclusion_data"`   // success tagging, repudiation ground, remarks
	SubmittedAt      *time.Time      `json:"submitted_at,omitempty"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

func (co *CaseObservation) BeforeCreate(tx *gorm.DB) error {
	if co.ID == "" {
		co.ID = uuid.New().String()
	}
	return nil
}

// CaseAuditLog tracks state transitions, reassignments, overrides, and rework cycles
type CaseAuditLog struct {
	ID            string    `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID        string    `gorm:"type:varchar(64);index;not null" json:"case_id"`
	ActorID       string    `gorm:"type:varchar(64);not null" json:"actor_id"`
	Actor         *User     `gorm:"foreignKey:ActorID" json:"actor,omitempty"`
	Action        string    `gorm:"type:varchar(64);not null" json:"action"`
	PreviousState JSONMap   `gorm:"type:text" json:"previous_state,omitempty"`
	NewState      JSONMap   `gorm:"type:text" json:"new_state,omitempty"`
	Remarks       string    `gorm:"type:text" json:"remarks,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

func (cal *CaseAuditLog) BeforeCreate(tx *gorm.DB) error {
	if cal.ID == "" {
		cal.ID = uuid.New().String()
	}
	return nil
}

// BillingLedger stores the commercial per-minute calculations
type BillingLedger struct {
	ID                      string          `gorm:"primaryKey;type:varchar(64)" json:"id"`
	CaseID                  string          `gorm:"type:varchar(64);uniqueIndex;not null" json:"case_id"`
	Case                    *Case           `gorm:"foreignKey:CaseID" json:"case,omitempty"`
	InsurerID               string          `gorm:"type:varchar(64);index;not null" json:"insurer_id"`
	Insurer                 *Insurer        `gorm:"foreignKey:InsurerID" json:"insurer,omitempty"`
	RecordingDurationSeconds int             `gorm:"not null" json:"recording_duration_seconds"` // raw seconds
	BillableMinutes         int             `gorm:"not null" json:"billable_minutes"`           // CEIL(duration / 60)
	RatePerMinuteINR        decimal.Decimal `gorm:"type:numeric(10,2);not null" json:"rate_per_minute_inr"`
	BaseFeeINR              decimal.Decimal `gorm:"type:numeric(10,2);not null" json:"base_fee_inr"`
	TotalBilledINR          decimal.Decimal `gorm:"type:numeric(10,2);not null" json:"total_billed_inr"`
	InvoiceReference        string          `gorm:"type:varchar(64)" json:"invoice_reference,omitempty"`
	IsPaid                  bool            `gorm:"default:false" json:"is_paid"`
	CreatedAt               time.Time       `json:"created_at"`
}

func (bl *BillingLedger) BeforeCreate(tx *gorm.DB) error {
	if bl.ID == "" {
		bl.ID = uuid.New().String()
	}
	return nil
}
