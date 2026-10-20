import React, { useState } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';

interface BulkImportModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ onClose, onSuccess }) => {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ imported_count: number; failed_rows: string[] } | null>(null);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setUploading(true);
    setResult(null);
    try {
      const res = await api.bulkImport(file);
      setResult(res);
      if (res.imported_count > 0) {
        onSuccess();
      }
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-trust-600 text-white flex items-center justify-center font-bold">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Bulk Claims Intake</h3>
              <p className="text-xs text-slate-400">Import hundreds of claims via CSV spreadsheet</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleUpload} className="space-y-4 text-xs">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:bg-slate-50 transition-colors">
            <FileSpreadsheet className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="font-semibold text-slate-700 mb-1">
              {file ? file.name : 'Select or drag & drop CSV file'}
            </p>
            <p className="text-slate-400 text-[11px] mb-3">
              Must include columns: case_number, vehicle_reg_number, insured_name, insured_primary_phone
            </p>

            <label className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg cursor-pointer hover:bg-slate-800 font-semibold transition-colors">
              <span>Choose File</span>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center justify-between text-xs">
            <a
              href="/api/v1/cases/template/csv"
              download
              className="text-trust-600 hover:underline font-semibold flex items-center space-x-1"
            >
              <span>Download sample CSV template</span>
            </a>
          </div>

          {result && (
            <div
              className={`p-3 rounded-lg text-xs ${
                result.imported_count > 0
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              <div className="font-bold flex items-center space-x-1.5">
                {result.imported_count > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                )}
                <span>Import Result: {result.imported_count} claims successfully created</span>
              </div>
              {result.failed_rows && result.failed_rows.length > 0 && (
                <div className="mt-2 text-rose-700">
                  <p className="font-semibold">Errors ({result.failed_rows.length}):</p>
                  <ul className="list-disc pl-4 space-y-0.5 max-h-24 overflow-y-auto">
                    {result.failed_rows.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end space-x-2 pt-3 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded-lg hover:bg-slate-50 text-slate-700 font-semibold"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={!file || uploading}
              className="px-5 py-2 bg-trust-600 hover:bg-trust-700 disabled:opacity-40 text-white font-bold rounded-lg shadow-sm"
            >
              {uploading ? 'Processing CSV...' : 'Start Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
