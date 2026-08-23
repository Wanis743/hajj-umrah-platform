import React from 'react';

export type ExportFormat = 'CSV' | 'JSON' | 'XLSX' | 'PDF' | 'PRINT';
export type ExportScope = 'CURRENT_PAGE' | 'SELECTED_ROWS' | 'ALL_FILTERED' | 'ENTIRE_DATASET' | 'FULL_REPORT';

export interface ExportModule {
  id: string;
  labelAr: string;
  labelFr: string;
  labelEn: string;
  icon: React.ComponentType<{ className?: string }>;
  table: string;
  fields: { key: string; labelAr: string; labelFr: string; labelEn: string; sensitive?: boolean }[];
}

export interface ExportHistoryItem {
  id: string;
  export_number: string;
  module: string;
  format: string;
  scope: string;
  row_count: number;
  created_at: string;
  created_by_email?: string;
}
