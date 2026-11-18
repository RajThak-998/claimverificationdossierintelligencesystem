import React, { useEffect, useState } from 'react';
import { Shield, FileText, Download, CheckCircle2, Clock, ExternalLink, RefreshCw } from 'lucide-react';
import { api, getCasePDFDownloadUrl } from '../api/client';
import { CaseItem } from '../types';

interface InsurerPortalProps {
  currentUser: any;
  onOpenDossier: (caseId: string) => void;
}

export const InsurerPortal: React.FC<InsurerPortalProps> = ({ currentUser, onOpenDossier }) => {
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resCases, resLedger] = await Promise.all([
        api.getCases({ status: 'COMPLETED' }),
        api.getBillingLedger(),
      ]);
      setCases(resCases.data);
      setLedger(resLedger);
    } catch (err) {
      console.error('Failed to load insurer portal:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Insurer Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 to-trust-950 rounded-2xl p-6 text-white shadow-md border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2 text-trust-400 font-semibold text-xs tracking-wider uppercase mb-1">
              <Shield className="w-4 h-4" />
              <span>Client Insurer Access Portal</span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight">
              {currentUser?.insurer?.name || 'ICICI Lombard General Insurance'}
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              Cryptographically verified claim dossiers, SHA-256 evidence integrity, and monthly billing statements.
            </p>
          </div>

          <button
            onClick={loadData}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Portal</span>
          </button>
        </div>
      </div>

      {/* Verified Claims Grid */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">
            Certified Completed Claim Investigations ({cases.length})
          </h3>
          <span className="text-xs text-slate-400 font-medium">All documents tamper-proof sealed</span>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Case ID</th>
                <th className="px-4 py-3">Vehicle Reg Number</th>
                <th className="px-4 py-3">Insured Party</th>
                <th className="px-4 py-3">Recorded Duration</th>
                <th className="px-4 py-3">Certification</th>
                <th className="px-4 py-3 text-right">Deliverables</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {cases.length > 0 ? (
                cases.map((cs) => (
                  <tr key={cs.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">{cs.case_number}</td>
                    <td className="px-4 py-3 font-mono font-bold text-trust-800">{cs.vehicle_reg_number}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{cs.insured_name}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-700">{cs.duration_formatted}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                        SEALED & CERTIFIED
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <a
                        href={getCasePDFDownloadUrl(cs.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
                      >
                        <Download className="w-3.5 h-3.5 text-trust-400" />
                        <span>Certified Dossier</span>
                      </a>
                      <button
                        onClick={() => onOpenDossier(cs.id)}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs"
                      >
                        <span>View Evidence</span>
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400 text-xs">
                    No completed cases available for release yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Itemized Invoices */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3">
          Monthly Investigation Invoicing Statement
        </h3>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs font-mono">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider font-sans">
              <tr>
                <th className="px-4 py-2.5">Invoice Ref</th>
                <th className="px-4 py-2.5">Claim ID</th>
                <th className="px-4 py-2.5">Vehicle Reg</th>
                <th className="px-4 py-2.5">Tele-Verification</th>
                <th className="px-4 py-2.5">Billable Minutes</th>
                <th className="px-4 py-2.5">Contract Rate</th>
                <th className="px-4 py-2.5 text-right font-sans">Total Billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {ledger.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-bold text-slate-800">{item.invoice_reference}</td>
                  <td className="px-4 py-3 text-trust-700">{item.case_number}</td>
                  <td className="px-4 py-3 font-bold">{item.vehicle_reg_number}</td>
                  <td className="px-4 py-3">{item.duration_formatted}</td>
                  <td className="px-4 py-3 font-bold text-trust-600">{item.billable_minutes}m</td>
                  <td className="px-4 py-3">₹{parseFloat(item.rate_per_minute_inr).toFixed(2)}/m</td>
                  <td className="px-4 py-3 text-right font-extrabold text-slate-900">
                    ₹{parseFloat(item.total_billed_inr).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
