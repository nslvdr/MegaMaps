import {
  ArrowRight,
  Bookmark,
  CaseSensitive,
  Check,
  ChevronLeft,
  Circle,
  CirclePlus,
  Contrast,
  Crosshair,
  DoorOpen,
  Download,
  Ellipsis,
  Flag,
  Folder,
  Layers,
  LockKeyhole,
  Map,
  MapPin,
  Merge,
  MessageSquareText,
  Moon,
  Move,
  Pencil,
  Plus,
  RotateCw,
  Route,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Split,
  Square,
  Sun,
  Trash,
  Undo2,
  X,
} from "lucide";
import type { MapMarker } from "../viewer/navigation";

// Serialize trusted library geometry without requiring a DOM at import time.
export const lucideMarkup = (nodes: typeof X) => nodes.map(([tag, attributes]) => {
  const attrs = Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}="${value}"`)
    .join(" ");
  return `<${tag} ${attrs}/>`;
}).join("");

// Inline library SVGs are bundled locally for offline use.
const svg = (nodes: typeof X) => {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${lucideMarkup(nodes)}</svg>`;
};

// One symbol per place kind, shared by pins, pickers, lists, and callouts.
export const placeSymbols = {
  landmark: Flag,
  entrance: DoorOpen,
  junction: Split,
  note: MessageSquareText,
} satisfies Record<MapMarker["kind"], typeof X>;

export const markerCalloutIcon = (kind: MapMarker["kind"]) =>
  svg(placeSymbols[kind] ?? placeSymbols.landmark);

export const icons = {
  search: svg(Search),
  map: svg(Map),
  plus: svg(Plus),
  add: svg(CirclePlus),
  share: svg(Share2),
  close: svg(X),
  invert: svg(Contrast),
  tools: svg(SlidersHorizontal),
  rotateRight: svg(RotateCw),
  arrow: svg(ChevronLeft),
  next: svg(ArrowRight),
  crosshair: svg(Crosshair),
  edit: svg(Pencil),
  more: svg(Ellipsis),
  move: svg(Move),
  trash: svg(Trash),
  check: svg(Check),
  folder: svg(Folder),
  moon: svg(Moon),
  layers: svg(Layers),
  saved: svg(Bookmark),
  sparkle: svg(Sparkles),
  undo: svg(Undo2),
  pin: svg(MapPin),
  route: svg(Route),
  sun: svg(Sun),
  text: svg(CaseSensitive),
  merge: svg(Merge),
  download: svg(Download),
  rotationLock: svg(LockKeyhole),
  routeStart: svg(Circle),
  routeEnd: svg(Square),
};
