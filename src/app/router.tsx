import { createBrowserRouter, Navigate } from "react-router";
import { App } from "./App";
import { AboutPage } from "../features/about/AboutPage";
import { BoardSelector } from "../features/board/BoardSelector";
import { RangeEditor } from "../features/ranges/RangeEditor";
import { TreeConfig } from "../features/tree/TreeConfig";
import { PlaceholderPage } from "../shared/components/PlaceholderPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/solver/ranges/oop" replace /> },
      {
        path: "solver/ranges/oop",
        element: <RangeEditor player={0} />,
      },
      {
        path: "solver/ranges/ip",
        element: <RangeEditor player={1} />,
      },
      { path: "solver/board", element: <BoardSelector /> },
      {
        path: "solver/tree",
        element: <TreeConfig />,
      },
      {
        path: "solver/bunching",
        element: <PlaceholderPage title="Bunching Effect" />,
      },
      {
        path: "solver/run",
        element: <PlaceholderPage title="Run Solver" />,
      },
      { path: "results", element: <PlaceholderPage title="Results" /> },
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <Navigate to="/solver/ranges/oop" replace /> },
    ],
  },
]);
