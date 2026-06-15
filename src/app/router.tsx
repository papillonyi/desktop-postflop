import { createBrowserRouter, Navigate } from "react-router";
import { App } from "./App";
import { AboutPage } from "../features/about/AboutPage";
import { BoardSelector } from "../features/board/BoardSelector";
import { BunchingEffect } from "../features/bunching/BunchingEffect";
import { RangeEditor } from "../features/ranges/RangeEditor";
import { ResultViewer } from "../features/results/ResultViewer";
import { RunSolver } from "../features/solver/RunSolver";
import { TreeConfig } from "../features/tree/TreeConfig";

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
        element: <BunchingEffect />,
      },
      {
        path: "solver/run",
        element: <RunSolver />,
      },
      { path: "results", element: <ResultViewer /> },
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <Navigate to="/solver/ranges/oop" replace /> },
    ],
  },
]);
