import React, { useEffect, useState } from 'react';
import { DollarSign, Clock, FileSpreadsheet, Building2, CheckCircle2, RefreshCw } from 'lucide-react';
import { api } from '../api/client';

export const CommercialMetrics: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBillingData = async () => {
    setLoading(true);
    try {
      const [m, l] = await Promise.all([
        api.getBillingMetrics(),
        api.getBillingLedger(),
      ]);
      setMetrics(m);
      setLedger(l);
    } catch (err) {
      console.error('Failed to load commercial metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBillingData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Title Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Commercial Metrics & Revenue Ledger</h2>
          <p className="text-xs text-slate-500">
            Per-minute tele-verification billing, contractual rate cards, and insurer invoicing.
          </p>
        </div>
        <button
          onClick={loadBillingData}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {/* Top 4 KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>TOTAL BILLABLE MINS</span>
            <Clock className="w-4 h-4 text-trust-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {metrics?.total_billable_minutes?.toLocaleString('en-IN') || 0}{' '}
            <span className="text-xs text-slate-400 font-normal">Mins</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Exact ceiling per-minute arithmetic</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>GROSS BILLED REVENUE</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 font-mono">
            ₹{parseFloat(metrics?.gross_billed_inr || 0).toLocaleString('en-IN')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Tele-verification time + base case intake fee</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>COMPLETED & INVOICED</span>
            <CheckCircle2 className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-extrabold text-purple-900 font-mono">
            {metrics?.completed_cases_count || 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Signed-off locked claims released</div>
        </div>

        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold mb-2">
            <span>AVG RECORDED CALL TIME</span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {metrics?.avg_call_duration || '0M 0S'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">Average tele-verification per claim</div>
        </div>
      </div>

      {/* Insurer Contract Breakdown Table */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center space-x-2">
          <Building2 className="w-4 h-4 text-trust-600" />
          <span>Client Insurer Billing Breakdown & Rate Cards</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2.5">Insurer Client</th>
                <th className="px-4 py-2.5">Completed Cases</th>
                <th className="px-4 py-2.5">Recorded Call Time</th>
                <th className="px-4 py-2.5">Billable Minutes</th>
                <th className="px-4 py-2.5">Rate / Min (₹)</th>
                <th className="px-4 py-2.5 text-right">Gross Billed Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {metrics?.insurers_breakdown?.map((ins: any) => (
                <tr key={ins.insurer_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-900">{ins.insurer_name}</td>
                  <td className="px-4 py-3 font-mono">{ins.total_cases}</td>
                  <td className="px-4 py-3 font-mono">{ins.total_time_formatted}</td>
                  <td className="px-4 py-3 font-mono font-bold text-trust-700">{ins.billable_minutes} Mins</td>
                  <td className="px-4 py-3 font-mono">₹{parseFloat(ins.rate_per_minute_inr).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-mono font-extrabold text-emerald-700">
                    ₹{parseFloat(ins.total_billed_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Itemized Claims Ledger */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center space-x-2">
          <FileSpreadsheet className="w-4 h-4 text-slate-600" />
          <span>Itemized Claim Settlement Invoicing Ledger</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2.5">Invoice Ref</th>
                <th className="px-3 py-2.5">Case ID</th>
                <th className="px-3 py-2.5">Insurer</th>
                <th className="px-3 py-2.5">Vehicle Reg</th>
                <th className="px-3 py-2.5">Recorded Duration</th>
                <th className="px-3 py-2.5">Billable Mins</th>
                <th className="px-3 py-2.5">Rate / Min</th>
                <th className="px-3 py-2.5">Base Fee</th>
                <th className="px-3 py-2.5">Total Billed</th>
                <th className="px-3 py-2.5">Settlement Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white font-mono">
              {ledger.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2.5 font-bold text-slate-800">{item.invoice_reference}</td>
                  <td className="px-3 py-2.5 text-trust-700 font-bold">{item.case_number}</td>
                  <td className="px-3 py-2.5 font-sans font-medium text-slate-700">{item.insurer_name}</td>
                  <td className="px-3 py-2.5 font-bold">{item.vehicle_reg_number}</td>
                  <td className="px-3 py-2.5">{item.duration_formatted}</td>
                  <td className="px-3 py-2.5 font-bold text-trust-600">{item.billable_minutes}m</td>
                  <td className="px-3 py-2.5">₹{parseFloat(item.rate_per_minute_inr).toFixed(2)}</td>
                  <td className="px-3 py-2.5">₹{parseFloat(item.base_fee_inr).toFixed(2)}</td>
                  <td className="px-3 py-2.5 font-extrabold text-emerald-700">
                    ₹{parseFloat(item.total_billed_inr).toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 font-sans text-slate-500 text-[11px]">{item.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
