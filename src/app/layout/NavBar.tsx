import { NavLink } from "react-router";
import { topRoutes } from "../navigation";

export function NavBar() {
  return (
    <nav className="h-10 bg-neutral-800 text-white">
      <div className="mx-auto flex h-full max-w-screen-xl items-center justify-between px-2 sm:px-4">
        <div className="shrink-0 font-semibold">
          <span className="hidden sm:inline">Desktop Postflop</span>
          <span className="sm:hidden">Postflop</span>
        </div>
        <div className="flex h-full min-w-0">
          {topRoutes.map(({ path, label, icon: Icon }) => (
            <NavLink
              aria-label={label}
              key={path}
              to={path}
              title={label}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 px-2 text-sm font-semibold transition-colors sm:px-4",
                  isActive ? "bg-neutral-950" : "hover:bg-neutral-700",
                ].join(" ")
              }
            >
              <Icon className="h-5 w-5" />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
