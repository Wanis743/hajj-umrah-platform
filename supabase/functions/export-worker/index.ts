import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

interface ExportField {
  key: string;
  labelEn?: string;
  sensitive?: boolean;
}

interface ExportRequest {
  module: string;
  format: string;
  dateFrom?: string;
  dateTo?: string;
  activeFields: ExportField[];
}

const envOrigins = Deno.env.get('ALLOWED_ORIGINS');
const allowedOrigins = envOrigins ? envOrigins.split(',') : ['http://localhost:8080', 'http://localhost:5173', 'https://erp.bousalem.dz'];

const getCorsHeaders = (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};

const json = (body: unknown, status = 200, req: Request) => {
  return new Response(JSON.stringify(body), {
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
    status,
  });
};

const getFieldsHash = async (fields: ExportField[]) => {
  const data = new TextEncoder().encode(JSON.stringify(fields.map(f => f.key).sort()));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

Deno./* eslint-disable complexity */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(req) });
  
  const correlationId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const authHeader = req.headers.get('Authorization');

    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // P1-02, P1-06: Database redaction relies on the user, but we can also filter requested fields safely.
    const { data: userResp, error: userError } = await supabase.auth.getUser();
    if (userError || !userResp?.user) throw new Error('Unauthorized');
    const uid = userResp.user.id;
    
    const { data: profile } = await supabase.from('staff_profiles').select('role, agency_id').eq('user_id', uid).single();
    if (!profile) throw new Error('Unauthorized: Profile not found');
    const isAdmin = profile.role === 'ADMIN';
    if (!isAdmin) throw new Error('Unauthorized: admin role required');

    const payload = await req.json();
    const { module, dateFrom, dateTo, activeFields, format }: ExportRequest = payload;
    if (!module || !format) {
      throw new Error('Missing required fields');
    }

    let hasMore = true;
    let offset = 0;
    const limit = 5000;
    let allRows: Record<string, unknown>[] = [];

    while (hasMore) {
      const { data, error } = await supabase.rpc('get_export_view', {
        p_module: module,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_limit: limit,
        p_offset: offset,
      });

      if (error) throw new Error('Data fetch failed: ' + error.message);

      const chunk = (data || []) as Record<string, unknown>[];
      allRows = allRows.concat(chunk);

      if (chunk.length < limit || allRows.length >= 25000) {
        if (allRows.length > 25000) allRows = allRows.slice(0, 25000);
        hasMore = false;
      } else {
        offset += limit;
      }
    }

    let fileContent = '';
    let mimeType = '';
    let extension = '';

    if (format === 'CSV') {
      const keys = activeFields.map((f: ExportField) => f.key);
      const headerRow = activeFields.map((f: ExportField) => `"${(f.labelEn || '').replace(/"/g, '""')}"`).join(',');
      fileContent = headerRow + '\n';
      fileContent += allRows.map(row => keys.map((k: string) => {
        const val = row[k];
        if (val === null || val === undefined) return '""';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(',')).join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    } else {
      fileContent = JSON.stringify(allRows.map(row => {
        const out: Record<string, unknown> = {};
        activeFields.forEach((f: ExportField) => out[f.key] = row[f.key]);
        return out;
      }), null, 2);
      mimeType = 'application/json';
      extension = 'json';
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `export_${module}_${timestamp}.${extension}`;
    const fullPath = `${profile.agency_id}/${uid}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from('exports')
      .upload(fullPath, fileContent, {
        contentType: mimeType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw new Error('Upload failed: ' + uploadError.message);

    // P1-05: Audit Integrity
    const fieldsHash = await getFieldsHash(activeFields);
    const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour expiry

    const { error: auditError } = await supabase.rpc('log_export', {
      p_module: module,
      p_format: format,
      p_scope: 'ENTIRE_DATASET',
      p_row_count: allRows.length,
      p_file_path: fullPath,
      p_fields_hash: fieldsHash,
      p_expiry: expiry,
      p_metadata: { source: 'export-worker', correlation_id: correlationId }
    });

    if (auditError) {
      await supabase.storage.from('exports').remove([fullPath]);
      throw new Error('Audit logging failed. Export aborted: ' + auditError.message);
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from('exports')
      .createSignedUrl(fullPath, 60 * 60);

    if (signedError) throw new Error('Signed URL failed: ' + signedError.message);

    return json({ url: signedData.signedUrl, filename, rows: allRows.length }, 200, req);
  } catch (error: unknown) {
    // P1-03: Raw Error Leakage Masking
    console.error(`[CORRELATION_ID:${correlationId}] Export worker error: `, error);
    return json({ 
      error: 'An internal error occurred during the export process.',
      code: 'INTERNAL_EXPORT_ERROR',
      correlation_id: correlationId 
    }, 500, req);
  }
});
