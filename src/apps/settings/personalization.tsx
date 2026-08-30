/**
 * Settings — personalisation.
 *
 * The page that proves the registry is real: every control writes one value, the
 * shell is already subscribed to the registry subsystem, and the desktop behind
 * this window repaints before the write promise resolves. Nothing here talks to
 * the shell directly, and there is no "apply" button because there is no local
 * copy of the state to apply.
 */
import { Check, Image, Layout, Palette, Sparkles } from 'lucide-react';
import { Card, Section, Segmented, Switch, useApp } from '@/platform/sdk';
import { Row } from './parts';
import {
  ACCENTS,
  ICON_SIZE_CHOICES,
  KEYS,
  THEME_CHOICES,
  WALLPAPER_CHOICES,
  oneOf,
  useRegistryValue,
  type IconSize,
  type ThemeName,
} from './prefs';

export function PersonalizationPage() {
  const { tr, t } = useApp().locale;
  const [theme, setTheme] = useRegistryValue<string>(KEYS.appearance, 'Theme', 'dark');
  const [accent, setAccent] = useRegistryValue<string>(KEYS.appearance, 'Accent', '#0067c0');
  const [transparency, setTransparency] = useRegistryValue<boolean>(KEYS.appearance, 'Transparency', true);
  const [animations, setAnimations] = useRegistryValue<boolean>(KEYS.appearance, 'Animations', true);
  const [wallpaper, setWallpaper] = useRegistryValue<string>(KEYS.desktop, 'Wallpaper', 'summit');
  const [iconSize, setIconSize] = useRegistryValue<string>(KEYS.desktop, 'IconSize', 'medium');
  const [showIcons, setShowIcons] = useRegistryValue<boolean>(KEYS.desktop, 'ShowIcons', true);
  const [alignment, setAlignment] = useRegistryValue<string>(KEYS.taskbar, 'Alignment', 'center');
  const [autoHide, setAutoHide] = useRegistryValue<boolean>(KEYS.taskbar, 'AutoHide', false);
  const [showSearch, setShowSearch] = useRegistryValue<boolean>(KEYS.taskbar, 'ShowSearch', true);
  const [showTaskView, setShowTaskView] = useRegistryValue<boolean>(KEYS.taskbar, 'ShowTaskView', true);
  const [showWidgets, setShowWidgets] = useRegistryValue<boolean>(KEYS.taskbar, 'ShowWidgets', true);
  const [startLayout, setStartLayout] = useRegistryValue<string>(KEYS.start, 'Layout', 'pinned');
  const [showRecommended, setShowRecommended] = useRegistryValue<boolean>(KEYS.start, 'ShowRecommended', true);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Section title={tr('السمة', 'Thème', 'Theme')}>
        <Card icon={Palette} padded>
          <Row title={tr('نمط الألوان', 'Mode de couleur', 'Colour mode')}>
            <Segmented<ThemeName>
              value={oneOf(theme, THEME_CHOICES, 'dark')}
              onChange={setTheme}
              options={THEME_CHOICES.map((choice) => ({ value: choice.value, label: t(choice.label) }))}
            />
          </Row>
          <Row
            title={tr('الشفافية', 'Transparence', 'Transparency')}
            hint={tr('تأثيرات ميكا والأكريليك', 'Effets Mica et acrylique', 'Mica and acrylic effects')}
          >
            <Switch checked={transparency} onChange={setTransparency} />
          </Row>
          <Row
            title={tr('الحركات', 'Animations', 'Animations')}
            hint={tr('انتقالات النوافذ والقوائم', 'Transitions des fenêtres et menus', 'Window and menu transitions')}
          >
            <Switch checked={animations} onChange={setAnimations} />
          </Row>
          <div style={{ paddingTop: 12 }}>
            <div style={{ fontSize: 'var(--fx-body)', paddingBottom: 8 }}>{tr('لون التمييز', 'Couleur d’accentuation', 'Accent colour')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {ACCENTS.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => setAccent(swatch.hex)}
                  title={t(swatch.label)}
                  aria-label={t(swatch.label)}
                  aria-pressed={accent === swatch.hex}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--fx-radius-control)',
                    background: swatch.hex,
                    border: accent === swatch.hex ? '2px solid var(--fx-text-primary)' : '1px solid var(--fx-control-stroke)',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {accent === swatch.hex ? <Check size={16} color="#ffffff" /> : null}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <Section title={tr('سطح المكتب', 'Bureau', 'Desktop')}>
        <Card icon={Image} padded>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, paddingBottom: 12 }}>
            {WALLPAPER_CHOICES.map((paper) => (
              <button
                key={paper.id}
                type="button"
                onClick={() => setWallpaper(paper.id)}
                title={t(paper.label)}
                aria-label={t(paper.label)}
                aria-pressed={wallpaper === paper.id}
                style={{
                  width: 108,
                  height: 68,
                  borderRadius: 'var(--fx-radius-card)',
                  background: paper.swatch,
                  border: wallpaper === paper.id ? '2px solid var(--fx-accent)' : '1px solid var(--fx-stroke-card)',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'grid',
                  alignContent: 'end',
                  justifyItems: 'start',
                }}
              >
                <span
                  style={{
                    margin: 4,
                    padding: '1px 6px',
                    borderRadius: 99,
                    fontSize: 10,
                    background: 'rgba(0, 0, 0, 0.45)',
                    color: '#ffffff',
                  }}
                >
                  {t(paper.label)}
                </span>
              </button>
            ))}
          </div>
          <Row title={tr('إظهار أيقونات سطح المكتب', 'Afficher les icônes du bureau', 'Show desktop icons')}>
            <Switch checked={showIcons} onChange={setShowIcons} />
          </Row>
          <Row title={tr('حجم الأيقونات', 'Taille des icônes', 'Icon size')}>
            <Segmented<IconSize>
              value={oneOf(iconSize, ICON_SIZE_CHOICES, 'medium')}
              onChange={setIconSize}
              options={ICON_SIZE_CHOICES.map((choice) => ({ value: choice.value, label: t(choice.label) }))}
            />
          </Row>
        </Card>
      </Section>

      <Section title={tr('شريط المهام', 'Barre des tâches', 'Taskbar')}>
        <Card icon={Layout} padded>
          <Row title={tr('محاذاة شريط المهام', 'Alignement', 'Taskbar alignment')}>
            <Segmented<'start' | 'center'>
              value={alignment === 'start' ? 'start' : 'center'}
              onChange={setAlignment}
              options={[
                { value: 'center', label: tr('وسط', 'Centre', 'Centre') },
                { value: 'start', label: tr('يسار', 'Gauche', 'Start') },
              ]}
            />
          </Row>
          <Row title={tr('إخفاء تلقائي', 'Masquer automatiquement', 'Automatically hide')}>
            <Switch checked={autoHide} onChange={setAutoHide} />
          </Row>
          <Row title={tr('زر البحث', 'Bouton Recherche', 'Search button')}>
            <Switch checked={showSearch} onChange={setShowSearch} />
          </Row>
          <Row title={tr('عرض المهام', 'Vue des tâches', 'Task view')}>
            <Switch checked={showTaskView} onChange={setShowTaskView} />
          </Row>
          <Row title={tr('الأدوات', 'Widgets', 'Widgets')}>
            <Switch checked={showWidgets} onChange={setShowWidgets} />
          </Row>
        </Card>
      </Section>

      <Section title={tr('قائمة ابدأ', 'Menu Démarrer', 'Start menu')}>
        <Card icon={Sparkles} padded>
          <Row title={tr('التخطيط', 'Disposition', 'Layout')}>
            <Segmented<'pinned' | 'all'>
              value={startLayout === 'all' ? 'all' : 'pinned'}
              onChange={setStartLayout}
              options={[
                { value: 'pinned', label: tr('المثبّتة', 'Épinglés', 'Pinned') },
                { value: 'all', label: tr('كل التطبيقات', 'Toutes', 'All apps') },
              ]}
            />
          </Row>
          <Row title={tr('عناصر مقترحة', 'Recommandations', 'Recommended items')}>
            <Switch checked={showRecommended} onChange={setShowRecommended} />
          </Row>
        </Card>
      </Section>
    </div>
  );
}
