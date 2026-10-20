import React, { useEffect, useState } from 'react';
import { X, Plus, Shield } from 'lucide-react';
import { VehicleCategory, ClaimCategory } from '../types';
import { api } from '../api/client';

interface AddCaseModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const AddCaseModal: React.FC<AddCaseModalProps> = ({ onClose, onSuccess }) => {
  const [insurers, setInsurers] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const [insurerId, setInsurerId] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleCategory>('LMV');
  const [claimType, setClaimType] = useState<ClaimCategory>('OD');
  const [vehicleRegNumber, setVehicleRegNumber] = useState('');
  const [insuredName, setInsuredName] = useState('');
  const [insuredPrimaryPhone, setInsuredPrimaryPhone] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [vehicleMakeModel, setVehicleMakeModel] = useState('');
  const [claimAmount, setClaimAmount] = useState<number>(50000);
  const [state, setState] = useState('Maharashtra');
  const [district, setDistrict] = useState('Pune');
  const [causeOfLoss, setCauseOfLoss] = useState('');
  const [triggerNarrative, setTriggerNarrative] = useState('');

  useEffect(() => {
    async function loadDropdowns() {
      try {
        const [insList, agList] = await Promise.all([api.getInsurers(), api.getAgents()]);
        setInsurers(insList);
        if (insList.length > 0) setInsurerId(insList[0].id);
        setAgents(agList);
      } catch (err) {
        console.error('Failed to load dropdowns:', err);
      }
    }
    loadDropdowns();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicleRegNumber || !insuredName || !insuredPrimaryPhone) {
      alert('Vehicle registration, insured name, and phone are mandatory');
      return;
    }

    setLoading(true);
    try {
      await api.createCase({
        insurer_id: insurerId,
        assigned_agent_id: assignedAgentId || undefined,
        vehicle_class: vehicleClass,
        claim_type: claimType,
        vehicle_reg_number: vehicleRegNumber,
        insured_name: insuredName,
        insured_primary_phone: insuredPrimaryPhone,
        policy_number: policyNumber || `POL-${Math.floor(100000 + Math.random() * 900000)}`,
        vehicle_make_model: vehicleMakeModel,
        claim_amount: claimAmount,
        state,
        district,
        cause_of_loss: causeOfLoss,
        insurer_trigger_narrative: triggerNarrative,
      });

      onSuccess();
    } catch (err: any) {
      alert(`Creation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-trust-600 text-white flex items-center justify-center font-bold">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Add New Insurance Claim</h3>
              <p className="text-xs text-slate-400">Manual Claim Intake & Triage Form</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Insurer Client *</label>
              <select
                value={insurerId}
                onChange={(e) => setInsurerId(e.target.value)}
                className="w-full p-2 border rounded-lg bg-slate-50 text-xs"
                required
              >
                {insurers.map((ins) => (
                  <option key={ins.id} value={ins.id}>
                    {ins.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Assign Investigator</label>
              <select
                value={assignedAgentId}
                onChange={(e) => setAssignedAgentId(e.target.value)}
                className="w-full p-2 border rounded-lg bg-slate-50 text-xs"
              >
                <option value="">Leave Unassigned</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.full_name} ({ag.active_cases_count} active)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Vehicle Classification *</label>
              <select
                value={vehicleClass}
                onChange={(e) => setVehicleClass(e.target.value as VehicleCategory)}
                className="w-full p-2 border rounded-lg bg-slate-50 text-xs"
              >
                <option value="LMV">Light Motor Vehicle (LMV Private Car)</option>
                <option value="HEAVY_VEHICLE">Heavy Commercial Vehicle (HGV Truck)</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Claim Category *</label>
              <select
                value={claimType}
                onChange={(e) => setClaimType(e.target.value as ClaimCategory)}
                className="w-full p-2 border rounded-lg bg-slate-50 text-xs"
              >
                <option value="OD">OD (Own Damage)</option>
                <option value="TP">TP (Third Party)</option>
                <option value="IBNR">IBNR</option>
                <option value="281">281 Investigation</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Vehicle Registration No *</label>
              <input
                type="text"
                placeholder="e.g. MH-12-AB-1234"
                value={vehicleRegNumber}
                onChange={(e) => setVehicleRegNumber(e.target.value)}
                required
                className="w-full p-2 border rounded-lg font-mono uppercase text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Vehicle Make / Model</label>
              <input
                type="text"
                placeholder="e.g. Tata Prima / Hyundai Creta"
                value={vehicleMakeModel}
                onChange={(e) => setVehicleMakeModel(e.target.value)}
                className="w-full p-2 border rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Insured Party Name *</label>
              <input
                type="text"
                placeholder="Full Legal Name"
                value={insuredName}
                onChange={(e) => setInsuredName(e.target.value)}
                required
                className="w-full p-2 border rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Insured Primary Phone *</label>
              <input
                type="tel"
                placeholder="+919876543210"
                value={insuredPrimaryPhone}
                onChange={(e) => setInsuredPrimaryPhone(e.target.value)}
                required
                className="w-full p-2 border rounded-lg font-mono text-xs"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">State & District</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="State"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="w-full p-2 border rounded-lg text-xs"
                />
                <input
                  type="text"
                  placeholder="District"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  className="w-full p-2 border rounded-lg text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">Claim Estimated Amount (₹)</label>
              <input
                type="number"
                value={claimAmount}
                onChange={(e) => setClaimAmount(parseFloat(e.target.value) || 0)}
                className="w-full p-2 border rounded-lg text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block font-bold text-slate-700 mb-1">Cause of Loss</label>
            <input
              type="text"
              placeholder="e.g. Rollover on highway / divider impact"
              value={causeOfLoss}
              onChange={(e) => setCauseOfLoss(e.target.value)}
              className="w-full p-2 border rounded-lg text-xs"
            />
          </div>

          <div>
            <label className="block font-bold text-amber-800 mb-1">Insurer Suspicion Narrative / Trigger</label>
            <textarea
              rows={2}
              placeholder="e.g. Old damages suspected; intimation delayed by 14 days"
              value={triggerNarrative}
              onChange={(e) => setTriggerNarrative(e.target.value)}
              className="w-full p-2 border border-amber-300 rounded-lg bg-amber-50/50 text-xs"
            />
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-slate-50 text-slate-700 font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-trust-600 hover:bg-trust-700 text-white font-bold rounded-lg shadow-sm"
            >
              {loading ? 'Creating...' : 'Create Claim Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
