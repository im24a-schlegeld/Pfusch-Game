import {test,expect} from '@playwright/test';

test('all bike inspection views render, and repeating a preset restores it after dragging',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:'OPEN GARAGE'}).click();await page.getByRole('tab',{name:'BIKE',exact:true}).click();
 for(const [name,id] of [['Töffli','125'],['Supermoto','450'],['Sport','701']]){
  await page.getByRole('button',{name:`Preview ${name}`,exact:true}).click();
  if(id==='450')await page.getByRole('button',{name:'Burnt orange paint',exact:true}).click();
  if(id==='701')await page.getByRole('button',{name:'Asphalt paint',exact:true}).click();
  for(const [angle,label] of [['FRONT ¾','three-quarter'],['SIDE','side'],['REAR ¾','rear'],['FRONT','front']]){
   await page.getByRole('button',{name:`Inspect ${angle}`,exact:true}).click();
   await page.locator('canvas').waitFor();await page.waitForTimeout(450);
   await page.getByTestId('garage-model').screenshot({path:`outputs/final-${id}-${label}.png`});
  }
 }
 await page.getByRole('button',{name:'Inspect SIDE',exact:true}).click();await page.waitForTimeout(500);
 const canvas=page.locator('canvas');const before=await canvas.screenshot();const box=await canvas.boundingBox();expect(box).toBeTruthy();
 await page.mouse.move(box!.x+box!.width*.5,box!.y+box!.height*.5);await page.mouse.down();await page.mouse.move(box!.x+box!.width*.75,box!.y+box!.height*.5,{steps:6});await page.mouse.up();
 await page.waitForTimeout(300);expect((await canvas.screenshot()).equals(before)).toBe(false);
 await page.getByRole('button',{name:'Inspect SIDE',exact:true}).click();await page.waitForTimeout(500);
 expect((await canvas.screenshot()).equals(before)).toBe(true);expect(errors).toEqual([]);
});
