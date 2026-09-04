import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { packages as staticPackages, type Pkg } from '@/data/packages';

export interface PublicPkg extends Pkg {
  /** Present only when the package comes from the database catalog (single source of truth). */
  dbId?: string;
}

interface PublicPackageRow {
  id: string;
  code: string | null;
  name: string;
  name_ar: string | null;
  name_fr: string | null;
  price_dzd: number | null;
  price_sar: number | null;
  duration_label: string | null;
  type: string | null;
  tagline: string | null;
  image_url: string | null;
  includes: unknown;
}

const FALLBACK_IMAGE =
  'https://images.pexels.com/photos/2830460/pexels-photo-2830460.jpeg?auto=compress&cs=tinysrgb&w=1200';

function localizedName(row: PublicPackageRow, lang: string) {
  if (lang === 'fr' && row.name_fr) return row.name_fr;
  if ((lang === 'ar') && row.name_ar) return row.name_ar;
  return row.name;
}

function formatPrice(priceDzd: number | null, lang: string) {
  const value = Number(priceDzd ?? 0);
  if (!value) return '';
  const formatted = new Intl.NumberFormat(lang === 'fr' ? 'fr-DZ' : 'ar-DZ').format(value);
  if (lang === 'fr') return `À partir de ${formatted} DA`;
  if (lang === 'en') return `From ${formatted} DZD`;
  return `ابتداءً من ${formatted} دج`;
}

function toIncludes(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return [];
}

function mapRow(row: PublicPackageRow, lang: string): PublicPkg {
  return {
    id: row.id,
    dbId: row.id,
    name: localizedName(row, lang),
    type: (row.type === 'حج' || row.type === 'HAJJ' ? 'حج' : 'عمرة') as Pkg['type'],
    duration: row.duration_label ?? '',
    price: formatPrice(row.price_dzd, lang),
    image: row.image_url || FALLBACK_IMAGE,
    tagline: row.tagline ?? '',
    includes: toIncludes(row.includes),
  };
}

/**
 * Public package catalog. The database is the single source of truth; the bundled
 * static catalog is only a presentation fallback when the backend is unreachable
 * (reservations are never accepted against fallback entries).
 */
export function usePublicPackages(lang: string) {
  const [packages, setPackages] = useState<PublicPkg[]>(staticPackages);
  const [dbBacked, setDbBacked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_public_packages');
        if (!active) return;
        const rows = (data ?? []) as PublicPackageRow[];
        if (error || rows.length === 0) {
          setPackages(staticPackages);
          setDbBacked(false);
          return;
        }
        setPackages(rows.map((row) => mapRow(row, lang)));
        setDbBacked(true);
      } catch {
        if (!active) return;
        setPackages(staticPackages);
        setDbBacked(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [lang]);

  return { packages, dbBacked, loading };
}
