/**
 * Fluent UI kit barrel — re-exported from `@/platform/sdk`.
 *
 * Apps get their entire visual vocabulary here: controls, layout chrome, data
 * surfaces, charts and menus. Nothing in this folder touches the kernel, so a
 * component can be rendered in isolation.
 */
export type { ButtonVariant, ControlSize, Tone } from './tokens';
export { SERIES_COLORS, clamp, colorAt, niceCeil, toneColor, toneSurface } from './tokens';
export { APP_GLYPHS, glyphFor } from './glyphs';
export { APP_LOGOS, logoFor } from './logos';
export { WALLPAPER_PHOTOS, wallpaperPhoto } from './wallpapers';

export type {
  BadgeProps,
  ButtonProps,
  CheckboxProps,
  FieldProps,
  IconButtonProps,
  InputProps,
  MeterProps,
  ProgressBarProps,
  SearchBoxProps,
  SegmentedOption,
  SegmentedProps,
  SelectOption,
  SelectProps,
  SliderProps,
  SwitchProps,
  TextAreaProps,
  TooltipProps,
} from './primitives';
export {
  Badge,
  Button,
  Checkbox,
  Field,
  IconButton,
  Input,
  Meter,
  ProgressBar,
  SearchBox,
  Segmented,
  Select,
  Slider,
  Spinner,
  Switch,
  TextArea,
  Tooltip,
} from './primitives';

export type {
  AppFrameProps,
  BreadcrumbSegment,
  CardProps,
  DialogProps,
  EmptyStateProps,
  NavItemProps,
  PivotProps,
  PivotTab,
  SplitPaneProps,
  StatusItemProps,
} from './layout';
export {
  AppFrame,
  Breadcrumb,
  Card,
  Dialog,
  EmptyState,
  InfoBar,
  NavGroupLabel,
  NavItem,
  Pivot,
  Section,
  SplitPane,
  StatusItem,
  ToolbarSeparator,
  ToolbarSpacer,
} from './layout';

export type { Column, DataGridProps, KpiTileProps, SortState, TreeNode, TreeViewProps } from './data';
export { DataGrid, KpiTile, PropertyRow, TreeView } from './data';

export type { RailFit, SplitGeometry } from './responsive';
export { CONTENT_MIN, fitRails, splitGeometry, useElementWidth } from './responsive';

export type {
  BarChartProps,
  BarDatum,
  DonutChartProps,
  DonutSlice,
  LineChartProps,
  LineSeries,
  SparklineProps,
  WaterfallStep,
} from './charts';
export { BarChart, DonutChart, LineChart, Sparkline, StackedBar, Waterfall } from './charts';

export type { MenuBarMenu, MenuEntry, MenuFlyoutProps } from './menu';
export { MenuBar, MenuFlyout } from './menu';

export type { ContextMenuController, ContextMenuState } from './useContextMenu';
export { useContextMenu } from './useContextMenu';
