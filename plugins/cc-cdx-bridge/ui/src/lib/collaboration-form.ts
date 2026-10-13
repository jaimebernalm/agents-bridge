type Api=<T>(path:string,body?:unknown)=>Promise<T>;
type EditableRun={id:string;coordination:{revision:number};editAuthorization?:{valid:boolean;scope:string|null}};
export type EditChoice={enabled:boolean;scope:string};

// A retried start must honor the choice currently shown, including revoking an earlier grant.
export async function syncEditAuthorization(api:Api,run:EditableRun,edit:EditChoice){
 const grant=run.editAuthorization,body={runId:run.id,expectedRevision:run.coordination.revision};
 if(!edit.enabled){if(grant?.valid)await api('desktop/edit_authorization',{...body,revoke:true});return;}
 const scope=edit.scope.trim();if(!scope)throw new Error('Edit scope is required');
 if(!grant?.valid||grant.scope?.trim()!==scope)await api('desktop/edit_authorization',{...body,scope});
}
