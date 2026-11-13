import { test, expect } from '@playwright/test';
import { create, readRoom } from './helpers';

test('recent snapshots stay bounded while history pages older activity',async({page})=>{
  const {code}=await create(page);
  await page.getByRole('button',{name:/Mumbai Meteors/}).click();
  await page.evaluate(async code=>{
    for(let i=0;i<110;i++){
      const response=await fetch(`/api/rooms/${code}/actions`,{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('aa-token'),'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),type:'ready'})});
      if(!response.ok)throw new Error(`History fixture failed: ${response.status}`);
      if(i%10===0)await new Promise(resolve=>setTimeout(resolve,650));
    }
  },code);
  const current=(await readRoom(page,code)).body.room;expect(current.history).toHaveLength(100);
  await page.getByRole('button',{name:'history',exact:true}).click();
  await expect(page.locator('.history > div')).toHaveCount(100);
  await page.getByRole('button',{name:'Older activity'}).click();
  await expect(page.locator('.history > div')).toHaveCount(11);
  await expect(page.getByRole('button',{name:'Older activity'})).toBeDisabled();
  await page.getByRole('button',{name:'Latest activity'}).click();
  await expect(page.locator('.history > div')).toHaveCount(100);
});
