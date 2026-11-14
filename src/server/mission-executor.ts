import {randomUUID} from 'node:crypto';
import type {Incident, MissionAction} from '../shared/model.js';
import {ticketReceiptSchema, followUpReceiptSchema} from '../shared/test-dispatch.js';
import {Store,HttpError} from './store.js';
import {audit} from './orchestrator.js';
import {receiptDecisionSchema,type MissionTools} from './mission-tools.js';

export class MissionExecutor {
  private tasks=new Map<string,Promise<void>>();
  private stopped=false;
  constructor(private store:Store,private tools:MissionTools){}
  wake(state:Incident){
    if(this.stopped)return;
    for(const a of state.actions){
      if(a.kind!=='test_request'||!['queued','executing'].includes(a.status))continue;
      const key=`${state.id}:${a.id}`;if(this.tasks.has(key))continue;
      const task=Promise.resolve().then(()=>this.execute(state.id,a.id)).catch(error=>console.error('Mission execution progress could not be persisted:',error instanceof Error?error.message:'storage failure')).finally(()=>this.tasks.delete(key));
      this.tasks.set(key,task);
    }
  }
  async idle(){while(this.tasks.size)await Promise.all([...this.tasks.values()]);}
  async close(){this.stopped=true;await this.idle();}
  private async action(mission:string,id:string){const state=await this.store.get(mission);return {state,action:state.actions.find(a=>a.id===id)};}
  private async change(mission:string,id:string,fn:(state:Incident,a:MissionAction)=>void){
    return this.store.mutate(mission,state=>{const a=state.actions.find(x=>x.id===id);if(a?.testExecution) {const before=JSON.stringify(a);fn(state,a);if(JSON.stringify(a)!==before)a.updatedAt=new Date().toISOString();}});
  }
  async retry(mission:string,id:string){
    const {action}=await this.action(mission,id);if(!action?.testExecution)throw new HttpError(404,'Test mission action not found.');
    const parent=action.testExecution.parentActionId??id;
    const state=await this.change(mission,parent,(state,a)=>{
      if(a.status!=='failed')return;
      if(a.testExecution!.destination!==this.tools.destination)throw new HttpError(409,'Restore the original test destination before retrying.');
      a.status='executing';delete a.testExecution!.error;
      a.testExecution!.phase=a.testExecution!.ticket?'planning_follow_up':'submitting';
      const child=state.actions.find(x=>x.id===a.testExecution!.followUpActionId);
      if(child){child.status='executing';delete child.testExecution!.error;child.testExecution!.phase='following_up';}
      audit(state,'dispatcher','Retrying the saved test action with its original request identity and payload.',a.id);
    });
    const running=this.tasks.get(`${mission}:${parent}`);
    if(running)void running.then(async()=>this.wake(await this.store.get(mission)));else this.wake(state);
    return state;
  }
  private async execute(mission:string,id:string){
    try{
      let {state,action}=await this.action(mission,id);
      if(!action?.testExecution||!['queued','executing'].includes(action.status))return;
      if(action.testExecution.destination!==this.tools.destination)throw Error('Test destination changed; restore original configuration.');
      if(action.status==='queued'){
        await this.change(mission,id,(current,a)=>{
          if(current.version!==a.testExecution!.plannedVersion){a.status='dismissed';a.testExecution!.phase='cancelled';audit(current,'coordinator','Mission changed before this test request started. No submission was made.',id);return;}
          a.status='executing';a.testExecution!.phase='submitting';audit(current,'dispatcher','Submitting the AI-selected mission action to the controlled test desk.',id);
        });
        ({state,action}=await this.action(mission,id));if(action?.status!=='executing')return;
      }
      if(!action.testExecution!.ticket){
        const receipt=ticketReceiptSchema.parse(await this.tools.submit(mission,action));
        if(receipt.runId!==id||receipt.missionId!==mission||receipt.title!==action.title||receipt.detail!==action.detail)throw Error('Test ticket receipt does not match the planned mission action.');
        const readback=ticketReceiptSchema.parse(await this.tools.readTicket(receipt.id));
        if(JSON.stringify(readback)!==JSON.stringify(receipt))throw Error('Test ticket could not be verified at the destination.');
        await this.change(mission,id,(current,a)=>{a.testExecution!.ticket=readback;a.testExecution!.phase='planning_follow_up';audit(current,'service',`Test desk confirmed ticket ${receipt.id}. The receipt agent may now use this result.`,id);});
      }
      ({state,action}=await this.action(mission,id));if(!action?.testExecution?.ticket||action.status!=='executing')return;
      // The second agent receives a freshly verified receipt, not a simulated acknowledgment.
      const verified=ticketReceiptSchema.parse(await this.tools.readTicket(action.testExecution.ticket.id));
      if(JSON.stringify(verified)!==JSON.stringify(action.testExecution.ticket))throw Error('Confirmed ticket changed; downstream action stopped.');
      if(!action.testExecution.followUpActionId){
        let committed=false;
        for(let attempt=0;attempt<3&&!committed;attempt++){
          ({state,action}=await this.action(mission,id));if(!action?.testExecution||action.status!=='executing')return;
          const version=state.version;
          const decision=receiptDecisionSchema.parse(await this.tools.decide(state,action,verified));
          if(decision.sourceReceiptId!==verified.id||!decision.message.includes(verified.id))throw Error('Receipt agent did not bind its follow-up to the verified receipt.');
          await this.change(mission,id,(current,a)=>{
            if(current.version!==version||a.status!=='executing')return;
            if(a.testExecution!.followUpActionId){committed=true;return;}
            const now=new Date().toISOString(),child:MissionAction={id:randomUUID(),kind:'test_follow_up',service:'test_desk',title:'Record confirmed-ticket follow-up',detail:decision.message,sourceObservationIds:[...a.sourceObservationIds],status:'executing',createdAt:now,updatedAt:now,testExecution:{destination:this.tools.destination,plannedVersion:version,planner:'gemini',phase:'following_up',parentActionId:id,sourceReceiptId:decision.sourceReceiptId}};
            current.actions.push(child);a.testExecution!.followUpActionId=child.id;a.testExecution!.phase='following_up';
            audit(current,'coordinator',`Gemini receipt agent used confirmed ticket ${verified.id} and current mission context to plan this follow-up.`,child.id);committed=true;
          });
          if(!(await this.action(mission,id)).action)return;
        }
        if(!committed)throw Error('Mission changed repeatedly while the receipt agent planned; retry against current context.');
      }
      ({state,action}=await this.action(mission,id));if(!action?.testExecution||action.status!=='executing')return;
      const child=state.actions.find(x=>x.id===action!.testExecution!.followUpActionId);
      if(!child?.testExecution?.sourceReceiptId)throw Error('Saved downstream action is missing.');
      const decision={sourceReceiptId:child.testExecution.sourceReceiptId,message:child.detail};
      const receipt=followUpReceiptSchema.parse(await this.tools.follow(mission,id,decision));
      if(receipt.runId!==id||receipt.missionId!==mission||receipt.sourceReceiptId!==verified.id||receipt.message!==child.detail)throw Error('Follow-up receipt does not match the saved agent decision.');
      const confirmed=followUpReceiptSchema.parse(await this.tools.readFollowUp(receipt.id));
      if(JSON.stringify(confirmed)!==JSON.stringify(receipt))throw Error('Follow-up receipt could not be read back.');
      await this.change(mission,id,(current,a)=>{
        const follow=current.actions.find(x=>x.id===a.testExecution!.followUpActionId);if(!follow?.testExecution)return;
        a.status='acknowledged';a.testExecution!.phase='complete';a.testExecution!.followUp=confirmed;delete a.testExecution!.error;
        follow.status='acknowledged';follow.testExecution.phase='complete';follow.testExecution.followUp=confirmed;delete follow.testExecution.error;follow.updatedAt=new Date().toISOString();
        audit(current,'service',`Test desk confirmed follow-up ${confirmed.id}, linked to ticket ${verified.id}. No emergency service was contacted.`,follow.id);
      });
    }catch(error){
      if(!(await this.action(mission,id)).action)return;
      await this.change(mission,id,(state,a)=>{
        a.status='failed';a.testExecution!.phase='failed';a.testExecution!.error=error instanceof Error?error.message:'Execution could not be confirmed.';
        const child=state.actions.find(x=>x.id===a.testExecution!.followUpActionId);if(child?.testExecution){child.status='failed';child.testExecution.phase='failed';child.testExecution.error=a.testExecution!.error;}
        audit(state,'dispatcher',`Test execution needs retry. Saved reports and confirmed receipts remain intact. ${a.testExecution!.error}`,id);
      });
    }
  }
}
