import {
  Book,
  BookOpen,
  BookOpenCheck,
  Bookmark,
  Camera,
  Check,
  ChevronRight,
  CircleCheck,
  createElement,
  Download,
  History,
  Image,
  Info,
  Languages,
  Layers,
  LoaderCircle,
  Menu,
  PenTool,
  RefreshCw,
  ScanText,
  SlidersHorizontal,
  Sparkles,
  Type,
  User,
  Volume1,
  Volume2,
  X,
} from "lucide";

// Only these icons are imported, so only their paths end up in the bundle (works offline).
const ICONS = {
  "book-open-check": BookOpenCheck,
  menu: Menu,
  x: X,
  camera: Camera,
  image: Image,
  "scan-text": ScanText,
  sparkles: Sparkles,
  loader: LoaderCircle,
  "refresh-cw": RefreshCw,
  type: Type,
  info: Info,
  "volume-2": Volume2,
  "volume-1": Volume1,
  bookmark: Bookmark,
  check: Check,
  "pen-tool": PenTool,
  book: Book,
  layers: Layers,
  user: User,
  history: History,
  languages: Languages,
  sliders: SlidersHorizontal,
  download: Download,
  "book-open": BookOpen,
  "check-circle": CircleCheck,
  "chevron-right": ChevronRight,
} as const;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function icon(name: IconName, opts: { size?: number; class?: string } = {}): SVGElement {
  const size = opts.size ?? 20;
  return createElement(ICONS[name], {
    width: size,
    height: size,
    "aria-hidden": "true",
    ...(opts.class ? { class: opts.class } : {}),
  });
}
