import React,{useEffect,useState} from 'react';
type Source={enabled:boolean;sourceMission:string;targetMission:string;origin:string;status:string;imported:number;error?:string};
export function MissionSourceStatus({missionId}:{missionId:string}){
 const [source,setSource]=useState<Source>();
 useEffect(()=>{let stop=false,timer:ReturnType<typeof setTimeout>;async function refresh(){try{const r=await fetch('/api/mission-source',{signal:AbortSignal.timeout(5000)});if(r.ok&&!stop)setSource(await r.json());}catch{if(!stop)setSource(s=>s?{...s,status:'disconnected',error:'Connection unavailable. Saved reports remain available.'}:s);}if(!stop)timer=setTimeout(refresh,2000);}void refresh();return()=>{stop=true;clearTimeout(timer);};},[]);
 if(!source?.enabled)return null;
 if(source.targetMission!==missionId)return <section className="panel" aria-label="Linked mission reports"><p>This page contains saved mission results. New source reports are followed in <a href={`/?incidentId=${encodeURIComponent(source.targetMission)}`}>{source.targetMission}</a>.</p></section>;
 return <section className="panel" aria-label="Linked mission reports"><p className="eyebrow">LINKED MISSION · READ-ONLY</p><h2>Following new reports from {source.sourceMission}</h2><p>{source.status==='following'?'Connected':'Waiting for the source mission'} · {source.imported} new reports imported</p><p>Band controls stay in the original mission. Earlier reports are excluded; new confirmed reports feed this mission’s AI action planner.</p><a href={`${source.origin}/?incidentId=${encodeURIComponent(source.sourceMission)}`} target="_blank" rel="noreferrer">Open source mission ↗</a>{source.error&&<p role="alert">{source.error}</p>}</section>;
}
