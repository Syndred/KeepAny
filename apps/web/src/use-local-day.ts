import { useEffect, useState } from "react";
import { format } from "date-fns";

export function useLocalDay() {
 const [today, setToday] = useState(() => format(new Date(), "yyyy-MM-dd"));
 useEffect(() => {
  let timer: ReturnType<typeof setTimeout>;
  const update = () => {
   clearTimeout(timer);
   const now = new Date();
   setToday(format(now, "yyyy-MM-dd"));
   const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
   timer = setTimeout(update, Math.max(50, midnight.getTime() - now.getTime() + 50));
  };
  update(); window.addEventListener("focus", update); window.addEventListener("pageshow", update); document.addEventListener("visibilitychange", update);
  return () => { clearTimeout(timer); window.removeEventListener("focus", update); window.removeEventListener("pageshow", update); document.removeEventListener("visibilitychange", update); };
 }, []);
 return today;
}
