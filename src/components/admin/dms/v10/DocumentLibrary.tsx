import React, { useState, useEffect } from 'react';
import { FileText, Upload, Search, Filter, AlertCircle, Loader2 } from 'lucide-react';
import { WorkspaceRegistry } from '../../../../platform/compat/workspaceRegistry';
import { supabase } from '../../../../lib/supabase';

interface DocumentItem {
  id: string;
  title: string;
  type: string;
  status: string;
  updatedAt: string;
}

interface DocumentLibraryProps {
  registry?: WorkspaceRegistry;
}

interface SupabaseInsertClient {
  from(table: string): {
    insert(data: unknown): Promise<{ error: Error | null; data: unknown }> & {
      select(): { single(): Promise<{ data: unknown; error: Error | null }> }
    };
  };
}

export function DocumentLibrary({ registry }: DocumentLibraryProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('documents')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(50);

      if (fetchError) {
        if (fetchError.code === '42P01') {
          setDocuments([]);
          return;
        }
        throw fetchError;
      }

      if (data) {
        setDocuments((data as Array<Record<string, unknown>>).map(d => ({
          id: String(d.id || ''),
          title: String(d.title || 'Untitled'),
          type: String(d.document_type || 'Unknown'),
          status: String(d.status || 'draft'),
          updatedAt: d.updated_at ? new Date(String(d.updated_at)).toLocaleDateString() : 'N/A'
        })));
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while fetching documents');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleUploadMock = async () => {
    try {
      setIsUploading(true);
      
      const db = supabase as unknown as SupabaseInsertClient;
      
      // Create document
      const { data: docData, error: docError } = await db.from('documents').insert([
        {
          title: `Scan_${crypto.randomUUID().slice(0, 8)}.pdf`,
          document_type: 'Invoice',
          status: 'draft',
          workspace_id: 'default'
        }
      ]).select().single();

      if (docError) throw docError;

      // Spawn an extraction job
      if (docData && typeof docData === 'object' && 'id' in docData) {
        const docId = String((docData as Record<string, unknown>).id);
        const { error: jobError } = await db.from('extraction_jobs').insert([
          {
            document_id: docId,
            status: 'pending'
          }
        ]);
        if (jobError) throw jobError;
      }

      await fetchDocuments();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError('Upload failed: ' + err.message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const filteredDocs = documents.filter(doc => 
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <div className="flex items-center justify-between p-6 border-b border-white/10 bg-slate-900/40 backdrop-blur-md">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Document Library</h1>
          <p className="text-sm text-slate-400">Manage business and operational documents</p>
        </div>
        <button 
          onClick={handleUploadMock}
          disabled={isUploading}
          className="flex items-center space-x-2 px-4 py-2 bg-indigo-500/20 text-indigo-400 rounded-lg hover:bg-indigo-500/30 transition-all duration-200 ease-in-out font-medium disabled:opacity-50"
        >
          {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" strokeWidth={2} />}
          <span>{isUploading ? 'Uploading...' : 'Upload Document'}</span>
        </button>
      </div>

      <div className="p-6 flex-1 overflow-auto">
        <div className="flex space-x-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search documents by title, type, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-sm"
            />
          </div>
          <button className="flex items-center space-x-2 px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg hover:bg-slate-800 transition-colors">
            <Filter className="w-4 h-4" />
            <span>Filter</span>
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500 mb-4" />
            <p className="text-slate-400">Loading documents...</p>
          </div>
        ) : error ? (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredDocs.map((doc) => (
              <div
                key={doc.id}
                className="group relative p-4 bg-slate-900/40 border border-white/5 rounded-xl hover:bg-slate-800/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-2 bg-indigo-500/10 rounded-lg">
                    <FileText className="w-5 h-5 text-indigo-400" />
                  </div>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    doc.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                    doc.status === 'draft' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-slate-500/10 text-slate-400'
                  }`}>
                    {doc.status}
                  </span>
                </div>
                
                <h3 className="font-medium text-slate-200 truncate mb-1">{doc.title}</h3>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{doc.type}</span>
                  <span>{doc.updatedAt}</span>
                </div>
              </div>
            ))}
            
            {filteredDocs.length === 0 && (
              <div className="col-span-full py-12 text-center text-slate-400 border border-dashed border-white/10 rounded-xl">
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
                <p>No documents found</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
