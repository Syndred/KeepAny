// Date-only values are Gregorian calendar dates, independent of the host time zone.
// Local Date and date-fns calendar operations can skip a date (for example, Apia 2011-12-30).
function calendarDate(year:number,month:number,day:number){
 const date=new Date(0);
 date.setUTCHours(0,0,0,0);
 date.setUTCFullYear(year,month,day);
 return date;
}
export function parseDateOnly(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid-date');
 const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
 const date=calendarDate(year,month-1,day);
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('invalid-date');
 return date;
}
export function validDateOnly(value:string){try{parseDateOnly(value);return true;}catch{return false;}}
function formatDateOnly(date:Date){
 if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<0||date.getUTCFullYear()>9999)throw Error('invalid-date');
 return `${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
export function calendarDayDistance(from:string,to:string){return (parseDateOnly(to).getTime()-parseDateOnly(from).getTime())/86_400_000;}
// Recalculate from the original anchor, so a January 31 monthly bill returns to March 31 after February.
export function dueOnCycle(anchor:string,cycle: "month" | "year" | "week" | "day",interval:number,periods:number){
  if(!Number.isInteger(periods)||periods<0||!Number.isInteger(interval)||interval<1)throw Error('invalid-period');
  const date=parseDateOnly(anchor);
  const count=interval*periods;
  if(!Number.isSafeInteger(count))throw Error('invalid-period');
  if(cycle==='month'||cycle==='year'){
    const months=count*(cycle==='year'?12:1);
    if(!Number.isSafeInteger(months))throw Error('invalid-period');
    const targetMonth=date.getUTCMonth()+months;
    const year=date.getUTCFullYear()+Math.floor(targetMonth/12);
    const month=targetMonth%12;
    const lastDay=calendarDate(year,month+1,0).getUTCDate();
    return formatDateOnly(calendarDate(year,month,Math.min(date.getUTCDate(),lastDay)));
  }
  const days=count*(cycle==='week'?7:1);
  if(!Number.isSafeInteger(days))throw Error('invalid-period');
  date.setUTCDate(date.getUTCDate()+days);
  return formatDateOnly(date);
}
