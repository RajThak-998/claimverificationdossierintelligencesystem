import React, { useState } from 'react';
import { Shield, CheckCircle2, AlertTriangle, Search, ExternalLink, Download, Clock } from 'lucide-react';
import { api } from '../api/client';

export const PublicVerificationView: React.FC = () => {
  const [uuidInput, setUuidInput] = useState('e3b0c442-98fc-1c14-9afb-fc8996fb9242');
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!uuidInput.trim()) return;

    setLoading(true);
    setError('');
    setVerificationResult(null);
    try {
      const res = await api.verifyDossier(uuidInput.trim());
      setVerificationResult(res);
    } catch (err: any) {
      setError(err.message || 'No certified record found for this cryptographic identifier');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-trust-600 text-white flex items-center justify-center mx-auto shadow-lg shadow-trust-900/30">
          <Shield className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
          Public Cryptographic Evidence Registry
        </h2>
        <p className="text-xs text-slate-500 max-w-lg mx-auto">
          Scan the QR code printed on Page 1 of any certified motor claim dossier or enter the cryptographic UUID to verify authenticity against the tamper-evident ledger.
        </p>
      </div>

      {/* Verification Search Bar */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <form onSubmit={handleVerify} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={uuidInput}
              onChange={(e) => setUuidInput(e.target.value)}
              placeholder="Enter Verification UUID or Case ID (e.g. e3b0c442...)"
              className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-trust-500 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 bg-trust-600 hover:bg-trust-700 text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
          >
            {loading ? 'Verifying...' : 'Verify Authenticity'}
          </button>
        </form>

        {error && (
          <div className="mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Verification Result Card */}
      {verificationResult && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-md space-y-5 animate-in fade-in duration-300">
          {/* Certificate Stamp */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
            <div>
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-extrabold border border-emerald-300 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>CERTIFIED AUTHENTIC & UNTAMPERED</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 font-mono">
                {verificationResult.case_number}
              </h3>
              <p className="text-xs text-slate-500">
                Insurer: <strong className="text-slate-800">{verificationResult.insurer}</strong>
              </p>
            </div>

            <a
              href={verificationResult.certified_pdf_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors self-start sm:self-auto"
            >
              <Download className="w-3.5 h-3.5 text-trust-400" />
              <span>Download Signed Dossier</span>
            </a>
          </div>

          {/* Cryptographic SHA-256 Box */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2 font-mono">
            <div className="text-slate-500 font-sans font-semibold">
              Master Recording Cryptographic SHA-256 Hash:
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-300 text-slate-900 break-all font-bold">
              {verificationResult.sha256_checksum}
            </div>
            <div className="text-[11px] text-slate-400 font-sans flex items-center space-x-1">
              <Clock className="w-3 h-3 text-slate-500" />
              <span>Certified Tele-Verification Duration: {verificationResult.duration_formatted}</span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-400 block text-[10px]">VEHICLE REG</span>
              <span className="font-bold text-slate-900 font-mono">{verificationResult.vehicle_reg_number}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-400 block text-[10px]">INSURED NAME</span>
              <span className="font-semibold text-slate-900">{verificationResult.insured_name}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-400 block text-[10px]">SUCCESS TAGGING</span>
              <span className="font-bold text-trust-700">{verificationResult.success_tagging}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-slate-400 block text-[10px]">REPUDIATION GROUND</span>
              <span className="font-semibold text-slate-800">{verificationResult.ground_of_repudiation}</span>
            </div>
          </div>

          {/* Conclusion */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
            <span className="text-slate-500 font-bold block">Certified Finding Narrative:</span>
            <p className="text-slate-800 font-medium">{verificationResult.conclusion}</p>
          </div>
        </div>
      )}
    </div>
  );
};
