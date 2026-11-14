import {spawn, type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdirSync, appendFileSync, readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {HttpError} from './store.js';

type Status = 'idle'|'connecting'|'listening'|'reconnecting'|'stopping'|'stopped'|'error';
export type BandState = {
  status: Status; bandNumber: number; incidentId?: string; speaker?: string; startedAt?: string;
  receivedPackets: number; queuedReports: number; acknowledgedReports: number;
  pendingReports: number; silenceSegments: number; lastReportAt?: string; lastError?: string; pid?: number;
};

export class BandSession {
  private child?: ChildProcess;
  private state: BandState;
  private lines = '';
  constructor(private directory: string, private mode: string, private launch = spawn) {
    this.state = this.empty();
    // Operational metadata is not an incident. Keep it out of Store.resume's
    // top-level mission snapshots, migrating only our own legacy state shape.
    const metadata=resolve(directory,'.band');
    mkdirSync(metadata,{recursive:true,mode:0o700});
    const file=resolve(metadata,'session-state.json'),legacy=resolve(directory,'band-session-state.json');
    if(!existsSync(file)&&existsSync(legacy)){
      const saved=JSON.parse(readFileSync(legacy,'utf8'));
      if(typeof saved.status==='string'&&typeof saved.bandNumber==='number'&&typeof saved.receivedPackets==='number'&&!saved.observations)
        renameSync(legacy,file);
    }
    try {
      const saved=JSON.parse(readFileSync(file,'utf8')) as BandState;
      if(saved.bandNumber===this.state.bandNumber&&saved.incidentId&&saved.speaker){
        this.state={...saved,status:'stopped'};delete this.state.pid;
        this.state.lastError=saved.pendingReports?'Saved reports need delivery. Retry them before starting a new session.':undefined;
      }
    }catch {/* First start has no prior session. */}
  }
  private persist(){
    const file=resolve(this.directory,'.band','session-state.json'),temp=file+'.part';
    writeFileSync(temp,JSON.stringify(this.state),{mode:0o600});renameSync(temp,file);
  }
  private empty(): BandState {
    return {status:'idle',bandNumber:Number(process.env.VEXO_BAND_NUMBER)||0,receivedPackets:0,
      queuedReports:0,acknowledgedReports:0,pendingReports:0,silenceSegments:0};
  }
  snapshot() {return {...this.state};}
  start(incidentId: string, speaker: string, drainOnly=false) {
    if(this.child) throw new HttpError(409,'A band session is already active. Stop it before starting another.');
    if(this.state.pendingReports&&!drainOnly)throw new HttpError(409,'Retry the saved reports before starting another session.');
    const number=Number(process.env.VEXO_BAND_NUMBER);
    if(!Number.isInteger(number)||number<1||number>999)throw new HttpError(503,'Configure your assigned band number before listening.');
    if(this.mode!=='gemini'||!process.env.GEMINI_API_KEY||!process.env.GEMINI_MODEL)
      throw new HttpError(503,'Configure Gemini before starting band listening.');
    this.state={...(drainOnly?this.state:this.empty()),status:drainOnly?'stopping':'connecting',incidentId,speaker};this.lines='';
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    this.persist();
    const env: NodeJS.ProcessEnv={...process.env, PYTHONDONTWRITEBYTECODE:'1',VEXO_PARENT_PID:String(process.pid),
      COPILOT_URL:`http://127.0.0.1:${process.env.PORT||3001}`};
    delete env.VEXO_STATUS_FILE; // Manager consumes metadata directly, not a shared status path.
    const child=this.launch(process.env.VEXO_PYTHON||'python3',[
      resolve('scripts/vexo-live.py'),'--provider','gemini','--capture-mode','continuous',
      '--continuous-seconds','20','--seconds','0','--incident-id',incidentId,'--speaker',speaker,
      drainOnly?'--drain-only':'--confirm-capture','--spool-dir',resolve(this.directory,'vexo-live'),
    ],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe'],shell:false});
    this.child=child;this.state.pid=child.pid;
    child.stdout?.on('data',(chunk:Buffer)=>{
      this.lines+=chunk.toString();let newline;
      while((newline=this.lines.indexOf('\n'))>=0){
        const line=this.lines.slice(0,newline);this.lines=this.lines.slice(newline+1);
        try {const event=JSON.parse(line);this.observe(event);
          appendFileSync(resolve(this.directory,'band-session-events.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});
        } catch { /* Non-JSON SDK diagnostics never become transcript or app instructions. */ }
      }
      if(this.lines.length>65536)this.lines='';
    });
    // Do not expose SDK/provider stderr or inherited secrets through an API.
    child.stderr?.on('data',()=>{});
    child.on('error',()=>{if(this.child===child)this.child=undefined;delete this.state.pid;this.state.status='error';this.state.lastError='Band process could not start. Check the configured Python and SDK installation.';this.persist();});
    child.on('exit',(code)=>{
      if(this.child!==child)return;
      this.child=undefined;delete this.state.pid;
      if((code===0||this.state.status==='stopping')&&this.state.status!=='error')this.state.status='stopped';
      else {this.state.status='error';this.state.lastError??='Band listening stopped unexpectedly. Queued reports remain saved; check the band and restart.';}
      this.persist();
    });
    return this.snapshot();
  }
  stop() {
    if(this.child){this.state.status='stopping';this.child.kill('SIGTERM');}
    return this.snapshot();
  }
  retry(){
    if(!this.state.incidentId||!this.state.speaker||!this.state.pendingReports)throw new HttpError(409,'There are no saved band reports to retry.');
    return this.start(this.state.incidentId,this.state.speaker,true);
  }
  observe(event: {event?:string;at?:string;packets?:number;pending?:number;result?:string;code?:string}) {
    if(typeof event.pending==='number')this.state.pendingReports=event.pending;
    switch(event.event){
      case 'microphone_capture_started':this.state.status='listening';this.state.startedAt=event.at;break;
      case 'audio_totals':if(typeof event.packets==='number')this.state.receivedPackets=event.packets;break;
      case 'band_reconnecting':this.state.status='reconnecting';break;
      case 'band_reconnected':this.state.status='listening';break;
      case 'turn_buffered':this.state.queuedReports++;break;
      case 'turn_acknowledged':
        if(event.result==='silence')this.state.silenceSegments++;
        else {this.state.acknowledgedReports++;this.state.lastReportAt=event.at;}
        this.state.lastError=undefined;break;
      case 'backend_retry':this.state.lastError='Delivery is retrying. Audio remains queued locally.';break;
      case 'microphone_off_delivery_pending':if(this.state.status!=='error')this.state.status='stopping';break;
      case 'bridge_stopped':if(this.state.status!=='error')this.state.status='stopped';break;
      case 'audio_packet_gap':this.state.lastError='A Bluetooth audio gap occurred. Review any report spanning the gap.';break;
      case 'delivery_backlog_full':this.state.status='error';this.state.lastError='Delivery cannot keep up. Microphone stopped before the local queue filled; queued reports remain saved.';break;
      case 'bridge_start_failed':this.state.status='error';this.state.lastError=event.code==='not-found-nearby'
        ?'Band not found. Close other band clients, double-tap your band until it blinks blue, then start again.'
        :'Band could not start. Check the assigned band, SDK and local outbox.';break;
      case 'stream_taken':case 'audio_processing_failed':case 'backend_rejected':case 'packet_buffer_full':
        this.state.status='error';this.state.lastError='Listening stopped to protect the recording. Check the band connection and queued reports before restarting.';break;
    }
    this.persist();
  }
}
