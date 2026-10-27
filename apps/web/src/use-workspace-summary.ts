import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { buildWorkspaceSummary } from "./workspace-summary";
import { useAppContext } from "./view-shared";

export function useWorkspaceSummary() {
	const { data } = useAppContext();
	const [today, setToday] = useState(() => format(new Date(), "yyyy-MM-dd"));
	useEffect(() => {
		const update = () => setToday(format(new Date(), "yyyy-MM-dd"));
		const timer = window.setInterval(update, 30_000);
		window.addEventListener("focus", update);
		document.addEventListener("visibilitychange", update);
		return () => { clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
	}, []);
	return useMemo(() => buildWorkspaceSummary({ assets: data.assets, tasks: data.tasks, history: data.history, relations: data.relations, today }),
		[data.assets, data.tasks, data.history, data.relations, today]);
}
