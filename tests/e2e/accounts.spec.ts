import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { create, join, login, readRoom } from './helpers';

const directory=process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-ACCOUNT-LIFECYCLE';
mkdirSync(directory,{recursive:true});
test('profile names stay unique and deletion revokes access while retaining shared records',async({page,browser},testInfo)=>{
  const {code,invite}=await create(page);
  const guestContext=await browser.newContext({baseURL:'http://127.0.0.1:5273',viewport:testInfo.project.use.viewport,isMobile:!!testInfo.project.use.isMobile,hasTouch:!!testInfo.project.use.hasTouch});
  try{
    const guest=await guestContext.newPage();await join(guest,code,invite);
    const name=`Arena Captain ${testInfo.project.name}`;
    await page.getByRole('button',{name:'Profile',exact:true}).click();
    await expect(page.getByLabel('Display name',{exact:true})).toBeFocused();
    await page.getByLabel('Display name',{exact:true}).fill(name);
    const scan=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']).analyze();
    writeFileSync(`${directory}/${testInfo.project.name}-profile-axe.json`,JSON.stringify({axeVersion:scan.testEngine.version,violations:scan.violations.map(x=>({id:x.id,impact:x.impact,targets:x.nodes.map(n=>n.target)})),incomplete:scan.incomplete.map(x=>({id:x.id,targets:x.nodes.map(n=>n.target)}))},null,2));
    expect(scan.violations).toEqual([]);
    await page.getByRole('button',{name:'Save display name',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Display name updated'})).toBeVisible();
    await expect.poll(async()=>{const result=await readRoom(guest,code);return result.body.room.members[0].name;}).toBe(name);
    await guest.getByRole('button',{name:'Profile',exact:true}).click();await guest.getByLabel('Display name',{exact:true}).fill(name);await guest.getByRole('button',{name:'Save display name',exact:true}).click();
    await expect(guest.getByRole('alert')).toContainText('already in use');await guest.getByRole('button',{name:'Close dialog'}).click();
    await page.screenshot({path:`${directory}/${testInfo.project.name}-profile.png`,fullPage:true});
    await page.getByLabel('Type DELETE MY ACCOUNT').fill('DELETE MY ACCOUNT');await page.getByRole('button',{name:'Delete my account',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('End or close your hosted auctions');expect((await readRoom(page,code)).status).toBe(200);
    await page.getByRole('button',{name:'members',exact:true}).click();await page.getByRole('button',{name:'Close room',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Close room',exact:true}).click();
    const oldToken=await page.evaluate(()=>localStorage.getItem('aa-token'));
    await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByLabel('Type DELETE MY ACCOUNT').fill('DELETE MY ACCOUNT');await page.getByRole('button',{name:'Delete my account',exact:true}).click();
    await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
    const denied=await page.request.get(`/api/rooms/${code}`,{headers:{Authorization:`Bearer ${oldToken}`}});expect(denied.status()).toBe(401);
    await expect.poll(async()=>JSON.stringify((await readRoom(guest,code)).body.room)).toContain('Deleted player');
    expect((await readRoom(guest,code)).status).toBe(200);
  }finally{await guestContext.close();}
});

test('a pending profile response cannot restore names or rooms after sign-out',async({page})=>{
  await create(page);let release!:()=>void,seen!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;}),captured=new Promise<void>(resolve=>{seen=resolve;});
  await page.route('**/api/me',async route=>{if(route.request().method()==='PATCH'){seen();await pending;}await route.continue();});
  await page.getByRole('button',{name:'Profile',exact:true}).click();await page.getByLabel('Display name',{exact:true}).fill('Pending Captain');
  await page.getByRole('button',{name:'Save display name',exact:true}).click();await captured;
  await page.getByRole('button',{name:'Close dialog'}).click();await page.getByRole('button',{name:'My auctions',exact:true}).click();await page.getByRole('button',{name:'Sign out of local profile'}).click();release();
  await expect(page.getByRole('alert')).toContainText('Account changed');
  expect(await page.evaluate(()=>localStorage.getItem('aa-user'))).toBeNull();await expect(page.getByRole('button',{name:'Profile',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await login(page,'Following Captain');await page.getByRole('button',{name:'Profile',exact:true}).click();await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Following Captain');
});
