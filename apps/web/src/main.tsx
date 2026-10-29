import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";
import "./i18n";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./route-load-error.css";

createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<RouterProvider router={router} />
		<PwaUpdatePrompt />
	</React.StrictMode>,
);
