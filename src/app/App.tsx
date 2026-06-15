import { Outlet, useLocation } from "react-router";
import { NavBar } from "./layout/NavBar";
import { SideBar } from "./layout/SideBar";
import { selectHeaderForPath } from "./navigation";

export function App() {
  const location = useLocation();
  const isResults = location.pathname.startsWith("/results");
  const header = selectHeaderForPath(location.pathname);

  return (
    <div className="min-w-[1080px]" style={{ height: "100vh" }}>
      <NavBar />
      {isResults ? (
        <main style={{ height: "calc(max(100%, 720px) - 2.5rem)" }}>
          <Outlet />
        </main>
      ) : (
        <main
          className="flex w-full mx-auto max-w-screen-xl"
          style={{ height: "calc(100% - 2.5rem)" }}
        >
          <SideBar />
          <section
            className="flex-grow my-4 px-6 pt-2 overflow-y-auto"
            style={{ height: "calc(100% - 2rem)" }}
          >
            <div className="flex">
              <div className="mb-5 pl-2 pr-3 pb-0.5 text-lg font-bold border-l-8 border-b-2 border-blue-600 rounded rounded-br-none">
                {header}
              </div>
            </div>
            <Outlet />
          </section>
        </main>
      )}
    </div>
  );
}
