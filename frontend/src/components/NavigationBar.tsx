import React from 'react';
import { Shield, Clock, User, LogOut, CheckCircle2, ChevronDown } from 'lucide-react';
import { UserRole } from '../types';

interface NavigationBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: any;
  onSwitchPersona: (role: UserRole) => void;
  onLogout: () => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onSwitchPersona,
  onLogout,
}) => {
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-white sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('vault')}>
            <div className="w-10 h-10 rounded-lg bg-trust-600 flex items-center justify-center text-white shadow-md shadow-trust-900/40">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <div className="text-base font-bold tracking-tight text-white flex items-center space-x-2">
                <span>Motor Claim Dossier Intelligence</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-trust-900/80 text-trust-300 border border-trust-700/50">
                  PROD v2.4
                </span>
              </div>
              <p className="text-xs text-slate-400">Commercial & LMV Tele-Verification Platform</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center space-x-1">
            <button
              onClick={() => setActiveTab('vault')}
              className={`px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'vault'
                  ? 'bg-trust-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              Cases Vault
            </button>
            <button
              onClick={() => setActiveTab('agent_hub')}
              className={`px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'agent_hub'
                  ? 'bg-trust-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              Agent Hub & Recalls
            </button>
            {currentUser?.role === 'ADMIN' && (
              <button
                onClick={() => setActiveTab('commercials')}
                className={`px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'commercials'
                    ? 'bg-trust-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                Commercial Metrics
              </button>
            )}
            {currentUser?.role === 'INSURER' && (
              <button
                onClick={() => setActiveTab('insurer_portal')}
                className={`px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === 'insurer_portal'
                    ? 'bg-trust-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                Insurer Portal
              </button>
            )}
            <button
              onClick={() => setActiveTab('verify')}
              className={`px-3.5 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'verify'
                  ? 'bg-trust-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
            >
              Verify QR Ledger
            </button>
          </nav>

          {/* Right Status & Persona Profile */}
          <div className="flex items-center space-x-4">
            {/* Live Connection Pill */}
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Connected</span>
            </div>

            {/* Quick Persona Switcher Dropdown */}
            <div className="relative">
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3 py-1.5 rounded-lg text-xs transition-colors"
                title="Switch active user persona for demo testing"
              >
                <div className="w-5 h-5 rounded-full bg-trust-500/20 text-trust-300 flex items-center justify-center font-bold">
                  {currentUser?.full_name?.charAt(0) || 'U'}
                </div>
                <div className="text-left">
                  <div className="font-semibold text-white leading-tight">
                    {currentUser?.full_name || 'Loading...'}
                  </div>
                  <div className="text-[10px] text-trust-300 font-mono tracking-wider">
                    {currentUser?.role}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-2 z-50 text-xs">
                  <div className="px-3 py-1.5 text-slate-400 font-semibold uppercase tracking-wider text-[10px] border-b border-slate-700">
                    Switch Test Persona
                  </div>
                  <button
                    onClick={() => {
                      onSwitchPersona('ADMIN');
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">👑 Vikram Malhotra</div>
                      <div className="text-[10px] text-slate-400">Admin / Managing Director</div>
                    </div>
                    {currentUser?.role === 'ADMIN' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                  <button
                    onClick={() => {
                      onSwitchPersona('MANAGER');
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">👔 Sanjay Rao</div>
                      <div className="text-[10px] text-slate-400">Manager (QA Lead & Ops)</div>
                    </div>
                    {currentUser?.role === 'MANAGER' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                  <button
                    onClick={() => {
                      onSwitchPersona('AGENT');
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">🕵️ Palak Gupta</div>
                      <div className="text-[10px] text-slate-400">Senior Field Investigator</div>
                    </div>
                    {currentUser?.role === 'AGENT' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                  <button
                    onClick={() => {
                      onSwitchPersona('INSURER');
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700 text-slate-200 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">🏢 Amit Verma (ICICI)</div>
                      <div className="text-[10px] text-slate-400">Insurer Claims Manager</div>
                    </div>
                    {currentUser?.role === 'INSURER' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                  <div className="border-t border-slate-700 mt-1 pt-1">
                    <button
                      onClick={onLogout}
                      className="w-full text-left px-3 py-1.5 hover:bg-rose-950/40 text-rose-300 flex items-center space-x-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
