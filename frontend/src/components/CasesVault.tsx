import React, { useEffect, useState } from 'react';
import {
  Truck,
  Car,
  Search,
  Plus,
  Upload,
  FileSpreadsheet,
  Clock,
  Phone,
  AlertCircle,
  Eye,
  RefreshCw,
  UserCheck,
  CheckCircle2,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { CaseItem, VehicleCategory, ClaimCategory, CaseStatus } from '../types';
import { api } from '../api/client';

interface CasesVaultProps {
  currentUser: any;
  onOpenDossier: (caseId: string) => void;
  onOpenAddModal: () => void;
  onOpenImportModal: () => void;
  refreshTrigger: number;
}

export const CasesVault: React.FC<CasesVaultProps> = ({
  currentUser,
  onOpenDossier,
  onOpenAddModal,
  onOpenImportModal,
  refreshTrigger,
}) => {
  const [vehicleClass, setVehicleClass] = useState<VehicleCategory | ''>('');
  const [claimType, setClaimType] = useState<ClaimCategory | ''>('');
  const [statusFilter, setStatusFilter] = useState<CaseStatus | ''>('');
  const [showReassignedOnly, setShowReassignedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [cases, setCases] = useState<CaseItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<any[]>([]);
  const [reassigningId, setReassigningId] = useState<string | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (vehicleClass) params.vehicle_class = vehicleClass;
      if (claimType) params.claim_type = claimType;
      if (statusFilter) params.status = statusFilter;
      if (showReassignedOnly) params.reassigned_only = 'true';
      if (searchQuery) params.search = searchQuery;

      const res = await api.getCases(params);
      setCases(Array.isArray(res.data) ? res.data : []);
      setCounts(res.counts || {});
    } catch (err) {
      console.error('Failed to load cases:', err);
      setCases([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  };

  useEffect(() => {
    fetchCases();
  }, [vehicleClass, claimType, statusFilter, showReassignedOnly, refreshTrigger]);

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCases();
  };

  const handleInlineAssign = async (caseId: string, agentId: string) => {
    try {
      setReassigningId(caseId);
      await api.assignAgent(caseId, agentId, 'Reassigned via main vault grid');
      fetchCases();
      fetchAgents();
    } catch (err: any) {
      alert(`Assignment failed: ${err.message}`);
    } finally {
      setReassigningId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Vehicle Category & Claim Type Switcher */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Vehicle Class Tabs */}
        <div className="flex items-center space-x-2 bg-slate-100 p-1.5 rounded-lg border border-slate-200/60">
          <button
            onClick={() => setVehicleClass('')}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              vehicleClass === '' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Classes
          </button>
          <button
            onClick={() => setVehicleClass('HEAVY_VEHICLE')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              vehicleClass === 'HEAVY_VEHICLE'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            <span>Heavy Commercial Vehicles</span>
          </button>
          <button
            onClick={() => setVehicleClass('LMV')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
              vehicleClass === 'LMV'
                ? 'bg-trust-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Car className="w-3.5 h-3.5" />
            <span>Light Motor Vehicles (LMV)</span>
          </button>
        </div>

        {/* Claim Type Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto text-xs">
          <span className="text-slate-400 font-medium mr-1">Claim Type:</span>
          {(['', 'OD', 'TP', 'IBNR', '281'] as (ClaimCategory | '')[]).map((type) => (
            <button
              key={type || 'ALL'}
              onClick={() => setClaimType(type)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                claimType === type
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {type || 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Status Filters Bar with live counters */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStatusFilter('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              statusFilter === ''
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>All Claims</span>
            <span className="px-1.5 py-0.2 bg-slate-700 text-slate-200 rounded-full text-[10px]">
              {counts.total || 0}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('UNASSIGNED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              statusFilter === 'UNASSIGNED'
                ? 'bg-slate-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span>UNASSIGNED</span>
            <span className="px-1.5 py-0.2 bg-slate-200 text-slate-700 rounded-full text-[10px]">
              {counts.unassigned || 0}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('WORK_IN_PROGRESS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              statusFilter === 'WORK_IN_PROGRESS'
                ? 'bg-trust-600 text-white shadow-sm'
                : 'bg-white text-trust-700 border border-trust-200 hover:bg-trust-50'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>WORK IN PROGRESS</span>
            <span className="px-1.5 py-0.2 bg-trust-100 text-trust-800 rounded-full text-[10px]">
              {counts.work_in_progress || 0}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('REVIEW')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              statusFilter === 'REVIEW'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50'
            }`}
          >
            <AlertCircle className="w-3 h-3" />
            <span>QA REVIEW</span>
            <span className="px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded-full text-[10px]">
              {counts.review || 0}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter('COMPLETED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
              statusFilter === 'COMPLETED'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>COMPLETED</span>
            <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded-full text-[10px]">
              {counts.completed || 0}
            </span>
          </button>
        </div>

        {/* Reassigned Filter Checkbox */}
        <label className="flex items-center space-x-2 text-xs text-slate-600 font-medium cursor-pointer">
          <input
            type="checkbox"
            checked={showReassignedOnly}
            onChange={(e) => setShowReassignedOnly(e.target.checked)}
            className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
          />
          <span>Show Reassigned Only</span>
        </label>
      </div>

      {/* 3. Search and Actions Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search Case ID, Reg No, Insured, Phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-trust-500 focus:border-transparent"
          />
        </form>

        <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
          <a
            href="/api/v1/cases/template/csv"
            download
            className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
            title="Download Bulk Intake CSV Template"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>CSV Template</span>
          </a>

          {(currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER') && (
            <>
              <button
                onClick={onOpenImportModal}
                className="inline-flex items-center space-x-1.5 px-3 py-2 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-trust-600" />
                <span>Import CSV</span>
              </button>

              <button
                onClick={onOpenAddModal}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 text-xs font-semibold bg-trust-600 hover:bg-trust-700 text-white rounded-lg shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Add Case</span>
              </button>
            </>
          )}

          <button
            onClick={fetchCases}
            className="p-2 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
            title="Refresh Grid"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 4. Main Data Grid Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Case Identity</th>
                <th className="px-4 py-3">Insured & Vehicle</th>
                <th className="px-4 py-3">Contacts & Fast Dial</th>
                <th className="px-4 py-3">Class / Investigator</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && cases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-trust-500" />
                    <span>Loading cases vault...</span>
                  </td>
                </tr>
              ) : cases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-slate-400">
                    <div className="max-w-xs mx-auto space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                        <AlertCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-700 text-sm">Nothing to show</p>
                        <p className="text-xs text-slate-400 mt-1">
                          No claims found for this filter combination (Vehicle Class / Status).
                        </p>
                      </div>
                      {(vehicleClass || claimType || statusFilter || showReassignedOnly || searchQuery) && (
                        <button
                          onClick={() => {
                            setVehicleClass('');
                            setClaimType('');
                            setStatusFilter('');
                            setShowReassignedOnly(false);
                            setSearchQuery('');
                          }}
                          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-trust-50 text-trust-700 hover:bg-trust-100 border border-trust-200 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Reset All Filters</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                cases.map((cs) => {
                  const isHeavy = cs.vehicle_class === 'HEAVY_VEHICLE';
                  const agingAlert = cs.aging_days > 10;

                  return (
                    <tr key={cs.id} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. Case Identity */}
                      <td className="px-4 py-3.5 align-top">
                        <div className="font-bold text-slate-900 font-mono tracking-tight flex items-center space-x-1.5">
                          <span>{cs.case_number}</span>
                          {cs.is_reassigned && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 font-bold border border-amber-300">
                              REASSIGNED
                            </span>
                          )}
                          {cs.rework_count > 0 && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-100 text-rose-800 font-bold border border-rose-300">
                              REWORK ({cs.rework_count})
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {cs.district}, {cs.state}
                        </div>
                        <div className="flex items-center space-x-1.5 mt-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              agingAlert
                                ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}
                          >
                            AGING: {cs.aging_days}D
                          </span>
                          {cs.total_duration_seconds > 0 && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300 flex items-center space-x-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{cs.duration_formatted}</span>
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 2. Insured & Vehicle */}
                      <td className="px-4 py-3.5 align-top max-w-xs">
                        <div className="font-semibold text-slate-900">{cs.insured_name}</div>
                        <div className="font-mono text-xs font-bold text-slate-700 mt-0.5">
                          {cs.vehicle_reg_number}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {cs.vehicle_make_model || 'Standard Motor'}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                          Pol: {cs.policy_number}
                        </div>
                        {cs.insurer_trigger_narrative && (
                          <div className="mt-1 text-[11px] text-slate-600 line-clamp-1 italic bg-slate-50 p-1 rounded border border-slate-200/60">
                            "{cs.insurer_trigger_narrative}"
                          </div>
                        )}
                      </td>

                      {/* 3. Contacts & Fast Dial */}
                      <td className="px-4 py-3.5 align-top">
                        <div className="space-y-1">
                          {cs.contacts && cs.contacts.length > 0 ? (
                            cs.contacts.map((contact, idx) => (
                              <div
                                key={idx}
                                className="inline-flex items-center space-x-1.5 px-2 py-0.5 rounded bg-slate-100 hover:bg-trust-50 text-slate-800 text-[11px] font-medium border border-slate-200 cursor-pointer mr-1 mb-1"
                                onClick={() => onOpenDossier(cs.id)}
                                title={`Call ${contact.full_name} (${contact.role})`}
                              >
                                <span className="font-bold text-[10px] text-slate-500">
                                  {contact.role.replace('_OF_VEHICLE', '')}:
                                </span>
                                <span>{contact.phone}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-400 text-xs italic">
                              Primary: {cs.insured_primary_phone}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 4. Class / Investigator */}
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center space-x-1 mb-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isHeavy
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-blue-100 text-blue-900 border border-blue-300'
                            }`}
                          >
                            {isHeavy ? 'HEAVY TRUCK' : 'LMV'}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {cs.claim_type}
                          </span>
                        </div>

                        {/* Agent Assignment Selector */}
                        {currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER' ? (
                          <select
                            value={cs.assigned_agent_id || ''}
                            onChange={(e) => handleInlineAssign(cs.id, e.target.value)}
                            disabled={reassigningId === cs.id}
                            className="w-full text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-800 focus:outline-none focus:ring-1 focus:ring-trust-500"
                          >
                            <option value="">Unassigned</option>
                            {agents.map((ag) => (
                              <option key={ag.id} value={ag.id}>
                                {ag.full_name} ({ag.active_cases_count} active)
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-xs font-medium text-slate-700">
                            {cs.assigned_agent_name}
                          </div>
                        )}
                      </td>

                      {/* 5. Status Badge */}
                      <td className="px-4 py-3.5 align-top">
                        {cs.status === 'UNASSIGNED' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-300">
                            UNASSIGNED
                          </span>
                        )}
                        {cs.status === 'WORK_IN_PROGRESS' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 mr-1.5 animate-pulse"></span>
                            IN PROGRESS
                          </span>
                        )}
                        {cs.status === 'REVIEW' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                            QA REVIEW
                          </span>
                        )}
                        {cs.status === 'ADMIN_SIGN_OFF' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-800 border border-purple-300">
                            ADMIN SIGN-OFF
                          </span>
                        )}
                        {cs.status === 'COMPLETED' && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300">
                            <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" />
                            COMPLETED
                          </span>
                        )}
                      </td>

                      {/* 6. Actions */}
                      <td className="px-4 py-3.5 align-top text-right space-x-1">
                        <button
                          onClick={() => onOpenDossier(cs.id)}
                          className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-trust-600 hover:bg-trust-700 text-white font-semibold text-xs shadow-sm transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Dossier</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
