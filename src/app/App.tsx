import { Outlet, useLocation } from "react-router";
import { NavBar } from "./layout/NavBar";
import { SideBar } from "./layout/SideBar";
import { selectHeaderForPath } from "./navigation";

export function App() {
  const location = useLocation();
  const isResults = location.pathname.startsWith("/results");
  const isTraining = location.pathname.startsWith("/training");
  const header = selectHeaderForPath(location.pathname);
  const appClassName = isTraining
    ? "min-w-0 lg:min-w-[1080px]"
    : "min-w-[1080px]";
  const sectionClassName = isTraining
    ? "min-w-0 flex-grow overflow-y-auto px-0 pt-0 lg:my-4 lg:h-[calc(100%_-_2rem)] lg:px-6 lg:pt-2"
    : "flex-grow my-4 px-6 pt-2 overflow-y-auto";

  return (
    <div className={appClassName} style={{ height: "100vh" }}>
      <NavBar />
      {isResults ? (
        <main style={{ height: "calc(max(100%, 720px) - 2.5rem)" }}>
          <Outlet />
        </main>
      ) : (
        <main
          className="mx-auto flex w-full max-w-screen-xl"
          style={{ height: "calc(100% - 2.5rem)" }}
        >
          {isTraining ? (
            <div className="hidden lg:block">
              <SideBar />
            </div>
          ) : (
            <SideBar />
          )}
          <section
            className={sectionClassName}
            style={isTraining ? undefined : { height: "calc(100% - 2rem)" }}
          >
            <div className={isTraining ? "hidden lg:flex" : "flex"}>
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
