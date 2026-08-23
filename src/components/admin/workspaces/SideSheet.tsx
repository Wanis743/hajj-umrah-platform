import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '@/theme/ThemeProvider';
import { useI18n } from '@/i18n/I18nProvider';

interface SideSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export function SideSheet({ isOpen, onClose, title, children, width = 'max-w-2xl' }: SideSheetProps) {
  const { theme } = useTheme();
  const { lang } = useI18n();
  const isAr = lang === 'ar';

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Sheet */}
      <div 
        className={`relative w-full ${width} h-full bg-[var(--surface)] border-[var(--border)] shadow-2xl flex flex-col transform transition-transform duration-300 ${
          isAr ? 'mr-auto border-r' : 'ml-auto border-l'
        }`}
        style={{
          backdropFilter: 'blur(20px) saturate(165%)',
          WebkitBackdropFilter: 'blur(20px) saturate(165%)',
        }}
        dir={isAr ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)] shrink-0">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
          <button 
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[var(--bg-hover)] text-[var(--text-muted)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}

