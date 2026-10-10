import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ColonyApp } from "./ColonyApp";
import "./colony.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ColonyApp />
  </StrictMode>,
);
