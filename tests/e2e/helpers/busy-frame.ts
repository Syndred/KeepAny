export function fixedFrameReadiness(samples: any[],frames: any[]){const i=samples.findIndex(s=>s.buttons.length>5&&s.buttons.every((b: any)=>b.disabled===true));if(i<0)return{ready:false,reason:'no-first-disabled'};const f=frames.findIndex(x=>x.metadata.timestamp*1000>samples[i].epochMs);if(f<0)return{ready:false,reason:'fixed-first-frame-not-arrived'};const a=samples.findIndex(s=>s.epochMs>frames[f].metadata.timestamp*1000);return a>0?{ready:true,frameIndex:f,afterIndex:a}:{ready:false,reason:'adjacent-after-not-arrived',frameIndex:f};}


export function selectFixedFrame(samples: any[],frames: any[]){
 if(samples.length<2||!samples.every((s,i)=>Number.isFinite(s.epochMs)&&(!i||s.epochMs>samples[i-1].epochMs)))throw Error('Invalid ordered DOM timeline');
 if(!frames.length||!frames.every((f,i)=>Number.isFinite(f.metadata?.timestamp)&&(!i||f.metadata.timestamp>=frames[i-1].metadata.timestamp)))throw Error('Invalid ordered native frame timestamps');
 const firstDisabledIndex=samples.findIndex(s=>s.buttons.length>5&&s.buttons.every((b: any)=>b.disabled===true));if(firstDisabledIndex<0)throw Error('No first fully disabled sample');
 const frameIndex=frames.findIndex(f=>f.metadata.timestamp*1000>samples[firstDisabledIndex].epochMs);if(frameIndex<0)throw Error('No fixed first native frame after disabled sample');
 const frame=frames[frameIndex],time=frame.metadata.timestamp*1000,afterIndex=samples.findIndex(s=>s.epochMs>time);if(afterIndex<=0)throw Error('Missing adjacent temporal bracket');
 const before=samples[afterIndex-1],after=samples[afterIndex];if(!(before.epochMs<=time&&time<after.epochMs))throw Error('Frame outside adjacent temporal bracket');
 if(![before,after].every(s=>s.buttons.length>5&&s.buttons.every((b: any)=>b.disabled===true)))throw Error('Fixed first frame adjacent DOM samples not both disabled');
 return{firstDisabledIndex,frameIndex,beforeIndex:afterIndex-1,afterIndex,before,after,frame};
}

