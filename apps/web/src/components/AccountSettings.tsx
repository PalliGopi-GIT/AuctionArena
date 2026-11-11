import { useState } from 'react';
import type { User } from '../../../../packages/shared/src/domain';
import { profileNameError } from '../../../../packages/shared/src/profile-rules';

export function AccountSettings({user,busy,onSave,onDelete}:{user:User;busy:boolean;
  onSave:(name:string)=>Promise<void>;onDelete:()=>Promise<void>}){
  const [name,setName]=useState(user.name),[confirmation,setConfirmation]=useState('');
  const error=profileNameError(name);
  return <>
    <form onSubmit={event=>{event.preventDefault();if(!error)void onSave(name);}}>
      <label>Display name<input value={name} onChange={event=>setName(event.target.value)} required maxLength={60} aria-describedby="profile-name-help"/></label>
      <p className="fine-print" id="profile-name-help">Use 3–30 characters. Names ignore case and repeated spaces when checking availability. Your auction name is separate from your sign-in details.</p>
      {error&&<p className="fine-print">{error}</p>}
      <button className="button" disabled={busy||!!error}>Save display name</button>
    </form>
    <section aria-labelledby="delete-account-title">
      <h3 id="delete-account-title">Delete account</h3>
      <p>End or close your hosted auctions first. Deletion signs you out and removes your profile. Shared auction sales remain with anonymized participant details. This cannot be undone.</p>
      <label>Type DELETE MY ACCOUNT<input autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>
      <button className="button secondary" disabled={busy||confirmation!=='DELETE MY ACCOUNT'} onClick={()=>void onDelete()}>Delete my account</button>
    </section>
  </>;
}
