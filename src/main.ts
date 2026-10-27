import "./style.css";
import { mountApp } from "./ui/app.js";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("#app is missing");
}
mountApp(root);
