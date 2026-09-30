import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { clsx } from "clsx";
import "./task-card.css";

export function TaskCard({ className, ...props }: HTMLMotionProps<"article">) {
	const reduced = useReducedMotion();
	return <motion.article className={clsx("task-card", className)} initial={reduced ? false : { y: 5 }} animate={{ y: 0 }} transition={{ duration: reduced ? 0 : 0.18 }} {...props} />;
}

export function TaskReveal({ children }: { children: React.ReactNode }) {
	const reduced = useReducedMotion();
	return <motion.div initial={reduced ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduced ? 0 : 0.16 }}>{children}</motion.div>;
}
