import { NavLink, useLocation } from "react-router";
import { solverRoutes } from "../navigation";

export function SideBar() {
  const location = useLocation();

  return (
    <aside
      className="my-4 w-56 shrink-0 overflow-y-auto border-r border-gray-200 pr-3"
      style={{ height: "calc(100% - 2rem)" }}
    >
      <div className="flex flex-col gap-1">
        {solverRoutes.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <NavLink
              key={path}
              to={path}
              className={[
                "flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition-colors",
                active
                  ? "bg-blue-100 text-blue-800"
                  : "text-gray-700 hover:bg-gray-100",
              ].join(" ")}
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          );
        })}
      </div>
    </aside>
  );
}
