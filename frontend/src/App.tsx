import React, { useEffect, useState } from 'react';
import { Shield, Lock, Mail, ArrowRight, UserCheck, AlertCircle } from 'lucide-react';
import { NavigationBar } from './components/NavigationBar';
import { CasesVault } from './components/CasesVault';
import { DossierModal } from './components/DossierModal';
import { SeparateCallWidgets } from './components/SeparateCallWidgets';
import { AddCaseModal } from './components/AddCaseModal';
import { BulkImportModal } from './components/BulkImportModal';
import { AgentHub } from './components/AgentHub';
import { CommercialMetrics } from './components/CommercialMetrics';
import { InsurerPortal } from './components/InsurerPortal';
import { PublicVerificationView } from './components/PublicVerificationView';
import { api, getStoredToken, setStoredToken, clearStoredToken } from './api/client';
import { UserRole } from './types';

export const App: React.FC = () => {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loadingUser, setLoadingUser] = useState(false);

  // Active view tab
  const [activeTab, setActiveTab] = useState<string>('vault');

  // Modals
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Active Tele-Verification session (Separate Buttons + WhatsApp)
  const [activeCallSession, setActiveCallSession] = useState<{
    caseId: string;
    caseNumber?: string;
    contactPhone?: string;
    contactName?: string;
  } | null>(null);

  const handleStartTeleVerification = (caseId: string, _contactId?: string, contactPhone?: string, caseNumber?: string, contactName?: string) => {
    // 1. Mount floating buttons FIRST so PiP window opens immediately
    setActiveCallSession({
      caseId,
      caseNumber,
      contactPhone,
      contactName,
    });

    // 2. Redirect to WhatsApp with contact's phone (opens in new tab)
    if (contactPhone) {
      const cleanPhone = contactPhone.replace(/[^0-9]/g, '');
      // Small delay to ensure PiP window is requested before tab switch
      setTimeout(() => {
        window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}`, '_blank');
      }, 300);
    }
  };

  // Login form state
  const [loginEmail, setLoginEmail] = useState('admin@agency.com');
  const [loginPassword, setLoginPassword] = useState('Password123!');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const loadUserProfile = async () => {
    try {
      setLoadingUser(true);
      const user = await api.getMe();
      setCurrentUser(user);
      if (user.role === 'INSURER') {
        setActiveTab('insurer_portal');
      }
    } catch (err) {
      console.error('Failed to get user:', err);
      clearStoredToken();
      setToken(null);
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadUserProfile();
    }
  }, [token]);

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await api.login(loginEmail, loginPassword);
      setStoredToken(res.token);
      setToken(res.token);
      setCurrentUser(res.user);
      if (res.user.role === 'INSURER') {
        setActiveTab('insurer_portal');
      } else {
        setActiveTab('vault');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleQuickPersonaLogin = async (email: string, role: UserRole) => {
    setLoginEmail(email);
    setLoginPassword('Password123!');
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await api.login(email, 'Password123!');
      setStoredToken(res.token);
      setToken(res.token);
      setCurrentUser(res.user);
      if (role === 'INSURER') {
        setActiveTab('insurer_portal');
      } else {
        setActiveTab('vault');
      }
    } catch (err: any) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    clearStoredToken();
    setToken(null);
    setCurrentUser(null);
  };

  const handleSwitchPersona = async (role: UserRole) => {
    const emailMap: Record<UserRole, string> = {
      ADMIN: 'admin@agency.com',
      MANAGER: 'manager.qa@agency.com',
      AGENT: 'agent.palak@agency.com',
      INSURER: 'claims@icicilombard.com',
    };
    await handleQuickPersonaLogin(emailMap[role], role);
  };

  // If not logged in and not verifying QR, show Login Screen
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100 selection:bg-trust-500">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <div className="w-14 h-14 rounded-2xl bg-trust-600 flex items-center justify-center mx-auto text-white shadow-xl shadow-trust-900/40 mb-3">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white">
            Motor Claim Verification Platform
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Dossier Intelligence, WhatsApp Tele-Verification & Certified PDF Ledger
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4">
          <div className="bg-slate-800 py-8 px-6 shadow-2xl rounded-2xl border border-slate-700 space-y-6">
            {loginError && (
              <div className="p-3 bg-rose-950/80 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{loginError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Corporate Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-trust-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-trust-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 px-4 bg-trust-600 hover:bg-trust-500 font-bold rounded-xl text-white shadow-lg shadow-trust-900/30 transition-colors flex items-center justify-center space-x-2 text-sm"
              >
                <span>{loginLoading ? 'Authenticating...' : 'Sign In to Command Center'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Quick 1-Click Role Demonstrator Buttons */}
            <div className="pt-4 border-t border-slate-700">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-2 text-center">
                One-Click Quick Persona Logins
              </span>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => handleQuickPersonaLogin('admin@agency.com', 'ADMIN')}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-left transition-colors"
                >
                  <div className="font-bold text-white">👑 Vikram Malhotra</div>
                  <div className="text-[10px] text-slate-400">Admin (Director)</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPersonaLogin('manager.qa@agency.com', 'MANAGER')}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-left transition-colors"
                >
                  <div className="font-bold text-white">👔 Sanjay Rao</div>
                  <div className="text-[10px] text-slate-400">Manager (QA Lead)</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPersonaLogin('agent.palak@agency.com', 'AGENT')}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-left transition-colors"
                >
                  <div className="font-bold text-white">🕵️ Palak Gupta</div>
                  <div className="text-[10px] text-slate-400">Agent (Investigator)</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickPersonaLogin('claims@icicilombard.com', 'INSURER')}
                  className="p-2 rounded-lg bg-slate-900 hover:bg-slate-700 border border-slate-700 text-left transition-colors"
                >
                  <div className="font-bold text-white">🏢 Amit Verma</div>
                  <div className="text-[10px] text-slate-400">Client Insurer Portal</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Persistent Navigation Bar */}
      <NavigationBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onSwitchPersona={handleSwitchPersona}
        onLogout={handleLogout}
      />

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'vault' && (
          <CasesVault
            currentUser={currentUser}
            onOpenDossier={(id) => setSelectedCaseId(id)}
            onOpenAddModal={() => setShowAddModal(true)}
            onOpenImportModal={() => setShowImportModal(true)}
            refreshTrigger={refreshTrigger}
          />
        )}

        {activeTab === 'agent_hub' && (
          <AgentHub onOpenDossier={(id) => setSelectedCaseId(id)} />
        )}

        {activeTab === 'commercials' && <CommercialMetrics />}

        {activeTab === 'insurer_portal' && (
          <InsurerPortal
            currentUser={currentUser}
            onOpenDossier={(id) => setSelectedCaseId(id)}
          />
        )}

        {activeTab === 'verify' && <PublicVerificationView />}
      </main>

      {/* 7-Section Deep Record Dossier Modal */}
      {selectedCaseId && (
        <DossierModal
          caseId={selectedCaseId}
          currentUser={currentUser}
          onClose={() => setSelectedCaseId(null)}
          onRefreshList={() => setRefreshTrigger((prev) => prev + 1)}
          onStartTeleVerification={handleStartTeleVerification}
        />
      )}

      {/* Add Case Modal */}
      {showAddModal && (
        <AddCaseModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
            setRefreshTrigger((prev) => prev + 1);
          }}
        />
      )}

      {/* Bulk Import Modal */}
      {showImportModal && (
        <BulkImportModal
          onClose={() => setShowImportModal(false)}
          onSuccess={() => {
            setShowImportModal(false);
            setRefreshTrigger((prev) => prev + 1);
          }}
        />
      )}

      {/* Always-On-Top OS PiP Floating Buttons: [● REC/■ STOP/⏸ PAUSE] and [📷 CAPTURE] */}
      {activeCallSession && (
        <SeparateCallWidgets
          caseId={activeCallSession.caseId}
          caseNumber={activeCallSession.caseNumber}
          contactPhone={activeCallSession.contactPhone}
          contactName={activeCallSession.contactName}
          onClose={() => setActiveCallSession(null)}
          onRecordingSaved={() => {
            setRefreshTrigger((prev) => prev + 1);
          }}
        />
      )}
    </div>
  );
};
