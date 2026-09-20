/** Offline visual inventory of actual Vue screens. Fixture states are not service integration tests. */
import {createServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwind from '@tailwindcss/vite'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import cases,{fixtures,installMocks} from './ux-review/fixtures.mjs'
const filter=process.argv[2] || process.env.UX_FILTER
const out=process.argv[3] || process.env.UX_SCREENSHOTS || '/private/tmp/buho-hig-screens'
await mkdir(out,{recursive:true})
const server=await createServer({configFile:false,plugins:[vue(),tailwind()],server:{host:'127.0.0.1',port:0},publicDir:'public'})
await server.listen()
const base=server.resolvedUrls.local[0]
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_PATH?{executablePath:process.env.BROWSER_PATH}:{})})
const results=[]
try {
 for(const item of cases.filter(c=>!filter || new RegExp(filter).test(c.id))) {
  const page=await browser.newPage({viewport:{width:item.width||380,height:700},reducedMotion:'reduce'})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort())
  await page.routeWebSocket('**',ws=>ws.close())
  await page.addInitScript(installMocks,fixtures)
  try {
   await page.goto(base+'scripts/ux-review/index.html')
   await page.waitForFunction(()=>!!window.mountReview)
   await page.evaluate(item=>window.mountReview(item),item)
   if (item.fontScale) await page.addStyleTag({content:`html { font-size: ${16 * item.fontScale}px !important; }`})
   await page.waitForTimeout(100)
   if (item.details) await page.locator('details').first().evaluate(el => {el.open = true})
   const evidence=await page.evaluate(()=>({
    width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,
    text:document.body.innerText,
    nestedButtons:document.querySelectorAll('button button').length,
    unnamedDialogs:[...document.querySelectorAll('[role=dialog]')].filter(el => el.checkVisibility() && !el.getAttribute('aria-label') && !document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim()).length,
    unnamed:[...document.querySelectorAll('button,input,select,textarea')].filter(el=>el.checkVisibility() && !el.innerText?.trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.labels?.length && !el.title).map(el=>({tag:el.tagName,placeholder:el.getAttribute('placeholder'),html:el.outerHTML.slice(0,400)})),
    smallTargets:[...document.querySelectorAll('button,summary')].filter(el=>el.checkVisibility()).map(el=>({text:(el.innerText||el.getAttribute('aria-label')||el.title||'').slice(0,60),width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)})).filter(el=>el.width<24||el.height<24),
   }))
   await page.screenshot({path:path.join(out,item.id+'.png'),fullPage:true,animations:'disabled'})
   assert.ok(evidence.scrollWidth <= evidence.width, 'Horizontal overflow')
   assert.equal(evidence.unnamed.length, 0, 'Unnamed visible controls')
   assert.equal(evidence.nestedButtons, 0, 'Nested buttons')
   assert.equal(evidence.unnamedDialogs, 0, 'Unnamed dialogs')
   assert.equal(errors.length, 0, 'Runtime errors')
   if (item.id === 'delete-account-large-text') {
     const action = page.getByRole('button', {name:'Yes, remove this account',exact:true})
     await action.scrollIntoViewIfNeeded()
     assert.ok(await action.evaluate(el => {const r=el.getBoundingClientRect();return r.top >= 0 && r.bottom <= innerHeight}), 'Large-text confirmation stays reachable by scrolling')
   }
   if (item.id === 'popup-account') {
     const accountTab = page.getByRole('tab', {name:'Account',exact:true})
     await accountTab.focus()
     await page.keyboard.press('ArrowRight')
     assert.equal(await page.getByRole('tab',{name:'Wallet',exact:true}).getAttribute('aria-selected'),'true')
     await page.keyboard.press('Home')
     assert.equal(await accountTab.getAttribute('aria-selected'),'true')
   }
   if (['popup-thread', 'settings-thread'].includes(item.id)) assert.ok(await page.locator('[data-chat-messages]').evaluate(el => el.clientHeight > 200), 'Message history has usable height')
   if (item.id === 'relay-info') {
     assert.equal(await page.getByRole('dialog',{name:'Server details'}).count(), 1)
     for (let i=0;i<8;i++) {
       await page.keyboard.press('Tab')
       assert.ok(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')), 'Sheet retains keyboard focus')
     }
   }
   results.push({id:item.id,component:item.component,...evidence,errors})
   console.log(item.id, evidence.scrollWidth>evidence.width?'OVERFLOW':'',evidence.unnamed.length?'unnamed:'+evidence.unnamed.length:'',errors.length?JSON.stringify(errors):'')
  } catch(error) {results.push({id:item.id,component:item.component,error:error.message,errors});console.log(item.id,'FAILED',error.message.slice(0,200))}
  await page.close()
 }
 await writeFile(path.join(out,'evidence.json'),JSON.stringify(results,null,2))
 await writeFile(path.join(out,'index.html'),`<!doctype html><title>HIG screen review — synthetic fixtures</title><style>body{font:14px system-ui;background:#eee}main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}section{min-width:0;background:white;padding:8px}img{width:100%;height:550px;object-fit:contain;object-position:top}</style><h1>Actual components · synthetic fixtures · no network</h1><main>${results.map(r=>`<section><h3>${r.id}</h3><a href="${r.id}.png"><img src="${r.id}.png"></a></section>`).join('')}</main>`)
} finally {await browser.close();await server.close()}
console.log('Evidence:',out)
if (results.some(result=>result.error)) process.exitCode=1
