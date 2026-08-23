import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, FileText, FileSpreadsheet, Printer, ChevronDown } from 'lucide-react';

interface ExportOption {
  label: string;
  icon: ReactNode;
  action: () => void;
}

interface ExportDropdownProps {
  onExportPDF?: () => void;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
  onPrint?: () => void;
  label?: string;
}

export default function ExportDropdown({
  onExportPDF,
  onExportCSV,
  onExportExcel,
  onPrint,
  label = 'Export',
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false);

  const options: ExportOption[] = [
    ...(onExportPDF ? [{ label: 'PDF', icon: <FileText className="h-4 w-4" />, action: onExportPDF }] : []),
    ...(onExportCSV ? [{ label: 'CSV', icon: <FileSpreadsheet className="h-4 w-4" />, action: onExportCSV }] : []),
    ...(onExportExcel ? [{ label: 'Excel', icon: <FileSpreadsheet className="h-4 w-4" />, action: onExportExcel }] : []),
    ...(onPrint ? [{ label: 'Print', icon: <Printer className="h-4 w-4" />, action: onPrint }] : []),
  ];

  if (options.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-colors text-[13px] font-medium"
      >
        <Download className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute end-0 z-20 mt-2 w-40 overflow-hidden rounded-xl border border-[var(--border)] dark:border-[var(--border)] bg-[var(--bg-hover)] dark:bg-[var(--bg-hover)] py-1 shadow-md"
            >
              {options.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => { opt.action(); setOpen(false); }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] dark:hover:bg-[var(--bg-hover)] transition-colors"
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
