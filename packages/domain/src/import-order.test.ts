import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

// Fresh processes exercise real ESM initialization rather than a warmed module cache.
it.each(["task-repeat", "task-reminder", "index"])("initializes schemas when %s loads first", (entry) => {
	const first = new URL(`./${entry}.ts`, import.meta.url).href;
	const domain = new URL("./index.ts", import.meta.url).href;
	const repeat = new URL("./task-repeat.ts", import.meta.url).href;
	const reminder = new URL("./task-reminder.ts", import.meta.url).href;
	const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
await import(${JSON.stringify(first)});
const domain = await import(${JSON.stringify(domain)});
const repeat = await import(${JSON.stringify(repeat)});
const reminder = await import(${JSON.stringify(reminder)});
const schedule = repeat.createMaintenanceSchedule({dueDate:"2026-11-08",leadDays:2,rule:{mode:"fixed",unit:"month",every:1}});
const task = domain.taskSchema.parse({id:"order-check",name:"Fictional inspection",assetId:"fictional-item",dueDate:schedule.dueDate,createdAt:"2026-11-05T00:00:00Z",maintenancePlan:{active:true,schedule,records:[],deferredUntil:""}});
if(task.maintenancePlan.schedule.dueDate !== "2026-11-08" || reminder.taskReminderSchema.safeParse({}).success) throw Error("Schema initialization contract changed");
console.log(domain.dueOnCycle("2026-01-31","month",1,2));
`], { encoding: "utf8" });
	expect(output.trim()).toBe("2026-03-31");
});
