import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router";
import { store } from "./store";
import { router } from "./router";
import "../style.css";

ReactDOM.createRoot(document.getElementById("app")!).render(
  <Provider store={store}>
    <RouterProvider router={router} />
  </Provider>
);

document.addEventListener("contextmenu", (event) => event.preventDefault());
