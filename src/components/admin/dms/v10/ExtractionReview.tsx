import React, { useState, useEffect } from 'react';
import { ScanText, Check, X, AlertTriangle, Loader2, AlertCircle } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../lib/kernel/WorkspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface ExtractionJob {
  id: string;
  docTitle: string;
  status: string;
  confidence: number;
}

interface ExtractionReviewProps {
  registry?: WorkspaceRegistry;
}

export function ExtractionReview({ registry }: ExtractionReviewProps) {
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchJobs = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data, error: fetchError } = await supabase
          .from('extraction_jobs')
          .select('*')
          .order('started_at', { ascending: false })
          .limit(50);

        if (fetchError) {
          // Fallback if table structure is different or doesn't exist yet
          if (fetchError.code === '42P01') {
            setJobs([]);
            return;
          }
          throw fetchError;
        }

        if (data) {
          setJobs((data as Array<Record<string, unknown>>).map(j => ({
            id: String(j.id || ''),
            docTitle: String(j.document_id || 'Unknown Document'),
            status: String(j.status || 'pending'),
            confidence: Number(j.confidence_score || 0) * 100
          })));
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('An unexpected error occurred while fetching extraction jobs');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchJobs();
  }, []);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight">Data Extraction Review</h1>
        <p className="text-sm text-slate-400">Review automated data extraction from documents</p>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-400">Loading extraction jobs...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job) => (
              <div 
                key={job.id}
                className="flex items-center justify-between p-4 bg-slate-900/40 border border-white/5 rounded-xl hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center space-x-4">
                  <div className={`p-3 rounded-lg ${
                    job.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                    job.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                    'bg-amber-500/10 text-amber-400'
                  }`}>
                    {job.status === 'failed' ? <AlertTriangle className="w-6 h-6" /> :
                     job.status === 'completed' ? <Check className="w-6 h-6" /> :
                     <ScanText className="w-6 h-6" />}
                  </div>
                  <div>
                    <h3 className="font-medium text-slate-200">{job.docTitle}</h3>
                    <div className="flex items-center space-x-2 mt-1 text-sm text-slate-400">
                      <span>Status: {job.status}</span>
                      <span>•</span>
                      <span>Confidence: {job.confidence.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex space-x-2">
                  <button className="px-3 py-1.5 text-sm font-medium bg-white/5 hover:bg-white/10 rounded-lg transition-colors">
                    Review
                  </button>
                  {job.status === 'pending' && (
                    <button className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all">
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
            ))}

            {jobs.length === 0 && (
              <div className="py-12 text-center text-slate-400 border border-dashed border-white/10 rounded-xl">
                <ScanText className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No extraction jobs found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
