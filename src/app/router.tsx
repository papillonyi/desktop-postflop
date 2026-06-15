import { createBrowserRouter, Navigate } from "react-router";
import { App } from "./App";
import { AboutPage } from "../features/about/AboutPage";
import { PlaceholderPage } from "../shared/components/PlaceholderPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/solver/ranges/oop" replace /> },
      {
        path: "solver/ranges/oop",
        element: <PlaceholderPage title="OOP Range" />,
      },
      {
        path: "solver/ranges/ip",
        element: <PlaceholderPage title="IP Range" />,
      },
      { path: "solver/board", element: <PlaceholderPage title="Board" /> },
      {
        path: "solver/tree",
        element: <PlaceholderPage title="Tree Configuration" />,
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
