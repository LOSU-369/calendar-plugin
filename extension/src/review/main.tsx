import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewApp } from "../popup/ReviewApp";

document.documentElement.classList.add("review-page");
document.body.classList.add("review-page");

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ReviewApp mode="review" />
  </React.StrictMode>
);
