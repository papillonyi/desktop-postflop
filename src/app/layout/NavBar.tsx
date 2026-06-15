import { NavLink } from "react-router";
import { topRoutes } from "../navigation";

export function NavBar() {
  return (
    <nav className="h-10 bg-neutral-800 text-white">
      <div className="mx-auto flex h-full max-w-screen-xl items-center justify-between px-4">
        <div className="font-semibold">Desktop Postflop</div>
        <div className="flex h-full">
          {topRoutes.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              className={({ isActive }) =>
                [
                  "flex items-center gap-2 px-4 text-sm font-semibold transition-colors",
                  isActive ? "bg-neutral-950" : "hover:bg-neutral-700",
                ].join(" ")
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
