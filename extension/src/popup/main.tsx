import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewApp } from "./ReviewApp";

document.documentElement.classList.add("popup-page");
document.body.classList.add("popup-page");

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReviewApp mode="popup" />
  </React.StrictMode>
);
