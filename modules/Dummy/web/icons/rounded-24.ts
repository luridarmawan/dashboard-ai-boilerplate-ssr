/**
 * Glyph map for `dummy.rounded-24` (extension point 16). Same shape as a core set: every core
 * semantic name → a component. `modules:sync` fails the build if a name is missing (L-5).
 */

import ArrowLeftGlyph from '@lucide/svelte/icons/arrow-left';
import ArrowRightGlyph from '@lucide/svelte/icons/arrow-right';
import SortGlyph from '@lucide/svelte/icons/arrow-up-down';
import BellGlyph from '@lucide/svelte/icons/bell';
import BookmarkGlyph from '@lucide/svelte/icons/bookmark';
import BuildingGlyph from '@lucide/svelte/icons/building-2';
import CalendarGlyph from '@lucide/svelte/icons/calendar';
import ChartBarGlyph from '@lucide/svelte/icons/chart-bar';
import ChartLineGlyph from '@lucide/svelte/icons/chart-line';
import ChartPieGlyph from '@lucide/svelte/icons/chart-pie';
import CheckGlyph from '@lucide/svelte/icons/check';
import ChevronDownGlyph from '@lucide/svelte/icons/chevron-down';
import ChevronLeftGlyph from '@lucide/svelte/icons/chevron-left';
import ChevronRightGlyph from '@lucide/svelte/icons/chevron-right';
import ChevronUpGlyph from '@lucide/svelte/icons/chevron-up';
import SuccessGlyph from '@lucide/svelte/icons/circle-check';
import HelpGlyph from '@lucide/svelte/icons/circle-question-mark';
import ErrorGlyph from '@lucide/svelte/icons/circle-x';
import ClockGlyph from '@lucide/svelte/icons/clock';
import ColumnsGlyph from '@lucide/svelte/icons/columns-3';
import CopyGlyph from '@lucide/svelte/icons/copy';
import DatabaseGlyph from '@lucide/svelte/icons/database';
import DownloadGlyph from '@lucide/svelte/icons/download';
import MoreHorizontalGlyph from '@lucide/svelte/icons/ellipsis';
import MoreVerticalGlyph from '@lucide/svelte/icons/ellipsis-vertical';
import ExternalLinkGlyph from '@lucide/svelte/icons/external-link';
import EyeGlyph from '@lucide/svelte/icons/eye';
import EyeOffGlyph from '@lucide/svelte/icons/eye-off';
import FileGlyph from '@lucide/svelte/icons/file';
import FolderGlyph from '@lucide/svelte/icons/folder';
import FilterGlyph from '@lucide/svelte/icons/funnel';
import HomeGlyph from '@lucide/svelte/icons/house';
import ImageGlyph from '@lucide/svelte/icons/image';
import InfoGlyph from '@lucide/svelte/icons/info';
import KeyGlyph from '@lucide/svelte/icons/key';
import LanguageGlyph from '@lucide/svelte/icons/languages';
import DashboardGlyph from '@lucide/svelte/icons/layout-dashboard';
import GridGlyph from '@lucide/svelte/icons/layout-grid';
import LinkGlyph from '@lucide/svelte/icons/link';
import ListGlyph from '@lucide/svelte/icons/list';
import LoaderGlyph from '@lucide/svelte/icons/loader-circle';
import LockGlyph from '@lucide/svelte/icons/lock';
import UnlockGlyph from '@lucide/svelte/icons/lock-open';
import LoginGlyph from '@lucide/svelte/icons/log-in';
import LogoutGlyph from '@lucide/svelte/icons/log-out';
import MailGlyph from '@lucide/svelte/icons/mail';
import ExpandGlyph from '@lucide/svelte/icons/maximize-2';
import MenuGlyph from '@lucide/svelte/icons/menu';
import CollapseGlyph from '@lucide/svelte/icons/minimize-2';
import MinusGlyph from '@lucide/svelte/icons/minus';
import MonitorGlyph from '@lucide/svelte/icons/monitor';
import MoonGlyph from '@lucide/svelte/icons/moon';
import PaletteGlyph from '@lucide/svelte/icons/palette';
import PauseGlyph from '@lucide/svelte/icons/pause';
import EditGlyph from '@lucide/svelte/icons/pencil';
import PlayGlyph from '@lucide/svelte/icons/play';
import PlugGlyph from '@lucide/svelte/icons/plug';
import PlusGlyph from '@lucide/svelte/icons/plus';
import PuzzleGlyph from '@lucide/svelte/icons/puzzle';
import RefreshGlyph from '@lucide/svelte/icons/refresh-cw';
import SwitchGlyph from '@lucide/svelte/icons/repeat';
import SaveGlyph from '@lucide/svelte/icons/save';
import SearchGlyph from '@lucide/svelte/icons/search';
import SendGlyph from '@lucide/svelte/icons/send';
import ServerGlyph from '@lucide/svelte/icons/server';
import SettingsGlyph from '@lucide/svelte/icons/settings';
import ShieldGlyph from '@lucide/svelte/icons/shield';
import SparklesGlyph from '@lucide/svelte/icons/sparkles';
import StopGlyph from '@lucide/svelte/icons/square';
import StarGlyph from '@lucide/svelte/icons/star';
import SunGlyph from '@lucide/svelte/icons/sun';
import TagGlyph from '@lucide/svelte/icons/tag';
import TrashGlyph from '@lucide/svelte/icons/trash';
import WarningGlyph from '@lucide/svelte/icons/triangle-alert';
import UploadGlyph from '@lucide/svelte/icons/upload';
import UserGlyph from '@lucide/svelte/icons/user';
import UsersGlyph from '@lucide/svelte/icons/users';
import GroupGlyph from '@lucide/svelte/icons/users-round';
import CloseGlyph from '@lucide/svelte/icons/x';
import XGlyph from '@lucide/svelte/icons/x';
import type { Component } from 'svelte';

export const glyphs: Record<string, Component<Record<string, unknown>>> = {
  menu: MenuGlyph as unknown as Component<Record<string, unknown>>,
  close: CloseGlyph as unknown as Component<Record<string, unknown>>,
  search: SearchGlyph as unknown as Component<Record<string, unknown>>,
  settings: SettingsGlyph as unknown as Component<Record<string, unknown>>,
  user: UserGlyph as unknown as Component<Record<string, unknown>>,
  users: UsersGlyph as unknown as Component<Record<string, unknown>>,
  group: GroupGlyph as unknown as Component<Record<string, unknown>>,
  building: BuildingGlyph as unknown as Component<Record<string, unknown>>,
  home: HomeGlyph as unknown as Component<Record<string, unknown>>,
  dashboard: DashboardGlyph as unknown as Component<Record<string, unknown>>,
  'chevron-right': ChevronRightGlyph as unknown as Component<Record<string, unknown>>,
  'chevron-left': ChevronLeftGlyph as unknown as Component<Record<string, unknown>>,
  'chevron-down': ChevronDownGlyph as unknown as Component<Record<string, unknown>>,
  'chevron-up': ChevronUpGlyph as unknown as Component<Record<string, unknown>>,
  'arrow-left': ArrowLeftGlyph as unknown as Component<Record<string, unknown>>,
  'arrow-right': ArrowRightGlyph as unknown as Component<Record<string, unknown>>,
  'external-link': ExternalLinkGlyph as unknown as Component<Record<string, unknown>>,
  plus: PlusGlyph as unknown as Component<Record<string, unknown>>,
  minus: MinusGlyph as unknown as Component<Record<string, unknown>>,
  edit: EditGlyph as unknown as Component<Record<string, unknown>>,
  trash: TrashGlyph as unknown as Component<Record<string, unknown>>,
  save: SaveGlyph as unknown as Component<Record<string, unknown>>,
  copy: CopyGlyph as unknown as Component<Record<string, unknown>>,
  download: DownloadGlyph as unknown as Component<Record<string, unknown>>,
  upload: UploadGlyph as unknown as Component<Record<string, unknown>>,
  filter: FilterGlyph as unknown as Component<Record<string, unknown>>,
  sort: SortGlyph as unknown as Component<Record<string, unknown>>,
  refresh: RefreshGlyph as unknown as Component<Record<string, unknown>>,
  switch: SwitchGlyph as unknown as Component<Record<string, unknown>>,
  'more-horizontal': MoreHorizontalGlyph as unknown as Component<Record<string, unknown>>,
  'more-vertical': MoreVerticalGlyph as unknown as Component<Record<string, unknown>>,
  check: CheckGlyph as unknown as Component<Record<string, unknown>>,
  x: XGlyph as unknown as Component<Record<string, unknown>>,
  info: InfoGlyph as unknown as Component<Record<string, unknown>>,
  warning: WarningGlyph as unknown as Component<Record<string, unknown>>,
  error: ErrorGlyph as unknown as Component<Record<string, unknown>>,
  success: SuccessGlyph as unknown as Component<Record<string, unknown>>,
  help: HelpGlyph as unknown as Component<Record<string, unknown>>,
  lock: LockGlyph as unknown as Component<Record<string, unknown>>,
  unlock: UnlockGlyph as unknown as Component<Record<string, unknown>>,
  key: KeyGlyph as unknown as Component<Record<string, unknown>>,
  shield: ShieldGlyph as unknown as Component<Record<string, unknown>>,
  eye: EyeGlyph as unknown as Component<Record<string, unknown>>,
  'eye-off': EyeOffGlyph as unknown as Component<Record<string, unknown>>,
  bell: BellGlyph as unknown as Component<Record<string, unknown>>,
  mail: MailGlyph as unknown as Component<Record<string, unknown>>,
  calendar: CalendarGlyph as unknown as Component<Record<string, unknown>>,
  clock: ClockGlyph as unknown as Component<Record<string, unknown>>,
  file: FileGlyph as unknown as Component<Record<string, unknown>>,
  folder: FolderGlyph as unknown as Component<Record<string, unknown>>,
  image: ImageGlyph as unknown as Component<Record<string, unknown>>,
  link: LinkGlyph as unknown as Component<Record<string, unknown>>,
  logout: LogoutGlyph as unknown as Component<Record<string, unknown>>,
  login: LoginGlyph as unknown as Component<Record<string, unknown>>,
  sun: SunGlyph as unknown as Component<Record<string, unknown>>,
  moon: MoonGlyph as unknown as Component<Record<string, unknown>>,
  monitor: MonitorGlyph as unknown as Component<Record<string, unknown>>,
  palette: PaletteGlyph as unknown as Component<Record<string, unknown>>,
  language: LanguageGlyph as unknown as Component<Record<string, unknown>>,
  grid: GridGlyph as unknown as Component<Record<string, unknown>>,
  list: ListGlyph as unknown as Component<Record<string, unknown>>,
  columns: ColumnsGlyph as unknown as Component<Record<string, unknown>>,
  expand: ExpandGlyph as unknown as Component<Record<string, unknown>>,
  collapse: CollapseGlyph as unknown as Component<Record<string, unknown>>,
  star: StarGlyph as unknown as Component<Record<string, unknown>>,
  bookmark: BookmarkGlyph as unknown as Component<Record<string, unknown>>,
  tag: TagGlyph as unknown as Component<Record<string, unknown>>,
  'chart-bar': ChartBarGlyph as unknown as Component<Record<string, unknown>>,
  'chart-line': ChartLineGlyph as unknown as Component<Record<string, unknown>>,
  'chart-pie': ChartPieGlyph as unknown as Component<Record<string, unknown>>,
  database: DatabaseGlyph as unknown as Component<Record<string, unknown>>,
  server: ServerGlyph as unknown as Component<Record<string, unknown>>,
  plug: PlugGlyph as unknown as Component<Record<string, unknown>>,
  puzzle: PuzzleGlyph as unknown as Component<Record<string, unknown>>,
  sparkles: SparklesGlyph as unknown as Component<Record<string, unknown>>,
  send: SendGlyph as unknown as Component<Record<string, unknown>>,
  stop: StopGlyph as unknown as Component<Record<string, unknown>>,
  play: PlayGlyph as unknown as Component<Record<string, unknown>>,
  pause: PauseGlyph as unknown as Component<Record<string, unknown>>,
  loader: LoaderGlyph as unknown as Component<Record<string, unknown>>,
};
