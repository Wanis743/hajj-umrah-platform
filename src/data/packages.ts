export interface Pkg {
  id: string;
  name: string;
  type: 'عمرة' | 'حج';
  duration: string;
  price: string;
  image: string;
  tagline: string;
  includes: string[];
}

export const packages: Pkg[] = [
  {
    id: 'umrah-ramadan',
    name: 'عمرة رمضان',
    type: 'عمرة',
    duration: '١٠ أيام',
    price: 'ابتداءً من ٢٩٠٫٠٠٠ دج',
    image:
      'https://images.pexels.com/photos/26436662/pexels-photo-26436662.jpeg?auto=compress&cs=tinysrgb&w=1200',
    tagline: 'أداء العمرة في أفضل ليالي السنة براحة وطمأنينة',
    includes: [
      'تأشيرة عمرة كاملة',
      'إقامة ٤ ليالٍ في مكة (فندق ٤★)',
      'إقامة ٤ ليالٍ في المدينة (فندق ٤★)',
      'نقل خاص بين المدينتين',
      'مرشد ديني مرافق',
      'وجبتي إفطار وسحور',
    ],
  },
  {
    id: 'hajj-premium',
    name: 'باقة الحج المتميزة',
    type: 'حج',
    duration: '١٥ يومًا',
    price: 'ابتداءً من ١٫٢٠٠٫٠٠٠ دج',
    image:
      'https://images.pexels.com/photos/35315919/pexels-photo-35315919.jpeg?auto=compress&cs=tinysrgb&w=1200',
    tagline: 'رحلة حج متكاملة بإشراف ديني وخبرة سنوات',
    includes: [
      'تأشيرة حج مع جميع التصاريح',
      'إقامة في مكة قرب الحرم (فندق ٥★)',
      'مخيمات منى وعرفات بمستوى عالٍ',
      'نقل حافلات مكيفة ومريحة',
      'مرشد ديني وطباخ متخصص',
      'وجبات كاملة طوال الرحلة',
    ],
  },
  {
    id: 'umrah-economy',
    name: 'عمرة اقتصادية',
    type: 'عمرة',
    duration: '٧ أيام',
    price: 'ابتداءً من ١٨٠٫٠٠٠ دج',
    image:
      'https://images.pexels.com/photos/2830460/pexels-photo-2830460.jpeg?auto=compress&cs=tinysrgb&w=1200',
    tagline: 'أداء العمرة بميزانية مناسبة دون التفريط في الراحة',
    includes: [
      'تأشيرة عمرة',
      'إقامة ٣ ليالٍ في مكة (فندق ٣★)',
      'إقامة ٣ ليالٍ في المدينة (فندق ٣★)',
      'نقل جماعي بين المدينتين',
      'مرشد ديني',
      'وجبة إفطار',
    ],
  },
  {
    id: 'vip-package',
    name: 'باقة VIP',
    type: 'عمرة',
    duration: '٨ أيام',
    price: 'ابتداءً من ٤٥٠٫٠٠٠ دج',
    image:
      'https://images.pexels.com/photos/33169789/pexels-photo-33169789.jpeg?auto=compress&cs=tinysrgb&w=1200',
    tagline: 'تجربة فاخرة مع خدمات حصرية ونقل خاص طوال الرحلة',
    includes: [
      'تأشيرة عمرة سريعة',
      'إقامة فاخرة ٥★ قرب الحرمين',
      'سيارة خاصة بسائق مخصص',
      'مرشد ديني خاص',
      'وجبات كاملة (بوفيه مفتوح)',
      'جولات زيارات في مكة والمدينة',
    ],
  },
];
