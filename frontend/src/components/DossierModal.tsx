import React, { useEffect, useState } from 'react';
import {
  X,
  Shield,
  Clock,
  Phone,
  MessageCircle,
  Video,
  FileText,
  Upload,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Send,
  Save,
  Download,
  AlertCircle,
  FileSpreadsheet,
  Check,
  ChevronRight,
  ExternalLink,
  Plus,
  Sparkles,
  Loader2,
  Eye,
  Play,
} from 'lucide-react';
import { FullCaseRecord, ContactRole, CallDisposition, DocumentCategory, CaseScreenshot } from '../types';
import { api, getCasePDFDownloadUrl, downloadCasePDF, getStorageUrl } from '../api/client';

interface DossierModalProps {
  caseId: string;
  currentUser: any;
  onClose: () => void;
  onRefreshList: () => void;
  onStartTeleVerification: (caseId: string, contactId?: string, contactPhone?: string, caseNumber?: string, contactName?: string) => void;
}

export const DossierModal: React.FC<DossierModalProps> = ({
  caseId,
  currentUser,
  onClose,
  onRefreshList,
  onStartTeleVerification,
}) => {
  const [data, setData] = useState<FullCaseRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<number>(1);

  // Form states for Section 6 & 7
  const [observations, setObservations] = useState<Record<string, any>>({});
  const [conclusion, setConclusion] = useState<Record<string, any>>({
    success_tagging: 'Genuine',
    ground_of_repudiation: 'N/A - Claim Recommended Genuine',
    conclusion: '',
    final_remarks: '',
  });

  // Contact modal state
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactRole, setNewContactRole] = useState<ContactRole>('DRIVER_OF_VEHICLE');
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [newContactAddress, setNewContactAddress] = useState('');

  // Call log modal state
  const [showLogCall, setShowLogCall] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [callDisposition, setCallDisposition] = useState<CallDisposition>('LINE_BUSY');
  const [callNotes, setCallNotes] = useState('');
  const [recallPreset, setRecallPreset] = useState<string>('30M');
  const [customRecallAt, setCustomRecallAt] = useState('');

  // Evidence document upload state
  const [docCategory, setDocCategory] = useState<DocumentCategory>('RC');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Fallback recording upload state
  const [showUploadRec, setShowUploadRec] = useState(false);
  const [fallbackDurationSec, setFallbackDurationSec] = useState<number>(120);

  // QA Rejection state
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionRemarks, setRejectionRemarks] = useState('');

  // Status/Validation alerts
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [saving, setSaving] = useState(false);

  // AI Polish state (Section 6: Observations)
  const [improvingAI, setImprovingAI] = useState(false);
  const [aiSuccessMsg, setAiSuccessMsg] = useState('');
  const [aiErrorMsg, setAiErrorMsg] = useState('');

  // AI Polish state (Section 7: Conclusion & Remarks)
  const [improvingConclusionAI, setImprovingConclusionAI] = useState(false);
  const [aiConclusionSuccessMsg, setAiConclusionSuccessMsg] = useState('');
  const [aiConclusionErrorMsg, setAiConclusionErrorMsg] = useState('');

  // PDF Download state
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [pdfDownloadError, setPdfDownloadError] = useState('');

  // Screenshot Preview Lightbox state (View exact screenshot as image)
  const [previewScreenshot, setPreviewScreenshot] = useState<CaseScreenshot | null>(null);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);

  // Video element refs for optional timestamp seeking
  const videoRefs = React.useRef<Record<string, HTMLVideoElement | null>>({});

  const jumpToVideo = (offsetSeconds: number, recordingId?: string) => {
    setActiveSection(3);
    setPreviewScreenshot(null);
    setTimeout(() => {
      let targetVideo: HTMLVideoElement | null = null;
      if (recordingId && videoRefs.current[recordingId]) {
        targetVideo = videoRefs.current[recordingId];
      } else {
        const keys = Object.keys(videoRefs.current);
        for (const k of keys) {
          if (videoRefs.current[k]) {
            targetVideo = videoRefs.current[k];
            break;
          }
        }
      }
      if (targetVideo) {
        targetVideo.currentTime = Math.max(0, offsetSeconds);
        targetVideo.play().catch(() => {});
        targetVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };

  // Close screenshot preview modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewScreenshot) {
        setPreviewScreenshot(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewScreenshot]);

  const handleDownloadPDF = async () => {
    if (!data?.case) return;
    setDownloadingPDF(true);
    setPdfDownloadError('');
    try {
      await downloadCasePDF(caseId, data.case.case_number);
    } catch (err: any) {
      console.error('PDF download error:', err);
      setPdfDownloadError(err?.message || 'Failed to download PDF dossier');
      window.open(getCasePDFDownloadUrl(caseId), '_blank');
    } finally {
      setDownloadingPDF(false);
    }
  };

  const loadCaseRecord = async () => {
    try {
      setLoading(true);
      const res = await api.getCase(caseId);
      setData(res);

      if (res.case?.observations) {
        setObservations(res.case.observations.observations_data || {});
        if (res.case.observations.conclusion_data) {
          setConclusion(res.case.observations.conclusion_data);
        }
      }
    } catch (err) {
      console.error('Failed to load dossier:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCaseRecord();
  }, [caseId]);

  const handleObservationChange = (key: string, value: any) => {
    setObservations((prev) => ({ ...prev, [key]: value }));
  };

  const handleConclusionChange = (key: string, value: any) => {
    setConclusion((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === 'success_tagging') {
        if (value !== 'Repudiated') {
          updated.ground_of_repudiation = 'N/A - Claim Recommended Genuine';
        } else {
          updated.ground_of_repudiation = 'Driver Misrepresentation / Implant';
        }
      }
      return updated;
    });
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setValidationErrors([]);
    setSaveSuccessMsg('');
    try {
      await api.saveObservationDraft(caseId, observations, conclusion);
      setSaveSuccessMsg('Investigation progress saved as draft.');
      setTimeout(() => setSaveSuccessMsg(''), 4000);
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      alert(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImproveWithAI = async () => {
    const fieldsToImprove: Record<string, string> = {};
    const textKeys = [
      'insured_version',
      'driver_version',
      'occupant_cleaner_version',
      'relation_with_insured',
      'kyc_documents',
      'profession_contacted',
      'hospital_injury_remarks',
      'damages_garage_remarks',
      'social_media_news',
      'evidences_remarks',
      'cleaner_statement',
    ];

    for (const key of textKeys) {
      const val = observations[key];
      if (typeof val === 'string' && val.trim().length > 0) {
        fieldsToImprove[key] = val.trim();
      }
    }

    if (Object.keys(fieldsToImprove).length === 0) {
      setAiErrorMsg('Please write notes in at least one observation field before improving with AI.');
      setTimeout(() => setAiErrorMsg(''), 4000);
      return;
    }

    setImprovingAI(true);
    setAiSuccessMsg('');
    setAiErrorMsg('');
    try {
      const res = await api.improveObservationsWithAI(caseId, fieldsToImprove);
      if (res && res.fields) {
        setObservations((prev) => ({
          ...prev,
          ...res.fields,
        }));
        setAiSuccessMsg('Observation notes improved with AI (grammar & presentation refined; facts preserved).');
        setTimeout(() => setAiSuccessMsg(''), 5000);
      }
    } catch (err: any) {
      setAiErrorMsg(`AI improvement error: ${err.message || 'Failed to refine text'}`);
      setTimeout(() => setAiErrorMsg(''), 5000);
    } finally {
      setImprovingAI(false);
    }
  };

  const handleImproveConclusionWithAI = async () => {
    const fieldsToImprove: Record<string, string> = {};
    if (conclusion.conclusion && typeof conclusion.conclusion === 'string' && conclusion.conclusion.trim().length > 0) {
      fieldsToImprove.conclusion = conclusion.conclusion.trim();
    }
    if (conclusion.final_remarks && typeof conclusion.final_remarks === 'string' && conclusion.final_remarks.trim().length > 0) {
      fieldsToImprove.final_remarks = conclusion.final_remarks.trim();
    }

    if (Object.keys(fieldsToImprove).length === 0) {
      setAiConclusionErrorMsg('Please write Conclusion Summary or Final Remarks before improving with AI.');
      setTimeout(() => setAiConclusionErrorMsg(''), 4000);
      return;
    }

    setImprovingConclusionAI(true);
    setAiConclusionSuccessMsg('');
    setAiConclusionErrorMsg('');
    try {
      const res = await api.improveObservationsWithAI(caseId, fieldsToImprove);
      if (res && res.fields) {
        setConclusion((prev) => ({
          ...prev,
          ...(res.fields.conclusion ? { conclusion: res.fields.conclusion } : {}),
          ...(res.fields.final_remarks ? { final_remarks: res.fields.final_remarks } : {}),
        }));
        setAiConclusionSuccessMsg('Conclusion and remarks improved with AI (grammar & presentation refined; facts preserved).');
        setTimeout(() => setAiConclusionSuccessMsg(''), 5000);
      }
    } catch (err: any) {
      setAiConclusionErrorMsg(`AI improvement error: ${err.message || 'Failed to refine text'}`);
      setTimeout(() => setAiConclusionErrorMsg(''), 5000);
    } finally {
      setImprovingConclusionAI(false);
    }
  };

  const handleSubmitAndLock = async () => {
    setSaving(true);
    setValidationErrors([]);
    setSaveSuccessMsg('');
    try {
      await api.submitCaseReport(caseId, observations, conclusion);
      setSaveSuccessMsg('Dossier validated and submitted to QA Review queue!');
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      const msg = err.message || '';
      const lines = msg.split('\n');
      setValidationErrors(lines);
    } finally {
      setSaving(false);
    }
  };

  const handleApproveQA = async () => {
    if (!confirm('Approve QA Review and advance this claim to Admin Commercial Sign-Off?')) return;
    try {
      await api.approveReview(caseId);
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    }
  };

  const handleRejectQA = async () => {
    if (!rejectionRemarks.trim()) {
      alert('Compulsory rejection remarks required');
      return;
    }
    try {
      await api.rejectReview(caseId, rejectionRemarks);
      setShowRejectModal(false);
      setRejectionRemarks('');
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      alert(`Rejection failed: ${err.message}`);
    }
  };

  const handleAdminSignOff = async () => {
    if (!confirm('Execute final commercial sign-off and compile certified tamper-evident PDF dossier?')) return;
    try {
      await api.adminSignOff(caseId);
      alert('Sign-off accepted! Master video hashing, tamper-evident PDF compilation, and billing ledger entry enqueued.');
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      alert(`Sign-off failed: ${err.message}`);
    }
  };

  const handleAddContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContactName || !newContactPhone) {
      alert('Name and phone are required');
      return;
    }
    try {
      await api.addContact(caseId, {
        role: newContactRole,
        full_name: newContactName,
        phone: newContactPhone,
        address: newContactAddress,
      });
      setShowAddContact(false);
      setNewContactName('');
      setNewContactPhone('');
      setNewContactAddress('');
      loadCaseRecord();
    } catch (err: any) {
      alert(`Failed to add contact: ${err.message}`);
    }
  };

  const handleLogCallSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callNotes.trim()) {
      alert('Call notes are required');
      return;
    }

    let recallIso: string | undefined = undefined;
    if (recallPreset !== 'NONE') {
      const now = new Date();
      if (recallPreset === '15M') now.setMinutes(now.getMinutes() + 15);
      else if (recallPreset === '30M') now.setMinutes(now.getMinutes() + 30);
      else if (recallPreset === '1H') now.setHours(now.getHours() + 1);
      else if (recallPreset === '2H') now.setHours(now.getHours() + 2);
      else if (recallPreset === '4H') now.setHours(now.getHours() + 4);
      else if (recallPreset === '1D') now.setDate(now.getDate() + 1);
      else if (recallPreset === 'CUSTOM' && customRecallAt) {
        now.setTime(new Date(customRecallAt).getTime());
      }
      recallIso = now.toISOString();
    }

    try {
      await api.logCall(caseId, {
        contact_id: selectedContactId || undefined,
        disposition: callDisposition,
        notes: callNotes,
        recall_at: recallIso,
      });
      setShowLogCall(false);
      setCallNotes('');
      loadCaseRecord();
    } catch (err: any) {
      alert(`Failed to log call: ${err.message}`);
    }
  };

  const handleDocumentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingDoc(true);
    try {
      await api.uploadDocument(caseId, file, docCategory);
      loadCaseRecord();
    } catch (err: any) {
      alert(`Document upload failed: ${err.message}`);
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleFallbackRecordingUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await api.uploadFallbackRecording(caseId, file, fallbackDurationSec);
      setShowUploadRec(false);
      loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      alert(`Recording upload failed: ${err.message}`);
    }
  };

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingScreenshot(true);
    try {
      const caption = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      await api.uploadScreenshot(caseId, file, 0, caption);
      await loadCaseRecord();
      onRefreshList();
    } catch (err: any) {
      console.error('Screenshot upload error:', err);
      alert(`Screenshot upload failed: ${err.message || 'Unknown error'}`);
    } finally {
      setUploadingScreenshot(false);
      e.target.value = '';
    }
  };

  if (loading && !data) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
          <Clock className="w-10 h-10 animate-spin text-trust-600 mx-auto mb-4" />
          <h3 className="text-base font-bold text-slate-800">Opening Complete Vault Record</h3>
          <p className="text-xs text-slate-500 mt-1">Loading cryptographic dossier and evidence streams...</p>
        </div>
      </div>
    );
  }

  const cs = data?.case;
  if (!cs) return null;

  const isEditable = cs.status === 'WORK_IN_PROGRESS';
  const isHeavy = cs.vehicle_class === 'HEAVY_VEHICLE';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200">
        {/* ========================================================================= */}
        {/* MODAL HEADER */}
        {/* ========================================================================= */}
        <div className="bg-slate-900 text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-trust-600 flex items-center justify-center text-white font-bold shadow-md">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-lg font-extrabold font-mono tracking-tight">{cs.case_number}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    isHeavy ? 'bg-amber-500 text-slate-950' : 'bg-trust-500 text-white'
                  }`}
                >
                  {isHeavy ? 'HEAVY COMMERCIAL TRUCK' : 'LMV PRIVATE CAR'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {cs.claim_type}
                </span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Reg: <span className="text-white font-mono font-bold">{cs.vehicle_reg_number}</span> | Insured:{' '}
                <span className="text-slate-200">{cs.insured_name}</span> | Insurer:{' '}
                <span className="text-trust-300">{cs.insurer_name}</span>
              </div>
            </div>
          </div>

          {/* Header Badges & Actions */}
          <div className="flex items-center space-x-2 flex-wrap sm:flex-nowrap">
            <div className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs flex items-center space-x-1.5">
              <span className="text-slate-400">Aging:</span>
              <span className="font-bold text-white">{cs.aging_days} Days</span>
            </div>

            <div className="px-2.5 py-1 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 text-xs flex items-center space-x-1.5 font-mono">
              <Clock className="w-3.5 h-3.5" />
              <span>{cs.duration_formatted}</span>
            </div>

            <button
              onClick={handleDownloadPDF}
              disabled={downloadingPDF}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50"
              title="Download Certified Dossier PDF"
            >
              {downloadingPDF ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-trust-400" />
              ) : (
                <Download className="w-3.5 h-3.5 text-trust-400" />
              )}
              <span>{downloadingPDF ? 'Compiling PDF...' : 'Certified PDF'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 7-SECTION TAB BAR */}
        {/* ========================================================================= */}
        <div className="bg-slate-100 border-b border-slate-200 px-6 py-2 flex items-center space-x-2 overflow-x-auto text-xs font-semibold">
          {[
            { id: 1, label: '1. Metadata Grid' },
            { id: 2, label: '2. Contacts & Recalls' },
            { id: 3, label: '3. Recordings Vault' },
            { id: 4, label: '4. Evidence Files' },
            { id: 5, label: '5. Screenshots' },
            { id: 6, label: '6. Observation Findings (*)' },
            { id: 7, label: '7. Closure & Sign-Off' },
          ].map((sec) => (
            <button
              key={sec.id}
              onClick={() => setActiveSection(sec.id)}
              className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap ${
                activeSection === sec.id
                  ? 'bg-white text-trust-700 shadow-xs border border-slate-300'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              {sec.label}
            </button>
          ))}
        </div>

        {/* Save / Validation feedback toast */}
        {saveSuccessMsg && (
          <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 px-6 py-2 text-xs flex items-center space-x-2 font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {validationErrors.length > 0 && (
          <div className="bg-rose-50 border-b border-rose-200 text-rose-800 px-6 py-3 text-xs">
            <div className="flex items-center space-x-2 font-bold mb-1">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Mandatory Submission Errors ({validationErrors.length})</span>
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SECTION CONTENT BODY */}
        {/* ========================================================================= */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {/* SECTION 1: FULL CASE DETAILS (METADATA GRID) */}
          {activeSection === 1 && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 mb-4">
                  Case Identification & Commercials
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div>
                    <span className="text-slate-400 block">Case Number:</span>
                    <span className="font-bold text-slate-900 font-mono text-sm">{cs.case_number}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Client Insurer:</span>
                    <span className="font-semibold text-slate-800">{cs.insurer_name}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Claim Estimated Amount:</span>
                    <span className="font-bold text-emerald-700 text-sm">₹{cs.claim_amount?.toLocaleString('en-IN')}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Vehicle Registration:</span>
                    <span className="font-bold font-mono text-slate-800">{cs.vehicle_reg_number}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Policy Number:</span>
                    <span className="font-mono text-slate-800">{cs.policy_number}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Vehicle Make / Model:</span>
                    <span className="font-medium text-slate-800">{cs.vehicle_make_model || 'N/A'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 mb-4">
                  Incident Information & Loss Trigger
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs mb-4">
                  <div>
                    <span className="text-slate-400 block">Accident Date:</span>
                    <span className="font-semibold text-slate-800">{cs.accident_date ? new Date(cs.accident_date).toLocaleDateString('en-IN') : 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Intimation Date:</span>
                    <span className="font-semibold text-slate-800">{cs.intimation_date ? new Date(cs.intimation_date).toLocaleDateString('en-IN') : 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Incident Location:</span>
                    <span className="font-semibold text-slate-800">{cs.district}, {cs.state}</span>
                  </div>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-400 block font-medium mb-1">Cause of Loss:</span>
                    <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-800">
                      {cs.cause_of_loss || 'No specific loss cause specified.'}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-medium mb-1">Insurer Suspicion Narrative / Trigger:</span>
                    <div className="bg-amber-50 p-3 rounded-lg border border-amber-200 text-amber-900 font-medium">
                      ⚠️ {cs.insurer_trigger_narrative || 'Standard tele-verification verification protocol.'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: DOSSIER CONTACTS & ACTIONABLE CALLBACK REMARKS */}
          {activeSection === 2 && (
            <div className="space-y-6">
              {/* Quick Launch Floating Call Widget Banner */}
              <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md border border-slate-700">
                <div className="flex items-center space-x-3.5">
                  <div className="w-10 h-10 rounded-xl bg-rose-600/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                    <Video className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-sm">WhatsApp Call Recorder & Live Frame Grabber</div>
                    <div className="text-xs text-slate-400">
                      Prompts screen share, opens WhatsApp Web, and docks separate <strong>[● REC]</strong> & <strong>[📷 CAPTURE]</strong> buttons.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onStartTeleVerification(cs.id, undefined, cs.insured_primary_phone, cs.case_number, cs.insured_name)}
                  className="px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-500 font-bold text-xs flex items-center space-x-2 text-white shadow-md shadow-emerald-900/40 shrink-0 transition-colors"
                >
                  <Video className="w-4 h-4" />
                  <span>Launch WhatsApp & Recorder</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column: Registered Contacts Directory */}
              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-900">Registered Dossier Contacts</h3>
                    <button
                      onClick={() => setShowAddContact(true)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold bg-trust-50 text-trust-700 hover:bg-trust-100 rounded-lg border border-trust-200 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Contact</span>
                    </button>
                  </div>

                  <div className="space-y-3">
                    {data.case?.contacts && data.case.contacts.length > 0 ? (
                      data.case.contacts.map((c) => (
                        <div
                          key={c.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-trust-300 transition-all flex items-center justify-between"
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-slate-900 text-xs">{c.full_name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700">
                                {c.role}
                              </span>
                              {c.is_primary && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  PRIMARY
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-slate-600 mt-1">{c.phone}</div>
                            {c.address && <div className="text-[11px] text-slate-400 mt-0.5">{c.address}</div>}
                          </div>

                          <div className="flex items-center space-x-1.5">
                            {/* Fast Action: Log Call */}
                            <button
                              onClick={() => {
                                setSelectedContactId(c.id);
                                setShowLogCall(true);
                              }}
                              className="p-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors"
                              title="Log Call Attempt & Remarks"
                            >
                              <Phone className="w-4 h-4" />
                            </button>

                            {/* Core Action: WhatsApp Call & Record */}
                            <button
                              onClick={() => onStartTeleVerification(cs.id, c.id, c.phone, cs.case_number, c.full_name)}
                              className="inline-flex items-center space-x-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors"
                              title="Prompt screen share, open WhatsApp Web with contact, and launch separate floating buttons"
                            >
                              <Video className="w-4 h-4" />
                              <span>WhatsApp Call</span>
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-6 text-slate-400 text-xs">
                        No additional contacts registered.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Call Attempts & Recall Timers */}
              <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Follow-Up Remarks & Recall Timeline</h3>
                  <button
                    onClick={() => {
                      setSelectedContactId('');
                      setShowLogCall(true);
                    }}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Log Remark</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {data.call_logs && data.call_logs.length > 0 ? (
                    data.call_logs.map((log) => (
                      <div key={log.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">
                            {log.disposition.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {new Date(log.created_at).toLocaleTimeString('en-IN')}
                          </span>
                        </div>
                        <p className="text-slate-700">{log.notes}</p>
                        {log.recall_at && (
                          <div className="mt-1 pt-1 border-t border-slate-200 text-amber-700 font-semibold flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-amber-600" />
                            <span>Recall Timer Due: {new Date(log.recall_at).toLocaleString('en-IN')}</span>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-slate-400 text-xs">
                      No call remarks logged yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

          {/* SECTION 3: CASE RECORDINGS VAULT */}
          {activeSection === 3 && (
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Tele-Verification Audio & Screen Recordings</h3>
                  <p className="text-xs text-slate-500">
                    Streamed in 5-second intervals via MediaRecorder and cryptographically verified.
                  </p>
                </div>

                <button
                  onClick={() => setShowUploadRec(true)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Offline File</span>
                </button>
              </div>

              <div className="space-y-3">
                {data.recordings && data.recordings.length > 0 ? (
                  data.recordings.map((rec) => (
                    <div
                      key={rec.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="font-bold text-xs text-slate-900 font-mono">
                              REC-{rec.id.substring(0, 8)}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              {rec.status}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-200 text-slate-800">
                              Duration: {Math.floor(rec.duration_seconds / 60)}M {rec.duration_seconds % 60}S
                            </span>
                          </div>
                          {rec.sha256_checksum && (
                            <div className="text-[11px] text-slate-600 font-mono bg-white px-2 py-1 rounded border border-slate-200 flex items-center space-x-1.5">
                              <span className="text-slate-400 font-bold">SHA-256:</span>
                              <span className="truncate max-w-md">{rec.sha256_checksum}</span>
                            </div>
                          )}
                          <div className="text-[11px] text-slate-400">
                            Started: {new Date(rec.started_at).toLocaleString('en-IN')}
                          </div>
                        </div>

                        {/* Video Player */}
                        {rec.master_storage_path ? (
                          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                            <video
                              ref={(el) => { if (el) videoRefs.current[rec.id] = el; }}
                              controls
                              preload="metadata"
                              className="h-32 w-full sm:w-60 rounded-lg bg-black object-contain shadow-xs border border-slate-800"
                              src={getStorageUrl(rec.master_storage_path)}
                            />
                            <a
                              href={getStorageUrl(rec.master_storage_path)}
                              download
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-300 shadow-2xs"
                              title="Open recording file"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Open</span>
                            </a>
                          </div>
                        ) : (
                          <div className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
                            Processing recording...
                          </div>
                        )}
                      </div>

                      {/* Screenshot Moments (Click to view image) */}
                      {data.screenshots && data.screenshots.length > 0 && (
                        <div className="mt-1 pt-2.5 border-t border-slate-200 flex flex-col gap-1.5">
                          <span className="text-[11px] font-bold text-slate-600 flex items-center space-x-1">
                            <Camera className="w-3 h-3 text-trust-600" />
                            <span>Captured Screenshot Moments (Click to view image):</span>
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {data.screenshots.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => setPreviewScreenshot(s)}
                                className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-white hover:bg-trust-50 border border-slate-200 hover:border-trust-300 text-[11px] font-mono text-slate-700 hover:text-trust-800 font-semibold shadow-2xs transition-colors"
                                title={`View screenshot image: ${s.caption || 'Frame snapshot'}`}
                              >
                                <Eye className="w-3.5 h-3.5 text-trust-600" />
                                <span>+{Math.floor(s.timestamp_offset_seconds / 60)}m {s.timestamp_offset_seconds % 60}s</span>
                                {s.caption && <span className="text-slate-500 font-normal max-w-[140px] truncate">- {s.caption}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-slate-400 text-xs">
                    <Video className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <span>No tele-verification recordings uploaded yet.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 4: MANUAL CASE EVIDENCE DOCUMENTS */}
          {activeSection === 4 && (
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Evidentiary Case Documents</h3>
                  <p className="text-xs text-slate-500">
                    Upload Registration Certificate (RC), Driving License (DL), FIR/GD, Weighbridge, Garage Estimates.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <select
                    value={docCategory}
                    onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
                    className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-700"
                  >
                    <option value="RC">RC (Registration Certificate)</option>
                    <option value="DL">DL (Driver License)</option>
                    <option value="FIR_GD_COMPROMISE">FIR / GD / Compromise</option>
                    <option value="COMMERCIAL_PERMIT">Commercial Permit & Fitness</option>
                    <option value="LOAD_CHALLAN_WEIGHBRIDGE">Weighbridge / Load Slip</option>
                    <option value="GARAGE_ESTIMATE">Garage Estimate & Photos</option>
                    <option value="OTHER_EVIDENCE">Other Evidence</option>
                  </select>

                  <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-trust-600 hover:bg-trust-700 text-white rounded-lg shadow-sm transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingDoc ? 'Uploading...' : 'Upload File'}</span>
                    <input type="file" onChange={handleDocumentUpload} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {data.documents && data.documents.length > 0 ? (
                  data.documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2.5 truncate">
                        <FileText className="w-5 h-5 text-trust-600 shrink-0" />
                        <div className="truncate text-xs">
                          <div className="font-bold text-slate-800 truncate">{doc.file_name}</div>
                          <div className="text-[10px] text-slate-400 font-semibold">{doc.doc_category}</div>
                        </div>
                      </div>

                      <a
                        href={getStorageUrl(doc.storage_path)}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-slate-400 hover:text-slate-800 rounded hover:bg-slate-100"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                  ))
                ) : (
                  <div className="col-span-3 text-center py-10 text-slate-400 text-xs">
                    No documents uploaded yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 5: LIVE VIDEO SCREENSHOTS VAULT */}
          {activeSection === 5 && (
            <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Call Screenshots & Frame Gallery</h3>
                  <p className="text-xs text-slate-500">
                    Snapshots captured live during video interrogation (odometer, vehicle bumper, driver face). Click any screenshot to view full image.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <label className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-trust-50 hover:bg-trust-100 text-trust-700 rounded-lg border border-trust-200 transition-colors">
                    <Upload className="w-3.5 h-3.5 text-trust-600" />
                    <span>{uploadingScreenshot ? 'Uploading...' : 'Upload Screenshot'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleScreenshotUpload}
                      disabled={uploadingScreenshot}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {data.screenshots && data.screenshots.length > 0 ? (
                  data.screenshots.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50 group hover:shadow-md transition-shadow flex flex-col justify-between"
                    >
                      {/* Image Thumbnail: Click opens image preview modal */}
                      <div
                        onClick={() => setPreviewScreenshot(s)}
                        className="aspect-video bg-slate-900 overflow-hidden relative cursor-pointer"
                        title="Click to view full screenshot image"
                      >
                        <img
                          src={getStorageUrl(s.storage_path)}
                          alt={s.caption || 'Call Screenshot'}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        {/* Hover Overlay with View Image badge */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-1.5 text-white text-xs font-semibold">
                          <Eye className="w-4 h-4" />
                          <span>View Image</span>
                        </div>

                        {/* Timestamp badge */}
                        <div className="absolute bottom-1 right-1 bg-black/75 text-white font-mono text-[9px] px-1.5 py-0.5 rounded flex items-center space-x-1">
                          <Camera className="w-2.5 h-2.5 text-trust-300" />
                          <span>+{Math.floor(s.timestamp_offset_seconds / 60)}m {s.timestamp_offset_seconds % 60}s</span>
                        </div>
                      </div>

                      {/* Card Caption & Action Bar */}
                      <div className="p-2.5 text-xs text-slate-700 flex flex-col gap-2">
                        <p className="line-clamp-1 font-medium text-slate-900" title={s.caption || 'Video frame snapshot'}>
                          {s.caption || 'Video frame snapshot'}
                        </p>

                        <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-200/70">
                          {/* Primary: View Image */}
                          <button
                            type="button"
                            onClick={() => setPreviewScreenshot(s)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 text-[11px] font-semibold text-trust-700 hover:text-trust-900 bg-trust-50 hover:bg-trust-100 rounded-md transition-colors"
                            title="Open full-resolution image preview"
                          >
                            <Eye className="w-3.5 h-3.5 text-trust-600" />
                            <span>View Image</span>
                          </button>

                          {/* Secondary: Seek Video (optional) */}
                          {data.recordings && data.recordings.length > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                jumpToVideo(s.timestamp_offset_seconds, s.recording_id);
                              }}
                              className="inline-flex items-center space-x-1 px-2 py-1 text-[10px] font-medium text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-md transition-colors"
                              title="Scrub video player to this timestamp in Recordings section"
                            >
                              <Play className="w-2.5 h-2.5" />
                              <span>Seek Video</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="col-span-4 text-center py-10 text-slate-400 text-xs">
                    <Camera className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <span>No live call snapshots captured yet.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 6: MANDATORY OBSERVATION FINDINGS (*) */}
          {activeSection === 6 && (
            <div className="space-y-6">
              {/* Header Observation Pills Bar */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-2">
                  QA Header Observation Checklist
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 text-center text-[10px] font-bold">
                  <div className="p-1.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    OBS DL Status: OK
                  </div>
                  <div className="p-1.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                    OBS Call: Recorded
                  </div>
                  <div className="p-1.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    OBS WhatsApp: Photos
                  </div>
                  <div className="p-1.5 rounded bg-purple-50 text-purple-800 border border-purple-200">
                    Google Timeline: Matched
                  </div>
                  <div className="p-1.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    OBS RC: Valid
                  </div>
                  <div className="p-1.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    Policy: In-Force
                  </div>
                  <div className="p-1.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                    GD Entry: Verified
                  </div>
                </div>
              </div>

              {/* The 10 Compulsory Fields Form */}
              <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">
                    Structured 10 Mandatory Investigation Fields (*)
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    Validated prior to QA Review submission
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      1. Insured Version *
                    </label>
                    <textarea
                      rows={3}
                      disabled={!isEditable}
                      value={observations.insured_version || ''}
                      onChange={(e) => handleObservationChange('insured_version', e.target.value)}
                      placeholder="Owner statement regarding trip dispatch, key custody..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      2. Driver Version *
                    </label>
                    <textarea
                      rows={3}
                      disabled={!isEditable}
                      value={observations.driver_version || ''}
                      onChange={(e) => handleObservationChange('driver_version', e.target.value)}
                      placeholder="Driver's statement on road condition, speed, collision cause..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      3. Pillion Rider / Cleaner Version *
                    </label>
                    <textarea
                      rows={2}
                      disabled={!isEditable}
                      value={observations.occupant_cleaner_version || ''}
                      onChange={(e) => handleObservationChange('occupant_cleaner_version', e.target.value)}
                      placeholder="Statement of cleaner/helper or vehicle occupants..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      4. Relation with Insured / Driver *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.relation_with_insured || ''}
                      onChange={(e) => handleObservationChange('relation_with_insured', e.target.value)}
                      placeholder="Salaried driver, relative, self-driven..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      5. KYC Documents of All Contacted *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.kyc_documents || ''}
                      onChange={(e) => handleObservationChange('kyc_documents', e.target.value)}
                      placeholder="Aadhaar, Commercial Badge DL verified..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      6. Profession of Contacted Parties *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.profession_contacted || ''}
                      onChange={(e) => handleObservationChange('profession_contacted', e.target.value)}
                      placeholder="Inter-state transport driver, fleet manager..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      7. Hospital / Injury Remarks *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.hospital_injury_remarks || ''}
                      onChange={(e) => handleObservationChange('hospital_injury_remarks', e.target.value)}
                      placeholder="MLC register check, local dispensary..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      8. Damages & Garage Remarks *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.damages_garage_remarks || ''}
                      onChange={(e) => handleObservationChange('damages_garage_remarks', e.target.value)}
                      placeholder="Cabin crush, bumper damage vs old paint scratches..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      9. Social Media / News Verification *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.social_media_news || ''}
                      onChange={(e) => handleObservationChange('social_media_news', e.target.value)}
                      placeholder="Highway police bulletin, local newspaper news..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      10. Supplemental Evidences Remarks *
                    </label>
                    <input
                      type="text"
                      disabled={!isEditable}
                      value={observations.evidences_remarks || ''}
                      onChange={(e) => handleObservationChange('evidences_remarks', e.target.value)}
                      placeholder="Fastag toll log timestamp, GPS telematics..."
                      className="w-full p-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-trust-500 bg-slate-50 focus:bg-white text-xs"
                    />
                  </div>

                  {/* Heavy Vehicle Specific Fields */}
                  {isHeavy && (
                    <>
                      <div>
                        <label className="block font-bold text-amber-800 mb-1">
                          Heavy Vehicle: Cleaner Statement *
                        </label>
                        <input
                          type="text"
                          disabled={!isEditable}
                          value={observations.cleaner_statement || ''}
                          onChange={(e) => handleObservationChange('cleaner_statement', e.target.value)}
                          placeholder="Statement on gross vehicle loading and driver state..."
                          className="w-full p-2.5 rounded-lg border border-amber-300 focus:ring-2 focus:ring-amber-500 bg-amber-50/50 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-amber-800 mb-1">
                          Heavy Vehicle: Permit Validity State *
                        </label>
                        <select
                          disabled={!isEditable}
                          value={observations.permit_validity_state || 'VALID'}
                          onChange={(e) => handleObservationChange('permit_validity_state', e.target.value)}
                          className="w-full p-2.5 rounded-lg border border-amber-300 bg-amber-50/50 text-xs"
                        >
                          <option value="VALID">VALID (National / State Permit Active)</option>
                          <option value="EXPIRED">EXPIRED (Permit Lapsed at Loss Time)</option>
                          <option value="NO_PERMIT">NO PERMIT (Operating without permit)</option>
                          <option value="UNAUTHORIZED_ROUTE">UNAUTHORIZED ROUTE (Breach of permit zone)</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Bottom Action Bar for Section 6 */}
              <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                {/* Bottom Left: Improve with AI (Only for AGENT role) */}
                <div className="flex items-center space-x-3">
                  {currentUser?.role === 'AGENT' && (
                    <button
                      type="button"
                      onClick={handleImproveWithAI}
                      disabled={improvingAI || !isEditable}
                      title="Refines grammar, phrasing and presentation into professional insurance English while strictly preserving meaning and facts"
                      className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg border border-purple-200 bg-linear-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 text-purple-900 text-xs font-bold transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group cursor-pointer"
                    >
                      {improvingAI ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                          <span>Improving with AI...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
                          <span>Improve with AI</span>
                        </>
                      )}
                    </button>
                  )}

                  {aiSuccessMsg && (
                    <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{aiSuccessMsg}</span>
                    </div>
                  )}

                  {aiErrorMsg && (
                    <div className="flex items-center space-x-1.5 text-xs text-rose-700 font-medium bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>{aiErrorMsg}</span>
                    </div>
                  )}
                </div>

                {/* Bottom Right: Quick Save Draft & Next Button */}
                {isEditable && (
                  <div className="flex items-center space-x-2 ml-auto">
                    <button
                      type="button"
                      onClick={handleSaveDraft}
                      disabled={saving}
                      className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors"
                    >
                      <Save className="w-4 h-4 text-slate-500" />
                      <span>{saving ? 'Saving...' : 'Save Draft'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveSection(7)}
                      className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold transition-colors"
                    >
                      <span>Proceed to Conclusion</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 7: FINAL CONCLUSION & CLOSURE */}
          {activeSection === 7 && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs space-y-4 text-xs">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
                  Investigation Finding & Cascading Repudiation Taxonomy
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Success Tagging */}
                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      Success Tagging *
                    </label>
                    <select
                      disabled={!isEditable}
                      value={conclusion.success_tagging || 'Genuine'}
                      onChange={(e) => handleConclusionChange('success_tagging', e.target.value)}
                      className="w-full p-2.5 rounded-lg border border-slate-300 bg-slate-50 font-semibold"
                    >
                      <option value="Genuine">Genuine (Recommended for Payment)</option>
                      <option value="Repudiated">Repudiated (Fraud / Breach Detected)</option>
                      <option value="Compromised">Compromised Settlement</option>
                      <option value="Claim Withdrawn">Claim Withdrawn by Insured</option>
                    </select>
                  </div>

                  {/* Ground of Repudiation (Cascading) */}
                  <div>
                    <label className="block font-bold text-slate-800 mb-1">
                      Ground of Repudiation *
                    </label>
                    {conclusion.success_tagging === 'Repudiated' ? (
                      <select
                        disabled={!isEditable}
                        value={conclusion.ground_of_repudiation || ''}
                        onChange={(e) => handleConclusionChange('ground_of_repudiation', e.target.value)}
                        className="w-full p-2.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 font-semibold"
                      >
                        <option value="Driver Misrepresentation / Implant">
                          Misrepresentation of Driver / Driver Implant
                        </option>
                        <option value="Pre-Existing / Old / Manipulated Damages">
                          Pre-Existing / Old / Manipulated Damages
                        </option>
                        <option value="Invalid / Expired Commercial Permit or Fitness">
                          Invalid / Expired Commercial Permit or Fitness
                        </option>
                        <option value="Gross Overloading / Carrying Passengers in Goods Truck">
                          Gross Overloading / Carrying Passengers
                        </option>
                        <option value="Intoxication / Drunk and Driving Violation">
                          Intoxication / Drunk & Driving Violation
                        </option>
                        <option value="Staged Incident / Fraudulent Collusion">
                          Staged Incident / Fraudulent Collusion
                        </option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        disabled
                        value="N/A - Claim Recommended Genuine"
                        className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 font-medium"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    Conclusion Summary *
                  </label>
                  <input
                    type="text"
                    disabled={!isEditable}
                    value={conclusion.conclusion || ''}
                    onChange={(e) => handleConclusionChange('conclusion', e.target.value)}
                    placeholder="Short decisive summary (e.g. Driver verified; damages genuine)..."
                    className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    Final Detailed Remarks *
                  </label>
                  <textarea
                    rows={4}
                    disabled={!isEditable}
                    value={conclusion.final_remarks || ''}
                    onChange={(e) => handleConclusionChange('final_remarks', e.target.value)}
                    placeholder="Comprehensive investigative summary for claim committee review..."
                    className="w-full p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                  />
                </div>
              </div>

              {/* Execution Action Bar for Agent */}
              {isEditable && (
                <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  {/* Bottom Left: Improve with AI (Only for AGENT role) */}
                  <div className="flex items-center space-x-3">
                    {currentUser?.role === 'AGENT' && (
                      <button
                        type="button"
                        onClick={handleImproveConclusionWithAI}
                        disabled={improvingConclusionAI || !isEditable}
                        title="Refines grammar, phrasing and presentation of conclusion and remarks into professional insurance English while strictly preserving meaning and facts"
                        className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-lg border border-purple-200 bg-linear-to-r from-purple-50 to-indigo-50 hover:from-purple-100 hover:to-indigo-100 text-purple-900 text-xs font-bold transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed group cursor-pointer"
                      >
                        {improvingConclusionAI ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                            <span>Improving with AI...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
                            <span>Improve with AI</span>
                          </>
                        )}
                      </button>
                    )}

                    {aiConclusionSuccessMsg && (
                      <div className="flex items-center space-x-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{aiConclusionSuccessMsg}</span>
                      </div>
                    )}

                    {aiConclusionErrorMsg && (
                      <div className="flex items-center space-x-1.5 text-xs text-rose-700 font-medium bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <span>{aiConclusionErrorMsg}</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom Right: Save as Draft & Submit Report and Lock */}
                  <div className="flex items-center space-x-3 ml-auto">
                    <button
                      onClick={handleSaveDraft}
                      disabled={saving}
                      className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-colors"
                    >
                      <Save className="w-4 h-4 text-slate-500" />
                      <span>{saving ? 'Saving...' : 'Save as Draft'}</span>
                    </button>

                    <button
                      onClick={handleSubmitAndLock}
                      disabled={saving}
                      className="inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-700 text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      <span>Submit Report & Lock Case</span>
                    </button>
                  </div>
                </div>
              )}

              {/* QA Manager Review Decisions */}
              {cs.status === 'REVIEW' && (currentUser?.role === 'MANAGER' || currentUser?.role === 'ADMIN') && (
                <div className="bg-amber-50 rounded-xl p-5 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-amber-900 flex items-center space-x-1.5">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      <span>QA Review Stage - Manager Audit Queue</span>
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Audit all 10 observation fields and tele-verification recordings before advancing.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setShowRejectModal(true)}
                      className="px-4 py-2 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors"
                    >
                      Reject to WIP (Rework)
                    </button>
                    <button
                      onClick={handleApproveQA}
                      className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-colors"
                    >
                      Approve QA Review
                    </button>
                  </div>
                </div>
              )}

              {/* Admin Sign-Off Stage */}
              {cs.status === 'ADMIN_SIGN_OFF' && currentUser?.role === 'ADMIN' && (
                <div className="bg-purple-50 rounded-xl p-5 border border-purple-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-purple-900 flex items-center space-x-1.5">
                      <Shield className="w-4 h-4 text-purple-600" />
                      <span>Admin Commercial Verification & Final Sign-Off</span>
                    </h4>
                    <p className="text-xs text-purple-800 mt-0.5">
                      Validated recorded duration: <strong>{cs.duration_formatted}</strong>. Apply final financial release.
                    </p>
                  </div>

                  <button
                    onClick={handleAdminSignOff}
                    className="px-6 py-2.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-sm transition-colors"
                  >
                    Execute Commercial Sign-Off & Lock Vault
                  </button>
                </div>
              )}

              {/* Completed & Legally Sealed Banner */}
              {cs.status === 'COMPLETED' && (
                <div className="bg-emerald-50 rounded-xl p-5 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-emerald-900 flex items-center space-x-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Investigation Completed & Cryptographically Sealed</span>
                    </h4>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      Certified PDF dossier is generated with SHA-256 seal and QR code verification link.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleDownloadPDF}
                      disabled={downloadingPDF}
                      className="inline-flex items-center space-x-1.5 px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-sm transition-colors disabled:opacity-50"
                    >
                      {downloadingPDF ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                      ) : (
                        <Download className="w-4 h-4 text-emerald-200" />
                      )}
                      <span>{downloadingPDF ? 'Generating Dossier...' : 'Download Certified Dossier (PDF)'}</span>
                    </button>
                    <a
                      href={getCasePDFDownloadUrl(cs.id, true)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1 px-3 py-2.5 rounded-lg bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold transition-colors"
                      title="View PDF in new browser tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>View</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* MODAL FOOTER */}
        {/* ========================================================================= */}
        <div className="bg-white border-t border-slate-200 px-6 py-3 flex items-center justify-between text-xs text-slate-500">
          <div>
            Case Status: <span className="font-bold text-slate-800">{cs.status}</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setActiveSection((p) => Math.max(1, p - 1))}
              disabled={activeSection === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setActiveSection((p) => Math.min(7, p + 1))}
              disabled={activeSection === 7}
              className="px-3 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-40"
            >
              Next Section
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Modal: Add Contact */}
      {showAddContact && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddContactSubmit}
            className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 text-xs shadow-xl"
          >
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2">Register Additional Contact</h3>
            <div>
              <label className="block font-semibold mb-1">Contact Role</label>
              <select
                value={newContactRole}
                onChange={(e) => setNewContactRole(e.target.value as ContactRole)}
                className="w-full p-2 border rounded"
              >
                <option value="OWNER_OF_VEHICLE">Owner of Vehicle</option>
                <option value="DRIVER_OF_VEHICLE">Driver of Vehicle</option>
                <option value="GARAGE_MECHANIC">Garage Mechanic / Surveyor</option>
                <option value="WITNESS">Eyewitness</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Full Name</label>
              <input
                type="text"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                required
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Phone Number</label>
              <input
                type="tel"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                required
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Address / Note</label>
              <input
                type="text"
                value={newContactAddress}
                onChange={(e) => setNewContactAddress(e.target.value)}
                className="w-full p-2 border rounded"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowAddContact(false)}
                className="px-3 py-1.5 border rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-trust-600 text-white font-bold rounded"
              >
                Save Contact
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sub-Modal: Log Call & Recall Timer */}
      {showLogCall && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleLogCallSubmit}
            className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 text-xs shadow-xl"
          >
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2">Log Call Disposition & Recall Timer</h3>
            <div>
              <label className="block font-semibold mb-1">Disposition</label>
              <select
                value={callDisposition}
                onChange={(e) => setCallDisposition(e.target.value as CallDisposition)}
                className="w-full p-2 border rounded"
              >
                <option value="GENERAL_NOTE">General Observation Note</option>
                <option value="LINE_BUSY">Line Busy (Switched Off / Engaged)</option>
                <option value="RINGING_NO_ANSWER">Ringing No Answer</option>
                <option value="ASKED_FOR_CALLBACK">Asked for Callback</option>
                <option value="HOSTILE_REFUSED">Hostile / Claim Refused</option>
                <option value="CALL_COMPLETED">Call Completed</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Investigator Call Notes</label>
              <textarea
                rows={3}
                value={callNotes}
                onChange={(e) => setCallNotes(e.target.value)}
                required
                placeholder="Log conversation remarks or why the line was busy..."
                className="w-full p-2 border rounded"
              />
            </div>

            {/* Recall Timer Presets */}
            <div>
              <label className="block font-semibold mb-1 text-slate-700">Configure Recall Alarm Timer</label>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {['NONE', '15M', '30M', '1H', '2H', '4H', '1D', 'CUSTOM'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setRecallPreset(preset)}
                    className={`py-1 rounded font-bold text-[10px] ${
                      recallPreset === preset
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              {recallPreset === 'CUSTOM' && (
                <input
                  type="datetime-local"
                  value={customRecallAt}
                  onChange={(e) => setCustomRecallAt(e.target.value)}
                  className="w-full p-1.5 border rounded text-xs"
                />
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                type="button"
                onClick={() => setShowLogCall(false)}
                className="px-3 py-1.5 border rounded"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-trust-600 text-white font-bold rounded"
              >
                Save Call Log
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sub-Modal: QA Rejection with Mandatory Remarks */}
      {showRejectModal && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 text-xs shadow-xl">
            <h3 className="font-bold text-sm text-rose-800 border-b pb-2 flex items-center space-x-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Reject Dossier to WIP (Rework Cycle)</span>
            </h3>
            <p className="text-slate-600">
              Provide specific deficiency instructions for the investigator (e.g. "Driver license photocopy is blurry").
            </p>
            <textarea
              rows={4}
              value={rejectionRemarks}
              onChange={(e) => setRejectionRemarks(e.target.value)}
              placeholder="Enter compulsory QA rejection remarks..."
              className="w-full p-2.5 border border-rose-300 rounded-lg focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-3 py-1.5 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleRejectQA}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded"
              >
                Confirm Rejection & Revert to WIP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Modal: Upload Offline Fallback Recording */}
      {showUploadRec && (
        <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-3 text-xs shadow-xl">
            <h3 className="font-bold text-sm text-slate-900 border-b pb-2">Upload Offline Recording File</h3>
            <div>
              <label className="block font-semibold mb-1">Duration (Seconds)</label>
              <input
                type="number"
                value={fallbackDurationSec}
                onChange={(e) => setFallbackDurationSec(parseInt(e.target.value) || 0)}
                className="w-full p-2 border rounded"
              />
              <span className="text-[10px] text-slate-400">
                (~{Math.floor(fallbackDurationSec / 60)} minutes billable)
              </span>
            </div>
            <div>
              <label className="block font-semibold mb-1">Select Audio / Video File (.webm, .mp4, .m4a)</label>
              <input type="file" accept="video/*,audio/*" onChange={handleFallbackRecordingUpload} />
            </div>
            <div className="flex justify-end pt-2 border-t">
              <button
                onClick={() => setShowUploadRec(false)}
                className="px-3 py-1.5 border rounded"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Sub-Modal: Full High-Resolution Screenshot Viewer */}
      {previewScreenshot && (
        <div
          className="fixed inset-0 z-70 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
          onClick={() => setPreviewScreenshot(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-slate-800/90 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-trust-600/30 border border-trust-500/40 flex items-center justify-center text-trust-400 shrink-0">
                  <Camera className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span className="truncate max-w-md">{previewScreenshot.caption || 'Tele-Verification Screenshot Frame'}</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-trust-900/80 text-trust-300 border border-trust-700/60 shrink-0">
                      +{Math.floor(previewScreenshot.timestamp_offset_seconds / 60)}m {previewScreenshot.timestamp_offset_seconds % 60}s
                    </span>
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Captured: {new Date(previewScreenshot.created_at).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <a
                  href={getStorageUrl(previewScreenshot.storage_path)}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Open image in full size in new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
                <button
                  onClick={() => setPreviewScreenshot(null)}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Close screenshot viewer (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Image Body */}
            <div className="flex-1 bg-black/95 p-3 sm:p-6 flex items-center justify-center overflow-auto min-h-[320px]">
              <img
                src={getStorageUrl(previewScreenshot.storage_path)}
                alt={previewScreenshot.caption || 'Call Screenshot'}
                className="max-h-[65vh] max-w-full object-contain rounded-lg shadow-lg border border-slate-800"
              />
            </div>

            {/* Modal Footer Controls */}
            <div className="px-5 py-3 bg-slate-800 border-t border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="text-slate-400 font-mono text-[11px] truncate max-w-md">
                Path: <span className="text-slate-300">{previewScreenshot.storage_path}</span>
              </div>

              <div className="flex items-center space-x-2.5">
                {/* Secondary Action: Jump to video if recordings exist */}
                {data.recordings && data.recordings.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      jumpToVideo(previewScreenshot.timestamp_offset_seconds, previewScreenshot.recording_id);
                    }}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium transition-colors"
                    title="Play recorded tele-verification session from this timestamp"
                  >
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>
                      Play Video at {Math.floor(previewScreenshot.timestamp_offset_seconds / 60)}:{(previewScreenshot.timestamp_offset_seconds % 60).toString().padStart(2, '0')}
                    </span>
                  </button>
                )}

                <a
                  href={getStorageUrl(previewScreenshot.storage_path)}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white font-medium transition-colors"
                  title="Download screenshot image"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Image</span>
                </a>

                <button
                  type="button"
                  onClick={() => setPreviewScreenshot(null)}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
