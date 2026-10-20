import React, { useEffect, useState } from 'react';
import { Users, Clock, AlertTriangle, Phone, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react';
import { api } from '../api/client';

interface AgentHubProps {
  onOpenDossier: (caseId: string) => void;
}

export const AgentHub: React.FC<AgentHubProps> = ({ onOpenDossier }) => {
  const [agents, setAgents] = useState<any[]>([]);
  const [dueRecalls, setDueRecalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [agentList, recallsList] = await Promise.all([
        api.getAgents(),
        api.getDueRecalls(),
      ]);
      setAgents(agentList);
      setDueRecalls(recallsList);
    } catch (err) {
      console.error('Failed to load Agent Hub data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Poll every 30 seconds for live recall alarms
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Agent Operations Hub & Recall Command</h2>
          <p className="text-xs text-slate-500">
            Real-time caseload balancing and scheduled tele-verification follow-ups.
          </p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-slate-700 shadow-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Hub</span>
        </button>
      </div>

      {/* Grid: Left = Active Recall Timers, Right = Agent Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column: Scheduled Recall Timers */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Actionable Follow-Up Recalls ({dueRecalls.length})
              </h3>
            </div>
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
              LIVE SCHEDULE
            </span>
          </div>

          <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
            {dueRecalls.length > 0 ? (
              dueRecalls.map((recall) => (
                <div
                  key={recall.call_log_id}
                  className={`p-3.5 rounded-xl border text-xs transition-all flex flex-col justify-between ${
                    recall.is_overdue
                      ? 'bg-rose-50/70 border-rose-300'
                      : 'bg-amber-50/50 border-amber-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-slate-900 font-mono">
                        {recall.case_number}
                      </span>
                      <span className="font-semibold text-slate-600">
                        {recall.vehicle_reg_number}
                      </span>
                      {recall.is_overdue && (
                        <span className="px-1.5 py-0.5 bg-rose-600 text-white font-bold text-[9px] rounded">
                          OVERDUE
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => onOpenDossier(recall.case_id)}
                      className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-300 rounded text-[11px] font-bold text-trust-700 shadow-xs"
                    >
                      <span>Open Dossier</span>
                      <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="mt-2 text-slate-700">
                    <span className="font-bold text-slate-900">{recall.contact_name}</span> ({recall.contact_phone}):{' '}
                    <span className="italic">"{recall.notes}"</span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-semibold">
                      Reason: {recall.disposition.replace(/_/g, ' ')}
                    </span>
                    <span className="font-mono text-slate-700 font-semibold">
                      Due: {new Date(recall.recall_at).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-16 text-slate-400 text-xs">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
                <p className="font-semibold text-slate-700">All Scheduled Recalls Clear</p>
                <p className="text-slate-400 mt-1">No pending telephone recall timers due right now.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Agent Caseload Balancer */}
        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Users className="w-5 h-5 text-trust-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Investigator Workload Balancing
              </h3>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              Active Cases (WIP + Review)
            </span>
          </div>

          <div className="space-y-3">
            {agents.map((ag) => {
              const loadPercent = Math.min(100, (ag.active_cases_count / 20) * 100);
              const isHeavyLoad = ag.active_cases_count >= 15;

              return (
                <div
                  key={ag.id}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white transition-all space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{ag.full_name}</div>
                      <div className="text-slate-400">{ag.email}</div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`text-sm font-extrabold ${
                          isHeavyLoad ? 'text-amber-600' : 'text-trust-600'
                        }`}
                      >
                        {ag.active_cases_count}
                      </span>
                      <span className="text-slate-400 text-[11px] block">Active Cases</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isHeavyLoad ? 'bg-amber-500' : 'bg-trust-500'
                      }`}
                      style={{ width: `${loadPercent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
