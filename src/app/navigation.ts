import type { ComponentType } from "react";
import {
  AcademicCapIcon,
  BeakerIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ComputerDesktopIcon,
  InformationCircleIcon,
  PlayCircleIcon,
  RectangleGroupIcon,
  ServerStackIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/solid";

export type SolverRoute = {
  path: string;
  label: string;
  header: string;
  icon: ComponentType<{ className?: string }>;
};

export const solverRoutes: SolverRoute[] = [
  {
    path: "/solver/ranges/oop",
    label: "OOP Range",
    header: "OOP Range",
    icon: RectangleGroupIcon,
  },
  {
    path: "/solver/ranges/ip",
    label: "IP Range",
    header: "IP Range",
    icon: RectangleGroupIcon,
  },
  {
    path: "/solver/board",
    label: "Board",
    header: "Board",
    icon: Squares2X2Icon,
  },
  {
    path: "/solver/tree",
    label: "Tree Configuration",
    header: "Tree Configuration",
    icon: Cog6ToothIcon,
  },
  {
    path: "/solver/bunching",
    label: "Bunching Effect",
    header: "Bunching Effect",
    icon: BeakerIcon,
  },
  {
    path: "/solver/run",
    label: "Run Solver",
    header: "Run Solver",
    icon: PlayCircleIcon,
  },
  {
    path: "/server",
    label: "Server",
    header: "Server",
    icon: ServerStackIcon,
  },
  {
    path: "/about",
    label: "About",
    header: "About",
    icon: InformationCircleIcon,
  },
];

export const topRoutes = [
  { path: "/solver/ranges/oop", label: "Solver", icon: ComputerDesktopIcon },
  { path: "/results", label: "Results", icon: ChartBarIcon },
  { path: "/training", label: "Training", icon: AcademicCapIcon },
];

export function selectHeaderForPath(pathname: string) {
  if (pathname.startsWith("/results")) return "Results";
  if (pathname.startsWith("/training")) return "Training";
  return (
    solverRoutes.find((route) => route.path === pathname)?.header ?? "OOP Range"
  );
}
